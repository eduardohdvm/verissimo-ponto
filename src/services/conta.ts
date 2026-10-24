// Situação da conta da empresa (plano, teste, bloqueio) e o "dono do SaaS" (superadmin).
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db.js";
import { ErroHttp } from "../lib/erros.js";
import { motivoBloqueio } from "../lib/planos.js";

// Cache curto para não consultar a empresa a cada requisição
const cache = new Map<string, { ate: number; motivo: string | null }>();

export async function bloqueioDaEmpresa(empresaId: string): Promise<string | null> {
  const c = cache.get(empresaId);
  if (c && c.ate > Date.now()) return c.motivo;
  const e = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { plano: true, bloqueada: true, trialAte: true } });
  const motivo = e ? motivoBloqueio(e) : "Empresa não encontrada";
  cache.set(empresaId, { ate: Date.now() + 30_000, motivo });
  return motivo;
}

export const limparCacheConta = (empresaId: string) => cache.delete(empresaId);

/** Bloqueia o uso quando o teste acabou ou a empresa foi suspensa. `livres`: caminhos que continuam abertos. */
export function exigirEmpresaAtiva(livres: string[] = []) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const empresaId = req.sessao?.empresaId ?? req.empresaApiId;
      if (empresaId && !livres.some((p) => req.path.startsWith(p))) {
        const motivo = await bloqueioDaEmpresa(empresaId);
        if (motivo) throw new ErroHttp(402, motivo);
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

export const ehSuperadmin = (email: string) =>
  (process.env.SUPERADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());
