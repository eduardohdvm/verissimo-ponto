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

export function autenticar(req: Request, _res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer /, "");
  if (!token) return next(new ErroHttp(401, "Faça login"));
  try {
    const { usuarioId, empresaId, papel, funcionarioId } = jwt.verify(token, SEGREDO) as Sessao;
    req.sessao = { usuarioId, empresaId, papel, funcionarioId };
    next();
  } catch {
    next(new ErroHttp(401, "Sessão expirada, faça login novamente"));
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
