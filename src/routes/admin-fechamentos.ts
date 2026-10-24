// Fechamento do mês (só ADMIN): congela o espelho de cada funcionário e pede a assinatura.
import { createHash } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { autenticar, exigirPapel } from "../auth.js";
import { prisma } from "../db.js";
import { ErroHttp, naoEncontrado } from "../lib/erros.js";
import { esquemaPeriodo } from "../services/cadastros.js";
import { filtroFuncionarios } from "../services/escopo.js";
import { gerarEspelho } from "../services/espelho.js";
import { notificarFuncionarios } from "../services/notificacoes.js";
import { dispararWebhook } from "../services/webhooks.js";
import { rota, sessao } from "./util.js";

export const rotasFechamentos = Router();
rotasFechamentos.use(autenticar, exigirPapel("ADMIN", "GESTOR"));
const soAdmin = exigirPapel("ADMIN");
const eid = (req: Parameters<typeof sessao>[0]) => sessao(req).empresaId;

export const hashEspelho = (json: string) => createHash("sha256").update(json).digest("hex");

rotasFechamentos.get(
  "/fechamentos",
  soAdmin,
  rota(async (req, res) => {
    const lista = await prisma.fechamento.findMany({
      where: { empresaId: eid(req) },
      include: { assinaturas: { select: { status: true } } },
      orderBy: [{ inicio: "desc" }, { fechadoEm: "desc" }],
      take: 36,
    });
    res.json(
      lista.map(({ assinaturas, ...f }) => ({
        ...f,
        total: assinaturas.length,
        assinados: assinaturas.filter((a) => a.status === "ASSINADO").length,
        contestados: assinaturas.filter((a) => a.status === "CONTESTADO").length,
      })),
    );
  }),
);

rotasFechamentos.post(
  "/fechamentos",
  soAdmin,
  rota(async (req, res) => {
    const p = esquemaPeriodo.parse(req.body);
    const { forcar } = z.object({ forcar: z.boolean().default(false) }).parse(req.body);
    const empresaId = eid(req);
    const sobreposto = await prisma.fechamento.findFirst({
      where: { empresaId, status: "FECHADO", inicio: { lte: p.fim }, fim: { gte: p.inicio } },
    });
    if (sobreposto) throw new ErroHttp(409, "Já existe um fechamento que cobre parte desse período");

    // Pendências no período: melhor resolver antes de fechar
    const [ajustes, atestados] = await Promise.all([
      prisma.tratamento.count({ where: { empresaId, status: "PENDENTE", data: { gte: p.inicio, lte: p.fim } } }),
      prisma.afastamento.count({ where: { empresaId, status: "PENDENTE", inicio: { lte: p.fim }, fim: { gte: p.inicio } } }),
    ]);
    if ((ajustes || atestados) && !forcar) {
      throw new ErroHttp(
        409,
        `Há ${ajustes} ajuste(s) e ${atestados} atestado(s) pendentes nesse período. Resolva em Solicitações ou feche mesmo assim (pendentes ficam de fora).`,
      );
    }

    const funcionarios = await prisma.funcionario.findMany({
      where: { empresaId, ativo: true, OR: [{ admissao: null }, { admissao: { lte: new Date(p.fim + "T23:59:59Z") } }] },
      select: { id: true },
    });
    const espelhos = [];
    for (const f of funcionarios) {
      const e = await gerarEspelho(empresaId, f.id, p.inicio, p.fim, { usarCongelado: false });
      const json = JSON.stringify({ ...e, fechamento: undefined });
      espelhos.push({ funcionarioId: f.id, json, hash: hashEspelho(json), saldo: e.totais.saldoBancoMin });
    }
    const fechamento = await prisma.fechamento.create({
      data: {
        empresaId,
        inicio: p.inicio,
        fim: p.fim,
        fechadoPor: sessao(req).usuarioId,
        assinaturas: {
          create: espelhos.map((e) => ({
            empresaId,
            funcionarioId: e.funcionarioId,
            espelho: e.json,
            hash: e.hash,
            saldoBancoMin: e.saldo,
          })),
        },
      },
    });
    dispararWebhook(empresaId, "fechamento.concluido", { id: fechamento.id, inicio: p.inicio, fim: p.fim, funcionarios: espelhos.length });
    notificarFuncionarios(
      empresaId,
      espelhos.map((e) => e.funcionarioId),
      "Espelho de ponto para assinar",
      `O período de ${p.inicio.split("-").reverse().join("/")} a ${p.fim.split("-").reverse().join("/")} foi fechado. Confira e assine o seu espelho.`,
      "/ponto#assinar",
    );
    res.status(201).json({ ...fechamento, total: espelhos.length });
  }),
);

rotasFechamentos.get(
  "/fechamentos/:id",
  soAdmin,
  rota(async (req, res) => {
    const f = await prisma.fechamento.findFirst({
      where: { id: req.params.id, empresaId: eid(req) },
      include: {
        assinaturas: {
          select: {
            id: true, status: true, assinadoEm: true, observacao: true, saldoBancoMin: true, hash: true,
            funcionario: { select: { id: true, nome: true, departamento: { select: { nome: true } } } },
          },
          orderBy: { funcionario: { nome: "asc" } },
        },
      },
    });
    if (!f) throw naoEncontrado("Fechamento");
    res.json(f);
  }),
);

rotasFechamentos.post(
  "/fechamentos/:id/reabrir",
  soAdmin,
  rota(async (req, res) => {
    const { motivo } = z.object({ motivo: z.string().trim().min(5, "Explique o motivo da reabertura") }).parse(req.body);
    const f = await prisma.fechamento.findFirst({ where: { id: req.params.id, empresaId: eid(req), status: "FECHADO" } });
    if (!f) throw naoEncontrado("Fechamento");
    // O registro e as assinaturas ficam guardados para auditoria; o período volta a aceitar ajustes
    res.json(
      await prisma.fechamento.update({
        where: { id: f.id },
        data: { status: "REABERTO", reabertoPor: sessao(req).usuarioId, reabertoEm: new Date(), motivoReabertura: motivo },
      }),
    );
  }),
);

// Espelho assinado para imprimir ou arquivar (ADMIN vê todos; GESTOR, os da equipe)
rotasFechamentos.get(
  "/assinaturas/:id",
  rota(async (req, res) => {
    const a = await prisma.assinaturaEspelho.findFirst({
      where: { id: req.params.id, empresaId: eid(req), funcionario: await filtroFuncionarios(sessao(req)) },
      include: { fechamento: true },
    });
    if (!a) throw naoEncontrado("Espelho");
    res.json(montarAssinatura(a));
  }),
);

export function montarAssinatura(a: {
  id: string; espelho: string; hash: string; status: string; assinadoEm: Date | null; ip: string | null; observacao: string | null;
  fechamento: { fechadoEm: Date; status: string };
}) {
  return {
    ...JSON.parse(a.espelho),
    assinatura: {
      id: a.id,
      status: a.status,
      hash: a.hash,
      conferido: hashEspelho(a.espelho) === a.hash,
      assinadoEm: a.assinadoEm,
      ip: a.ip,
      observacao: a.observacao,
      fechadoEm: a.fechamento.fechadoEm,
      fechamentoStatus: a.fechamento.status,
    },
  };
}
