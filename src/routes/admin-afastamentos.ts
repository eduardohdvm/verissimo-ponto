// Férias, atestados e afastamentos (ADMIN e GESTOR, dentro do escopo de cada um) e regras da empresa.
import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import { autenticar, exigirPapel } from "../auth.js";
import { prisma } from "../db.js";
import { naoEncontrado } from "../lib/erros.js";
import { esquemaRegras, lerRegras } from "../lib/regras.js";
import { criarAfastamento, TIPOS_AFASTAMENTO } from "../services/afastamentos.js";
import { filtroFuncionarios, funcionarioNoEscopo } from "../services/escopo.js";
import { PASTA_UPLOADS } from "../services/facial.js";
import { garantirSemFechamento } from "../services/fechamentos.js";
import { notificarFuncionarios } from "../services/notificacoes.js";
import { rota, sessao } from "./util.js";

export const rotasAfastamentos = Router();
rotasAfastamentos.use(autenticar, exigirPapel("ADMIN", "GESTOR"));
const eid = (req: Parameters<typeof sessao>[0]) => sessao(req).empresaId;

rotasAfastamentos.get(
  "/afastamentos",
  rota(async (req, res) => {
    const q = z
      .object({
        status: z.enum(["PENDENTE", "APROVADO", "REJEITADO"]).optional(),
        funcionarioId: z.string().optional(),
        ano: z.string().regex(/^\d{4}$/).optional(),
      })
      .parse(req.query);
    const lista = await prisma.afastamento.findMany({
      where: {
        empresaId: eid(req),
        funcionario: await filtroFuncionarios(sessao(req)),
        ...(q.status ? { status: q.status } : {}),
        ...(q.funcionarioId ? { funcionarioId: q.funcionarioId } : {}),
        ...(q.ano ? { inicio: { lte: `${q.ano}-12-31` }, fim: { gte: `${q.ano}-01-01` } } : {}),
      },
      include: { funcionario: { select: { nome: true } } },
      orderBy: { inicio: "desc" },
      take: 300,
    });
    res.json(lista.map(({ anexo, ...a }) => ({ ...a, temAnexo: !!anexo })));
  }),
);

rotasAfastamentos.post(
  "/funcionarios/:id/afastamentos",
  rota(async (req, res) => {
    const f = await funcionarioNoEscopo(sessao(req), req.params.id);
    res.status(201).json(await criarAfastamento(eid(req), f.id, sessao(req).usuarioId, req.body, true));
  }),
);

async function afastamentoNoEscopo(req: Parameters<typeof sessao>[0], id: string) {
  const a = await prisma.afastamento.findFirst({
    where: { id, empresaId: eid(req), funcionario: await filtroFuncionarios(sessao(req)) },
  });
  if (!a) throw naoEncontrado("Afastamento");
  return a;
}

rotasAfastamentos.post(
  "/afastamentos/:id/decisao",
  rota(async (req, res) => {
    const { aprovar } = z.object({ aprovar: z.boolean() }).parse(req.body);
    const a = await afastamentoNoEscopo(req, req.params.id);
    if (aprovar) await garantirSemFechamento(eid(req), a.inicio, a.fim);
    notificarFuncionarios(eid(req), [a.funcionarioId], aprovar ? "Atestado aprovado" : "Atestado recusado",
      `Seu atestado de ${a.inicio.split("-").reverse().join("/")} foi ${aprovar ? "aprovado" : "recusado"}.`, "/ponto#ajuste");
    res.json(
      await prisma.afastamento.update({
        where: { id: a.id },
        data: { status: aprovar ? "APROVADO" : "REJEITADO", decididoPor: sessao(req).usuarioId, decididoEm: new Date() },
      }),
    );
  }),
);

rotasAfastamentos.delete(
  "/afastamentos/:id",
  rota(async (req, res) => {
    const a = await afastamentoNoEscopo(req, req.params.id);
    if (a.status === "APROVADO") await garantirSemFechamento(eid(req), a.inicio, a.fim);
    await prisma.afastamento.delete({ where: { id: a.id } });
    res.json({ ok: true });
  }),
);

rotasAfastamentos.get(
  "/afastamentos/:id/anexo",
  rota(async (req, res) => {
    const a = await afastamentoNoEscopo(req, req.params.id);
    if (!a.anexo) throw naoEncontrado("Anexo");
    res.sendFile(path.join(PASTA_UPLOADS, a.anexo));
  }),
);

rotasAfastamentos.get("/afastamentos/tipos", (_req, res) => res.json(TIPOS_AFASTAMENTO));

// ---------- Regras da convenção (só ADMIN altera) ----------

rotasAfastamentos.get(
  "/regras",
  rota(async (req, res) => {
    const emp = await prisma.empresa.findUniqueOrThrow({ where: { id: eid(req) } });
    res.json(lerRegras(emp.regras));
  }),
);

rotasAfastamentos.put(
  "/regras",
  exigirPapel("ADMIN"),
  rota(async (req, res) => {
    const regras = esquemaRegras.parse(req.body);
    // A faixa "sem limite" (ateMin null) precisa ser a última
    const semLimite = regras.faixasExtra.findIndex((f) => f.ateMin === null);
    if (semLimite !== -1 && semLimite !== regras.faixasExtra.length - 1) {
      regras.faixasExtra.push(...regras.faixasExtra.splice(semLimite, 1));
    }
    await prisma.empresa.update({ where: { id: eid(req) }, data: { regras: JSON.stringify(regras) } });
    res.json(regras);
  }),
);
