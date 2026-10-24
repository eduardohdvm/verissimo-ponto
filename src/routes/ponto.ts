// Rotas do próprio trabalhador: bater ponto, ver o dia, espelho e pedir ajustes.
import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { autenticar } from "../auth.js";
import { prisma } from "../db.js";
import { ErroHttp, naoEncontrado } from "../lib/erros.js";
import { partesLocais, somarDias, utcDeLocal } from "../lib/tempo.js";
import { gerarEspelho, periodoDoMes } from "../services/espelho.js";
import { FACIAL_ATIVO } from "../lib/face.js";
import { textoTermo, VERSAO_TERMO } from "../lib/lgpd.js";
import { criarDesafio } from "../services/facial.js";
import { montarComprovante, registrarMarcacao } from "../services/marcacoes.js";
import { criarAfastamento } from "../services/afastamentos.js";
import { comprovantePdf } from "../services/comprovante-pdf.js";
import { notificar, responsaveisPor } from "../services/notificacoes.js";
import { montarAssinatura } from "./admin-fechamentos.js";
import { criarTratamento } from "../services/tratamentos.js";
import { rota, sessao } from "./util.js";

export const rotasPonto = Router();
rotasPonto.use(autenticar);

function funcionarioDaSessao(req: Parameters<typeof sessao>[0]) {
  const id = sessao(req).funcionarioId;
  if (!id) throw new ErroHttp(403, "Seu usuário não está vinculado a um funcionário");
  return id;
}

const esquemaRegistro = z.object({
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  precisao: z.number().optional(),
  selfie: z.string().optional(),
  origem: z.enum(["WEB", "MOBILE"]).default("WEB"),
  dataHoraOffline: z.string().optional(),
  desafioId: z.string().optional(),
  quadros: z
    .array(z.object({ passo: z.enum(["FRENTE", "ESQUERDA", "DIREITA"]), imagem: z.string() }))
    .max(3)
    .optional(),
});

// Prova de vida: o servidor sorteia os movimentos que o funcionário deve fazer
rotasPonto.post(
  "/desafio",
  rota(async (req, res) => {
    res.json(criarDesafio(funcionarioDaSessao(req)));
  }),
);

