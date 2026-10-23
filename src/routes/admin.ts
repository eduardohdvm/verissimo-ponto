import { randomBytes } from "node:crypto";
import path from "node:path";
import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { autenticar, exigirPapel, hashApiKey } from "../auth.js";
import { prisma } from "../db.js";
import { ErroHttp, naoEncontrado } from "../lib/erros.js";
import { partesLocais, somarDias, utcDeLocal } from "../lib/tempo.js";
import { gerarAfd } from "../services/afd.js";
import { dadosFuncionario, esquemaFuncionario, esquemaJornada, esquemaPeriodo } from "../services/cadastros.js";
import { gerarEspelho } from "../services/espelho.js";
import { cadastrarRosto } from "../services/facial.js";
import { PASTA_UPLOADS } from "../services/marcacoes.js";
import { dispararWebhook } from "../services/webhooks.js";
import { rota, sessao } from "./util.js";

export const rotasAdmin = Router();
rotasAdmin.use(autenticar, exigirPapel("ADMIN", "GESTOR"));
const soAdmin = exigirPapel("ADMIN");

const eid = (req: Parameters<typeof sessao>[0]) => sessao(req).empresaId;

async function garantirDaEmpresa(modelo: "funcionario" | "jornada" | "localPermitido", id: string, empresaId: string) {
  const where = { id, empresaId };
  const r =
    modelo === "funcionario"
      ? await prisma.funcionario.findFirst({ where })
      : modelo === "jornada"
        ? await prisma.jornada.findFirst({ where })
        : await prisma.localPermitido.findFirst({ where });
  if (!r) throw naoEncontrado();
}

// ---------- Painel ----------

rotasAdmin.get(
  "/painel",
  rota(async (req, res) => {
    const emp = await prisma.empresa.findUniqueOrThrow({ where: { id: eid(req) } });
    const hoje = partesLocais(new Date(), emp.fusoHorario).data;
    const inicioHoje = utcDeLocal(hoje, "00:00", emp.fusoHorario);
    const [ativos, marcacoesHoje, pendentes, recusadasHoje] = await Promise.all([
      prisma.funcionario.count({ where: { empresaId: emp.id, ativo: true } }),
      prisma.marcacao.findMany({
        where: { empresaId: emp.id, dataHora: { gte: utcDeLocal(hoje, "00:00", emp.fusoHorario) } },
        include: { funcionario: { select: { nome: true } } },
        orderBy: { dataHora: "desc" },
      }),
      prisma.tratamento.count({ where: { empresaId: emp.id, status: "PENDENTE" } }),
      prisma.tentativaRecusada.count({ where: { empresaId: emp.id, criadoEm: { gte: inicioHoje } } }),
    ]);
    const presentes = new Set(marcacoesHoje.map((m) => m.funcionarioId));
    res.json({
      hoje,
      funcionariosAtivos: ativos,
      presentesHoje: presentes.size,
      tratamentosPendentes: pendentes,
      tentativasRecusadasHoje: recusadasHoje,
      ultimasMarcacoes: marcacoesHoje.slice(0, 30).map((m) => ({
        id: m.id,
        nsr: m.nsr,
        funcionario: m.funcionario.nome,
        hora: partesLocais(m.dataHora, emp.fusoHorario).hora,
        origem: m.origem,
        temSelfie: !!m.selfie,
        distanciaFacial: m.distanciaFacial,
        provaVida: m.provaVida,
      })),
    });
  }),
);

// ---------- Funcionários ----------

rotasAdmin.get(
  "/funcionarios",
  rota(async (req, res) => {
    const lista = await prisma.funcionario.findMany({
      where: { empresaId: eid(req) },
      include: { jornada: { select: { nome: true } }, usuario: { select: { email: true } } },
      orderBy: { nome: "asc" },
    });
    res.json(lista.map(({ descritorFacial, fotoCadastro, ...f }) => ({ ...f, rostoCadastrado: !!descritorFacial })));
  }),
);

const esquemaAcesso = z.object({ email: z.string().email().toLowerCase(), senha: z.string().min(8) }).optional();

