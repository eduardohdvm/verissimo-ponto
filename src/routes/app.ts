// Rotas extras do app do funcionário (tela inicial, histórico com fotos, arquivos, comunicados, suporte).
// Montadas em /api/ponto, depois da autenticação.
import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { ErroHttp, naoEncontrado } from "../lib/erros.js";
import { historicoDoMes, resumoInicio } from "../services/app-funcionario.js";
import { caminhoAbsoluto } from "../services/arquivos.js";
import { notificar, responsaveisPor } from "../services/notificacoes.js";
import { TIPOS_DOCUMENTO } from "./admin-conteudo.js";
import { rota, sessao } from "./util.js";

export const rotasApp = Router();

function fid(req: Parameters<typeof sessao>[0]) {
  const id = sessao(req).funcionarioId;
  if (!id) throw new ErroHttp(403, "Seu usuário não está vinculado a um funcionário");
  return id;
}

rotasApp.get(
  "/inicio",
  rota(async (req, res) => {
    const s = sessao(req);
    res.json(await resumoInicio(s.empresaId, fid(req), s.usuarioId));
  }),
);

// Foto do perfil: a do cadastro facial ou a última selfie
rotasApp.get(
  "/foto",
  rota(async (req, res) => {
    const f = await prisma.funcionario.findUniqueOrThrow({ where: { id: fid(req) } });
    const ultima = f.fotoCadastro
      ? null
      : await prisma.marcacao.findFirst({ where: { funcionarioId: f.id, selfie: { not: null } }, orderBy: { dataHora: "desc" } });
    const arquivo = f.fotoCadastro ?? ultima?.selfie;
    if (!arquivo) throw naoEncontrado("Foto");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.sendFile(caminhoAbsoluto(arquivo));
  }),
);

rotasApp.get(
  "/logo",
  rota(async (req, res) => {
    const e = await prisma.empresa.findUniqueOrThrow({ where: { id: sessao(req).empresaId } });
    if (!e.logo) throw naoEncontrado("Logo");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.sendFile(caminhoAbsoluto(e.logo));
  }),
);

rotasApp.get(
  "/historico",
  rota(async (req, res) => {
    const { mes } = z.object({ mes: z.string().regex(/^\d{4}-\d{2}$/) }).parse(req.query);
    res.json(await historicoDoMes(fid(req), mes));
  }),
);

rotasApp.get(
  "/marcacoes/:id/selfie",
  rota(async (req, res) => {
    const m = await prisma.marcacao.findFirst({ where: { id: req.params.id, funcionarioId: fid(req) } });
    if (!m?.selfie) throw naoEncontrado("Foto");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.sendFile(caminhoAbsoluto(m.selfie));
  }),
);

// ---------- Arquivos: documentos do RH + folhas de ponto (espelhos fechados) ----------

rotasApp.get(
  "/arquivos",
  rota(async (req, res) => {
    const id = fid(req);
    const f = await prisma.funcionario.findUniqueOrThrow({ where: { id }, include: { filial: true, departamento: true } });
    const lotacao = f.filial?.nome ?? f.departamento?.nome ?? null;
    const [documentos, espelhos] = await Promise.all([
      prisma.documento.findMany({ where: { funcionarioId: id }, orderBy: [{ competencia: "desc" }, { criadoEm: "desc" }] }),
      prisma.assinaturaEspelho.findMany({
        where: { funcionarioId: id, fechamento: { status: "FECHADO" } },
        include: { fechamento: true },
        orderBy: { criadoEm: "desc" },
      }),
    ]);
    const lista = [
      ...documentos.map((d) => ({
        id: d.id, origem: "DOCUMENTO", codigo: d.id.slice(-6).toUpperCase(), competencia: d.competencia,
        tipo: d.tipo, nomeTipo: d.titulo ?? TIPOS_DOCUMENTO[d.tipo] ?? d.tipo, status: d.status,
        exigeAssinatura: d.exigeAssinatura, data: d.assinadoEm ?? d.criadoEm, lotacao,
      })),
      ...espelhos.map((a) => ({
        id: a.id, origem: "FOLHA_PONTO", codigo: a.id.slice(-6).toUpperCase(), competencia: a.fechamento.inicio.slice(0, 7),
        tipo: "FOLHA_PONTO", nomeTipo: "Folha de ponto", status: a.status, exigeAssinatura: true,
        data: a.assinadoEm ?? a.criadoEm, lotacao,
      })),
    ].sort((a, b) => b.competencia.localeCompare(a.competencia) || +new Date(b.data) - +new Date(a.data));
    res.json(lista);
  }),
);

