// Conteúdo para o app do funcionário (só ADMIN): comunicados, documentos (contracheque etc.),
// logo da empresa e contatos de suporte.
import { Router } from "express";
import { z } from "zod";
import { autenticar, exigirPapel } from "../auth.js";
import { prisma } from "../db.js";
import { ErroHttp, naoEncontrado } from "../lib/erros.js";
import { caminhoAbsoluto, salvarArquivo } from "../services/arquivos.js";
import { notificarFuncionarios } from "../services/notificacoes.js";
import { rota, sessao } from "./util.js";

export const rotasConteudo = Router();
rotasConteudo.use(["/comunicados", "/documentos", "/marca"], autenticar, exigirPapel("ADMIN"));
const eid = (req: Parameters<typeof sessao>[0]) => sessao(req).empresaId;

export const TIPOS_DOCUMENTO: Record<string, string> = {
  CONTRACHEQUE: "Contracheque",
  INFORME_RENDIMENTOS: "Informe de rendimentos",
  FERIAS: "Aviso e recibo de férias",
  CONTRATO: "Contrato / aditivo",
  OUTRO: "Outro documento",
};

// ---------- Comunicados ----------

const esquemaComunicado = z.object({
  titulo: z.string().trim().min(3, "Informe o título"),
  texto: z.string().trim().min(3, "Escreva o comunicado"),
  imagem: z.string().nullable().optional(),
  cor: z.enum(["azul", "roxo", "laranja", "verde", "vermelho"]).default("azul"),
  popup: z.boolean().default(false),
  departamentoId: z.string().nullable().optional().transform((v) => v || null),
  expiraEm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal("")).transform((v) => v || null),
  notificar: z.boolean().default(true),
});

rotasConteudo.get(
  "/comunicados",
  rota(async (req, res) => {
    const [lista, totalUsuarios] = await Promise.all([
      prisma.comunicado.findMany({
        where: { empresaId: eid(req) },
        include: { _count: { select: { leituras: true } } },
        orderBy: { criadoEm: "desc" },
        take: 100,
      }),
      prisma.usuario.count({ where: { empresaId: eid(req), papel: "FUNCIONARIO", ativo: true } }),
    ]);
    res.json(lista.map(({ imagem, _count, ...c }) => ({ ...c, temImagem: !!imagem, leituras: _count.leituras, totalUsuarios })));
  }),
);

rotasConteudo.post(
  "/comunicados",
  rota(async (req, res) => {
    const d = esquemaComunicado.parse(req.body);
    if (d.departamentoId && !(await prisma.departamento.findFirst({ where: { id: d.departamentoId, empresaId: eid(req) } }))) {
      throw naoEncontrado("Departamento");
    }
    const c = await prisma.comunicado.create({
      data: {
        empresaId: eid(req),
        titulo: d.titulo,
        texto: d.texto,
        imagem: d.imagem ? (await salvarArquivo(eid(req), "comunicado", d.imagem, { soImagem: true })).caminho : null,
        cor: d.cor,
        popup: d.popup,
        departamentoId: d.departamentoId,
        expiraEm: d.expiraEm ? new Date(d.expiraEm + "T23:59:59Z") : null,
        criadoPor: sessao(req).usuarioId,
      },
    });
    if (d.notificar) {
      const funcs = await prisma.funcionario.findMany({
        where: { empresaId: eid(req), ativo: true, ...(d.departamentoId ? { departamentoId: d.departamentoId } : {}) },
        select: { id: true },
      });
      notificarFuncionarios(eid(req), funcs.map((f) => f.id), d.titulo, d.texto.slice(0, 140), "/ponto");
    }
    res.status(201).json(c);
  }),
);

rotasConteudo.delete(
  "/comunicados/:id",
  rota(async (req, res) => {
    await prisma.comunicado.deleteMany({ where: { id: req.params.id, empresaId: eid(req) } });
    res.json({ ok: true });
  }),
);

rotasConteudo.get(
  "/comunicados/:id/imagem",
  rota(async (req, res) => {
    const c = await prisma.comunicado.findFirst({ where: { id: req.params.id, empresaId: eid(req) } });
    if (!c?.imagem) throw naoEncontrado("Imagem");
    res.sendFile(caminhoAbsoluto(c.imagem));
  }),
);

// ---------- Documentos para o funcionário ----------

const esquemaDocumento = z.object({
  tipo: z.enum(Object.keys(TIPOS_DOCUMENTO) as [string, ...string[]]),
  competencia: z.string().regex(/^\d{4}-\d{2}$/, "Informe o mês de referência"),
  titulo: z.string().trim().max(120).nullable().optional().transform((v) => v || null),
  exigeAssinatura: z.boolean().default(true),
  arquivo: z.string().min(50, "Anexe o arquivo"),
});