rotasAdmin.post(
  "/funcionarios",
  rota(async (req, res) => {
    const d = esquemaFuncionario.parse(req.body);
    const acesso = esquemaAcesso.parse(req.body.acesso);
    if (d.jornadaId) await garantirDaEmpresa("jornada", d.jornadaId, eid(req));
    if (acesso && (await prisma.usuario.findUnique({ where: { email: acesso.email } }))) {
      throw new ErroHttp(409, "E-mail já em uso");
    }
    const f = await prisma.funcionario.create({ data: { ...dadosFuncionario(d), empresaId: eid(req) } });
    if (acesso) {
      await prisma.usuario.create({
        data: {
          empresaId: eid(req),
          nome: f.nome,
          email: acesso.email,
          senhaHash: await bcrypt.hash(acesso.senha, 10),
          papel: "FUNCIONARIO",
          funcionarioId: f.id,
        },
      });
    }
    dispararWebhook(eid(req), "funcionario.alterado", f);
    res.status(201).json(f);
  }),
);

rotasAdmin.put(
  "/funcionarios/:id",
  rota(async (req, res) => {
    await garantirDaEmpresa("funcionario", req.params.id, eid(req));
    const d = esquemaFuncionario.parse(req.body);
    if (d.jornadaId) await garantirDaEmpresa("jornada", d.jornadaId, eid(req));
    const f = await prisma.funcionario.update({ where: { id: req.params.id }, data: dadosFuncionario(d) });
    const acesso = esquemaAcesso.parse(req.body.acesso);
    if (acesso) {
      const existente = await prisma.usuario.findUnique({ where: { funcionarioId: f.id } });
      const senhaHash = await bcrypt.hash(acesso.senha, 10);
      if (existente) await prisma.usuario.update({ where: { id: existente.id }, data: { email: acesso.email, senhaHash } });
      else
        await prisma.usuario.create({
          data: { empresaId: eid(req), nome: f.nome, email: acesso.email, senhaHash, papel: "FUNCIONARIO", funcionarioId: f.id },
        });
    }
    dispararWebhook(eid(req), "funcionario.alterado", f);
    res.json(f);
  }),
);

// ---------- Rosto de referência (reconhecimento facial) ----------

rotasAdmin.post(
  "/funcionarios/:id/rosto",
  rota(async (req, res) => {
    await garantirDaEmpresa("funcionario", req.params.id, eid(req));
    const { imagem } = z.object({ imagem: z.string().min(100) }).parse(req.body);
    res.json(await cadastrarRosto(eid(req), req.params.id, imagem));
  }),
);

rotasAdmin.get(
  "/funcionarios/:id/rosto",
  rota(async (req, res) => {
    const f = await prisma.funcionario.findFirst({ where: { id: req.params.id, empresaId: eid(req) } });
    if (!f?.fotoCadastro) throw naoEncontrado("Foto de cadastro");
    res.sendFile(path.join(PASTA_UPLOADS, f.fotoCadastro));
  }),
);

rotasAdmin.delete(
  "/funcionarios/:id/rosto",
  rota(async (req, res) => {
    await garantirDaEmpresa("funcionario", req.params.id, eid(req));
    await prisma.funcionario.update({
      where: { id: req.params.id },
      data: { fotoCadastro: null, descritorFacial: null, facialCadastradoEm: null },
    });
    res.json({ ok: true });
  }),
);

// Tentativas recusadas pelo reconhecimento facial
rotasAdmin.get(
  "/tentativas",
  rota(async (req, res) => {
    const emp = await prisma.empresa.findUniqueOrThrow({ where: { id: eid(req) } });
    const lista = await prisma.tentativaRecusada.findMany({
      where: { empresaId: emp.id, criadoEm: { gte: new Date(Date.now() - 7 * 86400_000) } },
      include: { funcionario: { select: { nome: true } } },
      orderBy: { criadoEm: "desc" },
      take: 100,
    });
    res.json(
      lista.map((t) => ({
        id: t.id,
        funcionario: t.funcionario.nome,
        motivo: t.motivo,
        distanciaFacial: t.distanciaFacial,
        temFoto: !!t.foto,
        data: partesLocais(t.criadoEm, emp.fusoHorario).data,
        hora: partesLocais(t.criadoEm, emp.fusoHorario).hora,
      })),
    );
  }),
);

rotasAdmin.get(
  "/tentativas/:id/foto",
  rota(async (req, res) => {
    const t = await prisma.tentativaRecusada.findFirst({ where: { id: req.params.id, empresaId: eid(req) } });
    if (!t?.foto) throw naoEncontrado("Foto");
    res.sendFile(path.join(PASTA_UPLOADS, t.foto));
  }),
);

// ---------- Jornadas ----------

