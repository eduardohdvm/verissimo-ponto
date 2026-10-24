// Conta da empresa (ADMIN) e painel do dono do SaaS (superadmin, definido em SUPERADMIN_EMAILS).
import { Router } from "express";
import { z } from "zod";
import { autenticar, exigirPapel } from "../auth.js";
import { prisma } from "../db.js";
import { ErroHttp, naoEncontrado } from "../lib/erros.js";
import { PLANOS } from "../lib/planos.js";
import { ehSuperadmin, limparCacheConta } from "../services/conta.js";
import { rota, sessao } from "./util.js";

export const rotasConta = Router();
rotasConta.use("/conta", autenticar, exigirPapel("ADMIN"));

rotasConta.get(
  "/conta",
  rota(async (req, res) => {
    const e = await prisma.empresa.findUniqueOrThrow({ where: { id: sessao(req).empresaId } });
    const ativos = await prisma.funcionario.count({ where: { empresaId: e.id, ativo: true } });
    const plano = PLANOS[e.plano] ?? PLANOS.TRIAL;
    res.json({
      plano: e.plano,
      nomePlano: plano.nome,
      trialAte: e.trialAte,
      bloqueada: e.bloqueada,
      ativos,
      limite: plano.limiteFuncionarios,
      precoPorFuncionario: plano.precoPorFuncionario,
      valorMensal: ativos * plano.precoPorFuncionario,
      retencaoFotosDias: e.retencaoFotosDias,
      planos: Object.entries(PLANOS).filter(([k]) => k !== "TRIAL").map(([codigo, p]) => ({ codigo, ...p })),
      contato: process.env.CONTATO_VENDAS ?? null,
    });
  }),
);

rotasConta.put(
  "/conta/privacidade",
  rota(async (req, res) => {
    const { retencaoFotosDias } = z.object({ retencaoFotosDias: z.number().int().min(30).max(1825) }).parse(req.body);
    await prisma.empresa.update({ where: { id: sessao(req).empresaId }, data: { retencaoFotosDias } });
    res.json({ ok: true });
  }),
);

// ---------- Superadmin (dono do SaaS) ----------

export const rotasSuperadmin = Router();
rotasSuperadmin.use(autenticar, async (req, _res, next) => {
  try {
    const u = await prisma.usuario.findUnique({ where: { id: sessao(req).usuarioId } });
    if (!u || !ehSuperadmin(u.email)) throw new ErroHttp(403, "Sem permissão");
    next();
  } catch (e) {
    next(e);
  }
});

rotasSuperadmin.get(
  "/empresas",
  rota(async (_req, res) => {
    const lista = await prisma.empresa.findMany({
      orderBy: { criadoEm: "desc" },
      select: {
        id: true, razaoSocial: true, cnpj: true, plano: true, trialAte: true, bloqueada: true, criadoEm: true,
        _count: { select: { funcionarios: { where: { ativo: true } } } },
        usuarios: { where: { papel: "ADMIN" }, select: { nome: true, email: true }, take: 1 },
        marcacoes: { orderBy: { dataHora: "desc" }, take: 1, select: { dataHora: true } },
      },
    });
    res.json(
      lista.map(({ _count, usuarios, marcacoes, ...e }) => ({
        ...e,
        ativos: _count.funcionarios,
        responsavel: usuarios[0] ?? null,
        ultimaMarcacao: marcacoes[0]?.dataHora ?? null,
        mensal: _count.funcionarios * (PLANOS[e.plano] ?? PLANOS.TRIAL).precoPorFuncionario,
      })),
    );
  }),
);

rotasSuperadmin.put(
  "/empresas/:id",
  rota(async (req, res) => {
    const d = z
      .object({
        plano: z.enum(Object.keys(PLANOS) as [string, ...string[]]),
        trialAte: z.string().nullable().optional(),
        bloqueada: z.boolean(),
      })
      .parse(req.body);
    const e = await prisma.empresa.findUnique({ where: { id: req.params.id } });
    if (!e) throw naoEncontrado("Empresa");
    await prisma.empresa.update({
      where: { id: e.id },
      data: { plano: d.plano, bloqueada: d.bloqueada, ...(d.trialAte !== undefined ? { trialAte: d.trialAte ? new Date(d.trialAte + "T23:59:59Z") : null } : {}) },
    });
    limparCacheConta(e.id);
    res.json({ ok: true });
  }),
);