async function criarDocumento(req: Parameters<typeof sessao>[0], funcionarioId: string, d: z.infer<typeof esquemaDocumento>) {
  const arq = await salvarArquivo(eid(req), "documento", d.arquivo);
  const doc = await prisma.documento.create({
    data: {
      empresaId: eid(req), funcionarioId, tipo: d.tipo, competencia: d.competencia, titulo: d.titulo,
      // PENDENTE até o funcionário abrir (VISUALIZADO) ou assinar (ASSINADO)
      arquivo: arq.caminho, hash: arq.hash, exigeAssinatura: d.exigeAssinatura, criadoPor: sessao(req).usuarioId,
    },
  });
  const mes = d.competencia.split("-").reverse().join("/");
  notificarFuncionarios(eid(req), [funcionarioId], "Novo documento", `${TIPOS_DOCUMENTO[d.tipo]} de ${mes} disponível no app.`, "/ponto#arquivos");
  return doc;
}

rotasConteudo.get(
  "/documentos",
  rota(async (req, res) => {
    const q = z.object({ competencia: z.string().optional(), funcionarioId: z.string().optional() }).parse(req.query);
    const lista = await prisma.documento.findMany({
      where: { empresaId: eid(req), ...(q.competencia ? { competencia: q.competencia } : {}), ...(q.funcionarioId ? { funcionarioId: q.funcionarioId } : {}) },
      include: { funcionario: { select: { nome: true, matricula: true } } },
      orderBy: [{ competencia: "desc" }, { criadoEm: "desc" }],
      take: 500,
    });
    res.json(lista.map(({ arquivo, ...d }) => d));
  }),
);

rotasConteudo.post(
  "/documentos",
  rota(async (req, res) => {
    const { funcionarioId } = z.object({ funcionarioId: z.string() }).parse(req.body);
    if (!(await prisma.funcionario.findFirst({ where: { id: funcionarioId, empresaId: eid(req) } }))) throw naoEncontrado("Funcionário");
    res.status(201).json(await criarDocumento(req, funcionarioId, esquemaDocumento.parse(req.body)));
  }),
);

/**
 * Envio em lote: um arquivo por vez, identificando o funcionário pelo nome do arquivo,
 * que deve conter o CPF (só números) ou a matrícula. Ex.: "52998224725.pdf", "contracheque_001.pdf".
 */
rotasConteudo.post(
  "/documentos/lote",
  rota(async (req, res) => {
    const d = esquemaDocumento.parse(req.body);
    const { nomeArquivo } = z.object({ nomeArquivo: z.string().min(1) }).parse(req.body);
    const base = nomeArquivo.replace(/\.[^.]+$/, "");
    const numeros = base.replace(/\D/g, "");
    const funcionarios = await prisma.funcionario.findMany({ where: { empresaId: eid(req), ativo: true } });
    const porCpf = numeros.length >= 11 ? funcionarios.find((f) => numeros.includes(f.cpf)) : undefined;
    const partes = base.split(/[^A-Za-z0-9]+/).filter(Boolean);
    const porMatricula = funcionarios.filter((f) => f.matricula && partes.includes(f.matricula));
    const f = porCpf ?? (porMatricula.length === 1 ? porMatricula[0] : undefined);
    if (!f) throw new ErroHttp(422, porMatricula.length > 1 ? "mais de um funcionário com essa matrícula" : "nenhum funcionário com esse CPF ou matrícula no nome do arquivo");
    await criarDocumento(req, f.id, d);
    res.status(201).json({ funcionario: f.nome });
  }),
);

rotasConteudo.delete(
  "/documentos/:id",
  rota(async (req, res) => {
    const d = await prisma.documento.findFirst({ where: { id: req.params.id, empresaId: eid(req) } });
    if (!d) throw naoEncontrado("Documento");
    if (d.status === "ASSINADO") throw new ErroHttp(409, "Documento já assinado pelo funcionário não pode ser removido");
    await prisma.documento.delete({ where: { id: d.id } });
    res.json({ ok: true });
  }),
);

rotasConteudo.get(
  "/documentos/:id/arquivo",
  rota(async (req, res) => {
    const d = await prisma.documento.findFirst({ where: { id: req.params.id, empresaId: eid(req) } });
    if (!d) throw naoEncontrado("Documento");
    res.sendFile(caminhoAbsoluto(d.arquivo));
  }),
);

// ---------- Marca e suporte ----------

rotasConteudo.get(
  "/marca",
  rota(async (req, res) => {
    const e = await prisma.empresa.findUniqueOrThrow({ where: { id: eid(req) } });
    res.json({
      temLogo: !!e.logo, suporteWhatsapp: e.suporteWhatsapp, suporteTelefone: e.suporteTelefone,
      suporteEmail: e.suporteEmail, suporteHorario: e.suporteHorario,
    });
  }),
);

rotasConteudo.put(
  "/marca",
  rota(async (req, res) => {
    const opc = z.string().trim().max(120).nullable().optional().transform((v) => v || null);
    const d = z
      .object({ logo: z.string().nullable().optional(), suporteWhatsapp: opc, suporteTelefone: opc, suporteEmail: opc, suporteHorario: opc })
      .parse(req.body);
    await prisma.empresa.update({
      where: { id: eid(req) },
      data: {
        suporteWhatsapp: d.suporteWhatsapp, suporteTelefone: d.suporteTelefone, suporteEmail: d.suporteEmail, suporteHorario: d.suporteHorario,
        ...(d.logo ? { logo: (await salvarArquivo(eid(req), "logo", d.logo, { soImagem: true })).caminho } : {}),
      },
    });
    res.json({ ok: true });
  }),
);
