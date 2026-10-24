// Modo quiosque: tablet da empresa onde vários funcionários batem ponto.
// O RH cadastra o quiosque e recebe um código; o tablet é pareado uma vez e passa a usar
// uma credencial própria (header X-Quiosque). Ponto por rosto (1:N) ou por matrícula + PIN.
import { createHash, randomBytes, randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { autenticar, exigirPapel } from "../auth.js";
import { prisma } from "../db.js";
import { ErroHttp, naoEncontrado } from "../lib/erros.js";
import { FACIAL_ATIVO } from "../lib/face.js";
import { bloqueioDaEmpresa } from "../services/conta.js";
import { criarDesafio, identificarRosto } from "../services/facial.js";
import { registrarMarcacao } from "../services/marcacoes.js";
import { rota, sessao } from "./util.js";

const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const VALIDADE_CODIGO_MS = 30 * 60_000;

async function novoCodigo() {
  for (;;) {
    const codigo = String(randomInt(100000, 1000000));
    if (!(await prisma.quiosque.findUnique({ where: { codigoPareamento: codigo } }))) return codigo;
  }
}

// ---------- Cadastro pelo RH (/api/admin/quiosques) ----------

export const rotasQuiosquesAdmin = Router();
rotasQuiosquesAdmin.use("/quiosques", autenticar, exigirPapel("ADMIN"));
const eid = (req: Parameters<typeof sessao>[0]) => sessao(req).empresaId;

const esquemaQuiosque = z.object({
  nome: z.string().trim().min(1, "Informe o nome"),
  localId: z.string().nullable().optional().transform((v) => v || null),
  permitePin: z.boolean().default(true),
  ativo: z.boolean().default(true),
});

rotasQuiosquesAdmin.get(
  "/quiosques",
  rota(async (req, res) => {
    const lista = await prisma.quiosque.findMany({ where: { empresaId: eid(req) }, orderBy: { nome: "asc" } });
    res.json(
      lista.map(({ tokenHash, codigoPareamento, codigoExpiraEm, ...q }) => ({
        ...q,
        pareado: !!tokenHash,
        codigo: codigoExpiraEm && codigoExpiraEm > new Date() ? codigoPareamento : null,
        codigoExpiraEm,
      })),
    );
  }),
);

rotasQuiosquesAdmin.post(
  "/quiosques",
  rota(async (req, res) => {
    const d = esquemaQuiosque.parse(req.body);
    if (d.localId && !(await prisma.localPermitido.findFirst({ where: { id: d.localId, empresaId: eid(req) } }))) throw naoEncontrado("Local");
    const q = await prisma.quiosque.create({
      data: { ...d, empresaId: eid(req), codigoPareamento: await novoCodigo(), codigoExpiraEm: new Date(Date.now() + VALIDADE_CODIGO_MS) },
    });
    res.status(201).json({ id: q.id, codigo: q.codigoPareamento });
  }),
);

async function quiosqueDaEmpresa(req: Parameters<typeof sessao>[0]) {
  const q = await prisma.quiosque.findFirst({ where: { id: req.params.id, empresaId: eid(req) } });
  if (!q) throw naoEncontrado("Quiosque");
  return q;
}

rotasQuiosquesAdmin.put(
  "/quiosques/:id",
  rota(async (req, res) => {
    const q = await quiosqueDaEmpresa(req);
    const d = esquemaQuiosque.parse(req.body);
    await prisma.quiosque.update({ where: { id: q.id }, data: d });
    res.json({ ok: true });
  }),
);

// Gera um novo código: o tablet atual é desconectado e outro pode ser pareado
rotasQuiosquesAdmin.post(
  "/quiosques/:id/codigo",
  rota(async (req, res) => {
    const q = await quiosqueDaEmpresa(req);
    const codigo = await novoCodigo();
    await prisma.quiosque.update({
      where: { id: q.id },
      data: { tokenHash: null, codigoPareamento: codigo, codigoExpiraEm: new Date(Date.now() + VALIDADE_CODIGO_MS) },
    });
    res.json({ codigo });
  }),
);

rotasQuiosquesAdmin.delete(
  "/quiosques/:id",
  rota(async (req, res) => {
    const q = await quiosqueDaEmpresa(req);
    await prisma.quiosque.delete({ where: { id: q.id } });
    res.json({ ok: true });
  }),
);

// ---------- Tablet (/api/quiosque) ----------

type Quiosque = NonNullable<Awaited<ReturnType<typeof prisma.quiosque.findUnique>>>;
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      quiosque?: Quiosque & { empresa: { razaoSocial: string; limiarFacial: number; bloqueada: boolean } };
    }
  }
}

export const rotasQuiosque = Router();

