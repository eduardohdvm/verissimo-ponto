// Fechamento do período: depois de fechado, o espelho não muda mais (ajustes e
// afastamentos naquele período ficam bloqueados) e cada funcionário assina o seu.
import { prisma } from "../db.js";
import { ErroHttp } from "../lib/erros.js";

export async function periodoFechado(empresaId: string, data: string) {
  return prisma.fechamento.findFirst({
    where: { empresaId, status: "FECHADO", inicio: { lte: data }, fim: { gte: data } },
  });
}

/** Bloqueia se algum dia do intervalo cair num período fechado. */
export async function garantirSemFechamento(empresaId: string, inicio: string, fim: string) {
  const f = await prisma.fechamento.findFirst({
    where: { empresaId, status: "FECHADO", inicio: { lte: fim }, fim: { gte: inicio } },
  });
  if (f) {
    throw new ErroHttp(
      409,
      `Parte desse período (${f.inicio.split("-").reverse().join("/")} a ${f.fim.split("-").reverse().join("/")}) já foi fechada. Peça ao RH para reabrir.`,
    );
  }
}

export async function garantirPeriodoAberto(empresaId: string, ...datas: string[]) {
  for (const d of datas) {
    const f = await periodoFechado(empresaId, d);
    if (f) {
      throw new ErroHttp(
        409,
        `O período de ${f.inicio.split("-").reverse().join("/")} a ${f.fim.split("-").reverse().join("/")} já foi fechado. Peça ao RH para reabrir.`,
      );
    }
  }
}
