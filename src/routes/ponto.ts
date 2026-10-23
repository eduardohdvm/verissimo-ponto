// Rotas do próprio trabalhador: bater ponto, ver o dia, espelho e pedir ajustes.
import { Router } from "express";
import { z } from "zod";
import { autenticar } from "../auth.js";
import { prisma } from "../db.js";
import { ErroHttp, naoEncontrado } from "../lib/erros.js";
import { partesLocais, somarDias, utcDeLocal } from "../lib/tempo.js";
import { gerarEspelho, periodoDoMes } from "../services/espelho.js";
import { criarDesafio } from "../services/facial.js";
import { montarComprovante, registrarMarcacao } from "../services/marcacoes.js";
import { criarTratamento } from "./admin.js";
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
    const marcacoes = await prisma.marcacao.findMany({
      where: { funcionarioId: fid, dataHora: { gte: utcDeLocal(hoje, "00:00", fuso), lt: utcDeLocal(somarDias(hoje, 1), "00:00", fuso) } },
      orderBy: { dataHora: "asc" },
    });
    res.json({
      funcionario: {
        nome: f.nome,
        exigeSelfie: f.exigeSelfie,
        exigeGps: f.exigeGps,
        exigeFacial: f.exigeFacial,
        rostoCadastrado: !!f.descritorFacial,
      },
      empresa: f.empresa.razaoSocial,
      hoje,
      marcacoes: marcacoes.map((m) => ({ id: m.id, nsr: m.nsr, hora: partesLocais(m.dataHora, fuso).hora })),
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
    res.status(201).json(t);
  }),
);