rotasPonto.post(
  "/registrar",
  rota(async (req, res) => {
    const d = esquemaRegistro.parse(req.body);
    const u = await prisma.usuario.findUniqueOrThrow({ where: { id: sessao(req).usuarioId } });
    if (u.consentimentoVersao !== VERSAO_TERMO) throw new ErroHttp(428, "Leia e aceite o termo de uso dos seus dados antes de bater o ponto");
    const comprovante = await registrarMarcacao({
      empresaId: sessao(req).empresaId,
      funcionarioId: funcionarioDaSessao(req),
      origem: d.origem,
      latitude: d.latitude,
      longitude: d.longitude,
      precisaoGps: d.precisao,
      selfieBase64: d.selfie,
      dataHoraOffline: d.dataHoraOffline,
      desafioId: d.desafioId,
      quadros: d.quadros,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    res.status(201).json(comprovante);
  }),
);

rotasPonto.get(
  "/hoje",
  rota(async (req, res) => {
    const fid = funcionarioDaSessao(req);
    const f = await prisma.funcionario.findUniqueOrThrow({ where: { id: fid }, include: { empresa: true } });
    const fuso = f.empresa.fusoHorario;
    const hoje = partesLocais(new Date(), fuso).data;
    const [marcacoes, usuario, assinaturasPendentes, espelhoMes] = await Promise.all([
      prisma.marcacao.findMany({
        where: { funcionarioId: fid, dataHora: { gte: utcDeLocal(hoje, "00:00", fuso), lt: utcDeLocal(somarDias(hoje, 1), "00:00", fuso) } },
        orderBy: { dataHora: "asc" },
      }),
      prisma.usuario.findUniqueOrThrow({ where: { id: sessao(req).usuarioId } }),
      prisma.assinaturaEspelho.count({ where: { funcionarioId: fid, status: "PENDENTE", fechamento: { status: "FECHADO" } } }),
      gerarEspelho(f.empresaId, fid, `${hoje.slice(0, 7)}-01`, hoje).catch(() => null),
    ]);
    res.json({
      funcionario: {
        nome: f.nome,
        // Com o facial desligado no servidor, quem exige facial bate ponto com selfie simples
        exigeSelfie: f.exigeSelfie || (f.exigeFacial && !FACIAL_ATIVO),
        exigeGps: f.exigeGps,
        exigeFacial: f.exigeFacial && FACIAL_ATIVO,
        rostoCadastrado: !!f.descritorFacial,
      },
      empresa: f.empresa.razaoSocial,
      hoje,
      marcacoes: marcacoes.map((m) => ({ id: m.id, nsr: m.nsr, hora: partesLocais(m.dataHora, fuso).hora, dataHora: m.dataHora })),
      previstoHojeMin: espelhoMes?.dias.find((d) => d.data === hoje)?.previstoMin ?? 0,
      bancoMin: espelhoMes?.regras.bancoHoras ? espelhoMes.totais.bancoAcumuladoMin : null,
      assinaturasPendentes,
      consentimentoPendente: usuario.consentimentoVersao !== VERSAO_TERMO,
    });
  }),
);

rotasPonto.get(
  "/comprovante/:id",
  rota(async (req, res) => {
    const m = await prisma.marcacao.findFirst({
      where: { id: req.params.id, funcionarioId: funcionarioDaSessao(req) },
      include: { funcionario: true, empresa: true },
    });
    if (!m) throw naoEncontrado("Marcação");
    res.json(montarComprovante(m, m.funcionario, m.empresa));
  }),
);

rotasPonto.get(
  "/espelho",
  rota(async (req, res) => {
    const { mes } = z.object({ mes: z.string().regex(/^\d{4}-\d{2}$/) }).parse(req.query);
    const p = periodoDoMes(mes);
    res.json(await gerarEspelho(sessao(req).empresaId, funcionarioDaSessao(req), p.inicio, p.fim));
  }),
);

rotasPonto.get(
  "/tratamentos",
  rota(async (req, res) => {
    res.json(
      await prisma.tratamento.findMany({
        where: { funcionarioId: funcionarioDaSessao(req) },
        orderBy: { criadoEm: "desc" },
        take: 50,
      }),
    );
  }),
);

// O trabalhador solicita; o gestor aprova ou rejeita
rotasPonto.post(
  "/tratamentos",
  rota(async (req, res) => {
    const s = sessao(req);
    const t = await criarTratamento(s.empresaId, funcionarioDaSessao(req), s.usuarioId, req.body, false);
    avisarResponsaveis(s.empresaId, t.funcionarioId, "Novo pedido de ajuste", `pediu ajuste do dia ${t.data.split("-").reverse().join("/")}: ${t.motivo}`);
    res.status(201).json(t);
  }),
);

// Atestados e afastamentos enviados pelo próprio funcionário (ficam pendentes até o gestor aprovar)
rotasPonto.get(
  "/afastamentos",
  rota(async (req, res) => {
    const lista = await prisma.afastamento.findMany({
      where: { funcionarioId: funcionarioDaSessao(req) },
      orderBy: { inicio: "desc" },
      take: 50,
    });
    res.json(lista.map(({ anexo, ...a }) => ({ ...a, temAnexo: !!anexo })));
  }),
);

rotasPonto.post(
  "/afastamentos",
  rota(async (req, res) => {
    const s = sessao(req);
    const a = await criarAfastamento(s.empresaId, funcionarioDaSessao(req), s.usuarioId, req.body, false);
    avisarResponsaveis(s.empresaId, a.funcionarioId, "Atestado enviado", `enviou um atestado de ${a.inicio.split("-").reverse().join("/")}${a.fim !== a.inicio ? ` a ${a.fim.split("-").reverse().join("/")}` : ""}.`);
    res.status(201).json(a);
  }),
);

// ---------- Assinatura do espelho fechado ----------

rotasPonto.get(
  "/assinaturas",
  rota(async (req, res) => {
    const lista = await prisma.assinaturaEspelho.findMany({
      where: { funcionarioId: funcionarioDaSessao(req), fechamento: { status: "FECHADO" } },
      include: { fechamento: { select: { inicio: true, fim: true, fechadoEm: true } } },
      orderBy: { criadoEm: "desc" },
      take: 24,
    });
    res.json(
      lista.map((a) => ({
        id: a.id,
        inicio: a.fechamento.inicio,
        fim: a.fechamento.fim,
        status: a.status,
        assinadoEm: a.assinadoEm,
        saldoBancoMin: a.saldoBancoMin,
      })),
    );
  }),
);

async function minhaAssinatura(req: Parameters<typeof sessao>[0]) {
  const a = await prisma.assinaturaEspelho.findFirst({
    where: { id: req.params.id, funcionarioId: funcionarioDaSessao(req) },
    include: { fechamento: true },
  });
  if (!a) throw naoEncontrado("Espelho");
  return a;
}

rotasPonto.get(
  "/assinaturas/:id",
  rota(async (req, res) => {
    res.json(montarAssinatura(await minhaAssinatura(req)));
  }),
);

// Assinatura eletrônica: confirmada com a senha do funcionário; guarda data, IP e aparelho
rotasPonto.post(
  "/assinaturas/:id",
  rota(async (req, res) => {
    const d = z
      .object({ acao: z.enum(["ASSINAR", "CONTESTAR"]), senha: z.string().optional(), observacao: z.string().trim().optional() })
      .parse(req.body);
    const a = await minhaAssinatura(req);
    if (a.fechamento.status !== "FECHADO" || a.status !== "PENDENTE") throw new ErroHttp(409, "Este espelho não está aguardando assinatura");
    if (d.acao === "ASSINAR") {
      const u = await prisma.usuario.findUniqueOrThrow({ where: { id: sessao(req).usuarioId } });
      if (!d.senha || !(await bcrypt.compare(d.senha, u.senhaHash))) throw new ErroHttp(401, "Senha incorreta");
    } else if (!d.observacao || d.observacao.length < 5) {
      throw new ErroHttp(400, "Explique o que está errado no espelho");
    }
    await prisma.assinaturaEspelho.update({
      where: { id: a.id },
      data: {
        status: d.acao === "ASSINAR" ? "ASSINADO" : "CONTESTADO",
        assinadoEm: new Date(),
        ip: req.ip,
        userAgent: req.headers["user-agent"]?.slice(0, 300),
        observacao: d.acao === "CONTESTAR" ? d.observacao : null,
      },
    });
    if (d.acao === "CONTESTAR") {
      const f = await prisma.funcionario.findUniqueOrThrow({ where: { id: a.funcionarioId } });
      for (const r of await responsaveisPor(a.empresaId, f.departamentoId)) {
        await notificar(a.empresaId, r.id, "Espelho contestado", `${f.nome} contestou o espelho: ${d.observacao}`, "/admin#fechamento");
      }
    }
    res.json(montarAssinatura(await minhaAssinatura(req)));
  }),
);

function avisarResponsaveis(empresaId: string, funcionarioId: string, titulo: string, texto: string) {
  void (async () => {
    const f = await prisma.funcionario.findUniqueOrThrow({ where: { id: funcionarioId } });
    for (const r of await responsaveisPor(empresaId, f.departamentoId)) {
      await notificar(empresaId, r.id, titulo, `${f.nome} ${texto}`, "/admin#solicitacoes");
    }
  })().catch((e) => console.error("Erro ao avisar gestores:", e));
}

// ---------- Termo LGPD ----------

rotasPonto.get(
  "/termo",
  rota(async (req, res) => {
    const emp = await prisma.empresa.findUniqueOrThrow({ where: { id: sessao(req).empresaId } });
    res.json({ versao: VERSAO_TERMO, paragrafos: textoTermo(emp.razaoSocial) });
  }),
);

rotasPonto.post(
  "/consentimento",
  rota(async (req, res) => {
    const { versao } = z.object({ versao: z.literal(VERSAO_TERMO) }).parse(req.body);
    await prisma.usuario.update({
      where: { id: sessao(req).usuarioId },
      data: { consentimentoEm: new Date(), consentimentoVersao: versao },
    });
    res.json({ ok: true });
  }),
);

rotasPonto.get(
  "/comprovante/:id/pdf",
  rota(async (req, res) => {
    const m = await prisma.marcacao.findFirst({
      where: { id: req.params.id, funcionarioId: funcionarioDaSessao(req) },
      include: { funcionario: true, empresa: true },
    });
    if (!m) throw naoEncontrado("Marcação");
    const { pdf } = await comprovantePdf(montarComprovante(m, m.funcionario, m.empresa));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="comprovante-ponto-${m.nsr}.pdf"`);
    res.send(pdf);
  }),
);
