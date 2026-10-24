// Configurações da empresa (só ADMIN): jornadas, locais, feriados, regras, integrações e AFD.
import { randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { autenticar, exigirPapel, hashApiKey } from "../auth.js";
import { prisma } from "../db.js";
import { naoEncontrado } from "../lib/erros.js";
import { feriadosNacionais } from "../lib/feriados.js";
import { gerarAej } from "../services/aej.js";
import { gerarAfd } from "../services/afd.js";
import { assinarDestacado, situacaoCertificado } from "../services/certificado.js";
import { esquemaJornada, esquemaPeriodo } from "../services/cadastros.js";
import { rota, sessao } from "./util.js";

export const rotasConfig = Router();
// Jornadas e feriados também são lidos pelo gestor (espelho, telas); o resto é só do ADMIN
rotasConfig.use(autenticar, exigirPapel("ADMIN", "GESTOR"));
const soAdmin = exigirPapel("ADMIN");
const eid = (req: Parameters<typeof sessao>[0]) => sessao(req).empresaId;

// ---------- Jornadas ----------

rotasConfig.get(
  "/jornadas",
  rota(async (req, res) => {
    const lista = await prisma.jornada.findMany({ where: { empresaId: eid(req) }, orderBy: { nome: "asc" } });
    res.json(lista.map((j) => ({ ...j, config: JSON.parse(j.horarios), horarios: undefined })));
  }),
);

rotasConfig.post(
  "/jornadas",
  soAdmin,
  rota(async (req, res) => {
    const d = esquemaJornada.parse(req.body);
    const j = await prisma.jornada.create({
      data: { empresaId: eid(req), nome: d.nome, toleranciaMin: d.toleranciaMin, horarios: JSON.stringify(d.config) },
    });
    res.status(201).json(j);
  }),
);

rotasConfig.put(
  "/jornadas/:id",
  soAdmin,
  rota(async (req, res) => {
    if (!(await prisma.jornada.findFirst({ where: { id: req.params.id, empresaId: eid(req) } }))) throw naoEncontrado("Jornada");
    const d = esquemaJornada.parse(req.body);
    const j = await prisma.jornada.update({
      where: { id: req.params.id },
      data: { nome: d.nome, toleranciaMin: d.toleranciaMin, horarios: JSON.stringify(d.config) },
    });
    res.json(j);
  }),
);

// ---------- Locais permitidos (cerca virtual) ----------

const esquemaLocal = z.object({
  nome: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  raioMetros: z.number().int().min(20).max(5000),
});

rotasConfig.get(
  "/locais",
  rota(async (req, res) => res.json(await prisma.localPermitido.findMany({ where: { empresaId: eid(req) } }))),
);

rotasConfig.post(
  "/locais",
  soAdmin,
  rota(async (req, res) => {
    const l = await prisma.localPermitido.create({ data: { ...esquemaLocal.parse(req.body), empresaId: eid(req) } });
    res.status(201).json(l);
  }),
);

rotasConfig.delete(
  "/locais/:id",
  soAdmin,
  rota(async (req, res) => {
    await prisma.localPermitido.deleteMany({ where: { id: req.params.id, empresaId: eid(req) } });
    res.json({ ok: true });
  }),
);

// ---------- Feriados (da empresa toda ou de uma filial) ----------

rotasConfig.get(
  "/feriados",
  rota(async (req, res) =>
    res.json(
      await prisma.feriado.findMany({
        where: { empresaId: eid(req) },
        include: { filial: { select: { nome: true } } },
        orderBy: { data: "asc" },
      }),
    ),
  ),
);

const esquemaFeriado = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  descricao: z.string().min(1),
  filialId: z.string().nullable().optional(),
});

async function salvarFeriado(empresaId: string, d: z.infer<typeof esquemaFeriado>) {
  const filialId = d.filialId || null;
  if (filialId && !(await prisma.filial.findFirst({ where: { id: filialId, empresaId } }))) throw naoEncontrado("Filial");
  const existente = await prisma.feriado.findFirst({ where: { empresaId, data: d.data, filialId } });
  return existente
    ? prisma.feriado.update({ where: { id: existente.id }, data: { descricao: d.descricao } })
    : prisma.feriado.create({ data: { empresaId, data: d.data, descricao: d.descricao, filialId } });
}