async function meuDocumento(req: Parameters<typeof sessao>[0]) {
  const d = await prisma.documento.findFirst({ where: { id: req.params.id, funcionarioId: fid(req) } });
  if (!d) throw naoEncontrado("Documento");
  return d;
}

rotasApp.get(
  "/documentos/:id/arquivo",
  rota(async (req, res) => {
    const d = await meuDocumento(req);
    if (d.status === "PENDENTE" && !d.exigeAssinatura) {
      await prisma.documento.update({ where: { id: d.id }, data: { status: "VISUALIZADO", visualizadoEm: new Date() } });
    } else if (!d.visualizadoEm) {
      await prisma.documento.update({ where: { id: d.id }, data: { visualizadoEm: new Date() } });
    }
    res.sendFile(caminhoAbsoluto(d.arquivo));
  }),
);

// Assinatura eletrônica do documento: confirmada com a senha; guarda data, IP e o hash do arquivo
rotasApp.post(
  "/documentos/:id/assinar",
  rota(async (req, res) => {
    const { senha } = z.object({ senha: z.string() }).parse(req.body);
    const d = await meuDocumento(req);
    if (!d.exigeAssinatura || d.status === "ASSINADO") throw new ErroHttp(409, "Este documento não está aguardando assinatura");
    const u = await prisma.usuario.findUniqueOrThrow({ where: { id: sessao(req).usuarioId } });
    if (!(await bcrypt.compare(senha, u.senhaHash))) throw new ErroHttp(401, "Senha incorreta");
    res.json(
      await prisma.documento.update({
        where: { id: d.id },
        data: { status: "ASSINADO", assinadoEm: new Date(), ip: req.ip, visualizadoEm: d.visualizadoEm ?? new Date() },
      }),
    );
  }),
);

// ---------- Comunicados ----------

rotasApp.get(
  "/comunicados/:id/imagem",
  rota(async (req, res) => {
    const c = await prisma.comunicado.findFirst({ where: { id: req.params.id, empresaId: sessao(req).empresaId } });
    if (!c?.imagem) throw naoEncontrado("Imagem");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.sendFile(caminhoAbsoluto(c.imagem));
  }),
);

rotasApp.post(
  "/comunicados/:id/lido",
  rota(async (req, res) => {
    const c = await prisma.comunicado.findFirst({ where: { id: req.params.id, empresaId: sessao(req).empresaId } });
    if (!c) throw naoEncontrado("Comunicado");
    const usuarioId = sessao(req).usuarioId;
    await prisma.comunicadoLeitura.upsert({
      where: { comunicadoId_usuarioId: { comunicadoId: c.id, usuarioId } },
      create: { comunicadoId: c.id, usuarioId },
      update: {},
    });
    res.json({ ok: true });
  }),
);

// ---------- Suporte ----------

rotasApp.get(
  "/suporte",
  rota(async (req, res) => {
    const e = await prisma.empresa.findUniqueOrThrow({ where: { id: sessao(req).empresaId } });
    res.json({
      empresa: e.razaoSocial, whatsapp: e.suporteWhatsapp, telefone: e.suporteTelefone, email: e.suporteEmail, horario: e.suporteHorario,
    });
  }),
);

rotasApp.post(
  "/mensagem",
  rota(async (req, res) => {
    const { texto } = z.object({ texto: z.string().trim().min(5, "Escreva a sua mensagem").max(1000) }).parse(req.body);
    const s = sessao(req);
    const f = await prisma.funcionario.findUniqueOrThrow({ where: { id: fid(req) } });
    const responsaveis = await responsaveisPor(s.empresaId, f.departamentoId);
    for (const r of responsaveis) await notificar(s.empresaId, r.id, `Mensagem de ${f.nome}`, texto, "/admin#funcionarios");
    res.json({ enviadaPara: responsaveis.length });
  }),
);
