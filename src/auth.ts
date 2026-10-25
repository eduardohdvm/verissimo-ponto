import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "./db.js";
import { ErroHttp } from "./lib/erros.js";

export type Papel = "ADMIN" | "GESTOR" | "FUNCIONARIO";

export interface Sessao {
  usuarioId: string;
  empresaId: string;
  papel: Papel;
  funcionarioId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      sessao?: Sessao;
      empresaApiId?: string;
    }
  }
}

const SEGREDO = process.env.JWT_SECRET ?? "dev-inseguro";
if (!process.env.JWT_SECRET) console.warn("JWT_SECRET não definido: usando segredo de desenvolvimento");

export function gerarToken(s: Sessao): string {
  return jwt.sign(s, SEGREDO, { expiresIn: "12h" });
}

// O login (JWT) vale 12h, mas papel e situação do usuário podem mudar antes disso
// (gestor rebaixado, usuário desativado). Por isso, a cada requisição, o papel vem do banco,
// com um cache curto para não consultar a toda hora.
const cacheUsuarios = new Map<string, { ate: number; dados: Omit<Sessao, "usuarioId"> | null }>();

async function usuarioAtual(usuarioId: string) {
  const c = cacheUsuarios.get(usuarioId);
  if (c && c.ate > Date.now()) return c.dados;
  const u = await prisma.usuario.findUnique({
    where: { id: usuarioId },
    select: { ativo: true, empresaId: true, papel: true, funcionarioId: true, funcionario: { select: { ativo: true } } },
  });
  // Funcionário desativado no cadastro também perde o acesso
  const dados = u?.ativo && u.funcionario?.ativo !== false ? { empresaId: u.empresaId, papel: u.papel as Papel, funcionarioId: u.funcionarioId } : null;
  cacheUsuarios.set(usuarioId, { ate: Date.now() + 15_000, dados });
  return dados;
}

/** Chamar depois de mudar papel ou situação de um usuário, para valer na hora. */
export const esquecerUsuario = (usuarioId: string) => cacheUsuarios.delete(usuarioId);

export async function autenticar(req: Request, _res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer /, "");
  if (!token) return next(new ErroHttp(401, "Faça login"));
  let usuarioId: string;
  try {
    usuarioId = (jwt.verify(token, SEGREDO) as Sessao).usuarioId;
  } catch {
    return next(new ErroHttp(401, "Sessão expirada, faça login novamente"));
  }
  try {
    const atual = await usuarioAtual(usuarioId);
    if (!atual) return next(new ErroHttp(401, "Seu acesso foi desativado. Fale com o RH."));
    req.sessao = { usuarioId, ...atual };
    next();
  } catch (e) {
    next(e);
  }
}

export function exigirPapel(...papeis: Papel[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.sessao || !papeis.includes(req.sessao.papel)) return next(new ErroHttp(403, "Sem permissão"));
    next();
  };
}

export const hashApiKey = (chave: string) => createHash("sha256").update(chave).digest("hex");

/** Autenticação da API de integração (ERP) por chave: header "Authorization: Bearer pk_..." */
export async function autenticarApiKey(req: Request, _res: Response, next: NextFunction) {
  try {
    const chave = req.headers.authorization?.replace(/^Bearer /, "") ?? String(req.headers["x-api-key"] ?? "");
    if (!chave.startsWith("pk_")) throw new ErroHttp(401, "Chave de API ausente ou inválida");
    const registro = await prisma.apiKey.findUnique({ where: { hash: hashApiKey(chave) } });
    if (!registro || registro.revogadaEm) throw new ErroHttp(401, "Chave de API ausente ou inválida");
    req.empresaApiId = registro.empresaId;
    await prisma.apiKey.update({ where: { id: registro.id }, data: { ultimoUso: new Date() } });
    next();
  } catch (e) {
    next(e);
  }
}