rotasConfig.post(
  "/feriados",
  soAdmin,
  rota(async (req, res) => {
    res.status(201).json(await salvarFeriado(eid(req), esquemaFeriado.parse(req.body)));
  }),
);

rotasConfig.post(
  "/feriados/nacionais",
  soAdmin,
  rota(async (req, res) => {
    const { ano, facultativos } = z
      .object({ ano: z.number().int().min(2000).max(2100), facultativos: z.boolean().default(false) })
      .parse(req.body);
    const lista = feriadosNacionais(ano, facultativos);
    for (const f of lista) await salvarFeriado(eid(req), f);
    res.json({ importados: lista.length });
  }),
);

rotasConfig.delete(
  "/feriados/:id",
  soAdmin,
  rota(async (req, res) => {
    await prisma.feriado.deleteMany({ where: { id: req.params.id, empresaId: eid(req) } });
    res.json({ ok: true });
  }),
);

// ---------- AFD ----------

rotasConfig.get(
  "/afd",
  soAdmin,
  rota(async (req, res) => {
    const p = esquemaPeriodo.parse(req.query);
    const conteudo = await gerarAfd(eid(req), p.inicio, p.fim);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="AFD_${p.inicio}_${p.fim}.txt"`);
    res.send(conteudo);
  }),
);

// ---------- Integrações: chaves de API e webhooks ----------

rotasConfig.get(
  "/api-keys",
  soAdmin,
  rota(async (req, res) =>
    res.json(
      await prisma.apiKey.findMany({
        where: { empresaId: eid(req) },
        select: { id: true, nome: true, prefixo: true, criadoEm: true, ultimoUso: true, revogadaEm: true },
        orderBy: { criadoEm: "desc" },
      }),
    ),
  ),
);

rotasConfig.post(
  "/api-keys",
  soAdmin,
  rota(async (req, res) => {
    const { nome } = z.object({ nome: z.string().min(1) }).parse(req.body);
    const chave = "pk_" + randomBytes(24).toString("hex");
    await prisma.apiKey.create({
      data: { empresaId: eid(req), nome, prefixo: chave.slice(0, 10), hash: hashApiKey(chave) },
    });
    // A chave completa só é mostrada agora; no banco fica apenas o hash
    res.status(201).json({ chave });
  }),
);

rotasConfig.delete(
  "/api-keys/:id",
  soAdmin,
  rota(async (req, res) => {
    await prisma.apiKey.updateMany({ where: { id: req.params.id, empresaId: eid(req) }, data: { revogadaEm: new Date() } });
    res.json({ ok: true });
  }),
);

rotasConfig.get(
  "/webhooks",
  soAdmin,
  rota(async (req, res) => res.json(await prisma.webhook.findMany({ where: { empresaId: eid(req) } }))),
);

rotasConfig.post(
  "/webhooks",
  soAdmin,
  rota(async (req, res) => {
    const d = z.object({ url: z.string().url(), eventos: z.array(z.string()).min(1) }).parse(req.body);
    const w = await prisma.webhook.create({
      data: { empresaId: eid(req), url: d.url, eventos: d.eventos.join(","), segredo: "whsec_" + randomBytes(20).toString("hex") },
    });
    res.status(201).json(w);
  }),
);

rotasConfig.delete(
  "/webhooks/:id",
  soAdmin,
  rota(async (req, res) => {
    await prisma.webhook.deleteMany({ where: { id: req.params.id, empresaId: eid(req) } });
    res.json({ ok: true });
  }),
);

// ---------- AEJ e assinatura digital ----------

rotasConfig.get(
  "/aej",
  soAdmin,
  rota(async (req, res) => {
    const p = esquemaPeriodo.parse(req.query);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="AEJ_${p.inicio}_${p.fim}.txt"`);
    res.send(await gerarAej(eid(req), p.inicio, p.fim));
  }),
);

// AFD e a assinatura dele na mesma resposta: o AFD tem a hora de geração, então
// a assinatura só confere com o arquivo gerado junto com ela
rotasConfig.get(
  "/afd/assinado",
  soAdmin,
  rota(async (req, res) => {
    const p = esquemaPeriodo.parse(req.query);
    const afd = await gerarAfd(eid(req), p.inicio, p.fim);
    res.json({ afd, p7s: assinarDestacado(Buffer.from(afd, "utf8")).toString("base64") });
  }),
);

rotasConfig.get("/certificado", soAdmin, (_req, res) => res.json(situacaoCertificado()));