rotasAdmin.get(
  "/jornadas",
  rota(async (req, res) => {
    const lista = await prisma.jornada.findMany({ where: { empresaId: eid(req) }, orderBy: { nome: "asc" } });
    res.json(lista.map((j) => ({ ...j, config: JSON.parse(j.horarios), horarios: undefined })));
  }),
);

rotasAdmin.post(
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

rotasAdmin.put(
  "/jornadas/:id",
  soAdmin,
  rota(async (req, res) => {
    await garantirDaEmpresa("jornada", req.params.id, eid(req));
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

rotasAdmin.get(
  "/locais",
  rota(async (req, res) => res.json(await prisma.localPermitido.findMany({ where: { empresaId: eid(req) } }))),
);

rotasAdmin.post(
  "/locais",
  soAdmin,
  rota(async (req, res) => {
    const l = await prisma.localPermitido.create({ data: { ...esquemaLocal.parse(req.body), empresaId: eid(req) } });
    res.status(201).json(l);
  }),
);

rotasAdmin.delete(
  "/locais/:id",
  soAdmin,
  rota(async (req, res) => {
    await garantirDaEmpresa("localPermitido", req.params.id, eid(req));
    await prisma.localPermitido.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  }),
);

// ---------- Feriados ----------

rotasAdmin.get(
  "/feriados",
  rota(async (req, res) =>
    res.json(await prisma.feriado.findMany({ where: { empresaId: eid(req) }, orderBy: { data: "asc" } })),
  ),
);

rotasAdmin.post(
  "/feriados",
  soAdmin,
  rota(async (req, res) => {
    const d = z.object({ data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), descricao: z.string().min(1) }).parse(req.body);
    const f = await prisma.feriado.upsert({
      where: { empresaId_data: { empresaId: eid(req), data: d.data } },
      create: { ...d, empresaId: eid(req) },
      update: { descricao: d.descricao },
    });
    res.status(201).json(f);
  }),
);

rotasAdmin.delete(
  "/feriados/:id",
  soAdmin,
  rota(async (req, res) => {
    await prisma.feriado.deleteMany({ where: { id: req.params.id, empresaId: eid(req) } });
    res.json({ ok: true });
  }),
);

// ---------- Marcações (somente leitura: nunca são editadas) ----------

rotasAdmin.get(
  "/marcacoes",
  rota(async (req, res) => {
    const { funcionarioId, data } = z.object({ funcionarioId: z.string(), data: z.string() }).parse(req.query);
    const emp = await prisma.empresa.findUniqueOrThrow({ where: { id: eid(req) } });
    const lista = await prisma.marcacao.findMany({
      where: {
        empresaId: emp.id,
        funcionarioId,
        dataHora: {
          gte: utcDeLocal(data, "00:00", emp.fusoHorario),
          lt: utcDeLocal(somarDias(data, 2), "00:00", emp.fusoHorario),
        },
      },
      include: { tratamentos: { where: { tipo: "DESCONSIDERAR", status: { not: "REJEITADO" } } } },
      orderBy: { dataHora: "asc" },
    });
    res.json(
      lista.map((m) => ({
        id: m.id,
        nsr: m.nsr,
        data: partesLocais(m.dataHora, emp.fusoHorario).data,
        hora: partesLocais(m.dataHora, emp.fusoHorario).hora,
        origem: m.origem,
        online: m.online,
        latitude: m.latitude,
        longitude: m.longitude,
        temSelfie: !!m.selfie,
        desconsiderada: m.tratamentos.some((t) => t.status === "APROVADO"),
      })),
    );
  }),
);

// Selfies só são servidas autenticadas (dado biométrico — LGPD)
rotasAdmin.get(
  "/marcacoes/:id/selfie",
  rota(async (req, res) => {
    const m = await prisma.marcacao.findFirst({ where: { id: req.params.id, empresaId: eid(req) } });
    if (!m?.selfie) throw naoEncontrado("Foto");
    res.sendFile(path.join(PASTA_UPLOADS, m.selfie));
  }),
);

// ---------- Tratamentos (ajustes de ponto) ----------

rotasAdmin.get(
  "/tratamentos",
  rota(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const emp = await prisma.empresa.findUniqueOrThrow({ where: { id: eid(req) } });
    const lista = await prisma.tratamento.findMany({
      where: { empresaId: emp.id, ...(status ? { status } : {}) },
      include: { funcionario: { select: { nome: true } }, marcacao: { select: { dataHora: true, nsr: true } } },
      orderBy: { criadoEm: "desc" },
      take: 200,
    });
    res.json(
      lista.map((t) => ({
        ...t,
        hora: t.dataHora ? partesLocais(t.dataHora, emp.fusoHorario).hora : null,
        horaMarcacao: t.marcacao ? partesLocais(t.marcacao.dataHora, emp.fusoHorario).hora : null,
      })),
    );
  }),
);

export const esquemaTratamento = z
  .object({
    tipo: z.enum(["INCLUSAO", "DESCONSIDERAR", "ABONO"]),
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    hora: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    marcacaoId: z.string().optional(),
    motivo: z.string().min(3, "Informe o motivo"),
  })
  .refine((t) => t.tipo !== "INCLUSAO" || t.hora, "Informe o horário a incluir")
  .refine((t) => t.tipo !== "DESCONSIDERAR" || t.marcacaoId, "Informe a marcação a desconsiderar");

/** Cria um tratamento; usado pelo gestor (já aprovado) e pelo funcionário (pendente). */
export async function criarTratamento(
  empresaId: string,
  funcionarioId: string,
  usuarioId: string,
  corpo: unknown,
  aprovado: boolean,
) {
  const t = esquemaTratamento.parse(corpo);
  const emp = await prisma.empresa.findUniqueOrThrow({ where: { id: empresaId } });
  if (t.marcacaoId) {
    const m = await prisma.marcacao.findFirst({ where: { id: t.marcacaoId, funcionarioId, empresaId } });
    if (!m) throw naoEncontrado("Marcação");
  }
  return prisma.tratamento.create({
    data: {
      empresaId,
      funcionarioId,
      tipo: t.tipo,
      data: t.data,
      dataHora: t.tipo === "INCLUSAO" ? utcDeLocal(t.data, t.hora!, emp.fusoHorario) : null,
      marcacaoId: t.tipo === "DESCONSIDERAR" ? t.marcacaoId : null,
      motivo: t.motivo,
      solicitadoPor: usuarioId,
      ...(aprovado ? { status: "APROVADO", decididoPor: usuarioId, decididoEm: new Date() } : {}),
    },
  });
}

rotasAdmin.post(
  "/funcionarios/:id/tratamentos",
  rota(async (req, res) => {
    await garantirDaEmpresa("funcionario", req.params.id, eid(req));
    const t = await criarTratamento(eid(req), req.params.id, sessao(req).usuarioId, req.body, true);
    res.status(201).json(t);
  }),
);

rotasAdmin.post(
  "/tratamentos/:id/decisao",
  rota(async (req, res) => {
    const { aprovar } = z.object({ aprovar: z.boolean() }).parse(req.body);
    const t = await prisma.tratamento.findFirst({ where: { id: req.params.id, empresaId: eid(req), status: "PENDENTE" } });
    if (!t) throw naoEncontrado("Solicitação pendente");
    const atualizado = await prisma.tratamento.update({
      where: { id: t.id },
      data: { status: aprovar ? "APROVADO" : "REJEITADO", decididoPor: sessao(req).usuarioId, decididoEm: new Date() },
    });
    dispararWebhook(eid(req), "tratamento.decidido", atualizado);
    res.json(atualizado);
  }),
);

// ---------- Espelho de ponto e AFD ----------

rotasAdmin.get(
  "/espelho/:funcionarioId",
  rota(async (req, res) => {
    const p = esquemaPeriodo.parse(req.query);
    res.json(await gerarEspelho(eid(req), req.params.funcionarioId, p.inicio, p.fim));
  }),
);

rotasAdmin.get(
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

rotasAdmin.get(
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

rotasAdmin.post(
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

rotasAdmin.delete(
  "/api-keys/:id",
  soAdmin,
  rota(async (req, res) => {
    await prisma.apiKey.updateMany({ where: { id: req.params.id, empresaId: eid(req) }, data: { revogadaEm: new Date() } });
    res.json({ ok: true });
  }),
);

rotasAdmin.get(
  "/webhooks",
  soAdmin,
  rota(async (req, res) => res.json(await prisma.webhook.findMany({ where: { empresaId: eid(req) } }))),
);

rotasAdmin.post(
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

rotasAdmin.delete(
  "/webhooks/:id",
  soAdmin,
  rota(async (req, res) => {
    await prisma.webhook.deleteMany({ where: { id: req.params.id, empresaId: eid(req) } });
    res.json({ ok: true });
  }),
);