rotasQuiosque.post(
  "/parear",
  rota(async (req, res) => {
    const { codigo } = z.object({ codigo: z.string().regex(/^\d{6}$/, "O código tem 6 números") }).parse(req.body);
    const q = await prisma.quiosque.findUnique({ where: { codigoPareamento: codigo }, include: { empresa: true } });
    if (!q || !q.ativo || !q.codigoExpiraEm || q.codigoExpiraEm < new Date()) {
      throw new ErroHttp(400, "Código inválido ou expirado. Gere um novo no painel do RH.");
    }
    const token = randomBytes(32).toString("hex");
    await prisma.quiosque.update({
      where: { id: q.id },
      data: { tokenHash: hash(token), codigoPareamento: null, codigoExpiraEm: null, ultimoUso: new Date() },
    });
    res.json({ token, nome: q.nome, empresa: q.empresa.razaoSocial });
  }),
);

async function autenticarQuiosque(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = String(req.headers["x-quiosque"] ?? "");
    const q = token
      ? await prisma.quiosque.findUnique({
          where: { tokenHash: hash(token) },
          include: { empresa: { select: { razaoSocial: true, limiarFacial: true, bloqueada: true } } },
        })
      : null;
    if (!q || !q.ativo) throw new ErroHttp(401, "Este tablet não está pareado. Peça um código ao RH.");
    const motivo = await bloqueioDaEmpresa(q.empresaId);
    if (motivo) throw new ErroHttp(402, motivo);
    req.quiosque = q;
    prisma.quiosque.update({ where: { id: q.id }, data: { ultimoUso: new Date() } }).catch(() => {});
    next();
  } catch (e) {
    next(e);
  }
}

rotasQuiosque.use(autenticarQuiosque);

rotasQuiosque.get("/info", (req, res) => {
  const q = req.quiosque!;
  res.json({ nome: q.nome, empresa: q.empresa.razaoSocial, facial: FACIAL_ATIVO, permitePin: q.permitePin || !FACIAL_ATIVO });
});

rotasQuiosque.post(
  "/desafio",
  rota(async (req, res) => {
    if (!FACIAL_ATIVO) throw new ErroHttp(503, "Reconhecimento facial desligado neste servidor");
    res.json(criarDesafio(`quiosque:${req.quiosque!.id}`));
  }),
);

const resposta = async (funcionarioId: string, comprovante: Awaited<ReturnType<typeof registrarMarcacao>>) => {
  const f = await prisma.funcionario.findUniqueOrThrow({ where: { id: funcionarioId }, select: { nome: true } });
  return { nome: f.nome, ...comprovante };
};

rotasQuiosque.post(
  "/registrar-rosto",
  rota(async (req, res) => {
    const q = req.quiosque!;
    const d = z
      .object({
        desafioId: z.string(),
        quadros: z.array(z.object({ passo: z.enum(["FRENTE", "ESQUERDA", "DIREITA"]), imagem: z.string() })).length(2),
      })
      .parse(req.body);
    const id = await identificarRosto({ empresaId: q.empresaId, quiosqueId: q.id, limiar: q.empresa.limiarFacial, ...d, ip: req.ip });
    const c = await registrarMarcacao({
      empresaId: q.empresaId,
      funcionarioId: id.funcionarioId,
      origem: "QUIOSQUE",
      quiosque: { id: q.id, localId: q.localId },
      rostoVerificado: id,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    res.status(201).json(await resposta(id.funcionarioId, c));
  }),
);

// Tentativas erradas de PIN: 5 erros bloqueiam o funcionário no quiosque por 15 minutos
const errosPin = new Map<string, { n: number; ate: number }>();

rotasQuiosque.post(
  "/registrar-pin",
  rota(async (req, res) => {
    const q = req.quiosque!;
    if (!q.permitePin && FACIAL_ATIVO) throw new ErroHttp(403, "Este quiosque só aceita reconhecimento facial");
    const d = z
      .object({ identificador: z.string().trim().min(1, "Informe a matrícula ou o CPF"), pin: z.string(), foto: z.string().optional() })
      .parse(req.body);
    const cpf = d.identificador.replace(/\D/g, "");
    const f = await prisma.funcionario.findFirst({
      where: {
        empresaId: q.empresaId,
        ativo: true,
        OR: [{ matricula: d.identificador }, ...(cpf.length === 11 ? [{ cpf }] : [])],
      },
    });
    const chave = `${q.id}:${f?.id ?? d.identificador}`;
    const erro = errosPin.get(chave);
    if (erro && erro.ate > Date.now()) throw new ErroHttp(429, "Muitas tentativas erradas. Tente de novo em 15 minutos ou procure o RH.");
    if (!f || !f.pinHash || !(await bcrypt.compare(d.pin, f.pinHash))) {
      const n = (erro?.n ?? 0) + 1;
      errosPin.set(chave, { n: n >= 5 ? 0 : n, ate: n >= 5 ? Date.now() + 15 * 60_000 : 0 });
      throw new ErroHttp(401, f && !f.pinHash ? "Você ainda não tem PIN. Peça ao RH." : "Matrícula ou PIN incorretos");
    }
    errosPin.delete(chave);
    const c = await registrarMarcacao({
      empresaId: q.empresaId,
      funcionarioId: f.id,
      origem: "QUIOSQUE",
      quiosque: { id: q.id, localId: q.localId },
      selfieBase64: d.foto,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    res.status(201).json(await resposta(f.id, c));
  }),
);
