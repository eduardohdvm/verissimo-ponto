// Quem enxerga quais funcionários: o ADMIN vê a empresa toda; o GESTOR, só os
// funcionários dos departamentos que ele gere. Toda rota do RH que lê ou altera
// dados de funcionário passa por aqui.
import type { Prisma } from "@prisma/client";
import type { Sessao } from "../auth.js";
import { prisma } from "../db.js";
import { naoEncontrado } from "../lib/erros.js";

export async function departamentosDoGestor(usuarioId: string): Promise<string[]> {
  const deps = await prisma.gestorDepartamento.findMany({ where: { usuarioId }, select: { departamentoId: true } });
  return deps.map((d) => d.departamentoId);
}

export async function filtroFuncionarios(s: Sessao): Promise<Prisma.FuncionarioWhereInput> {
  if (s.papel === "ADMIN") return { empresaId: s.empresaId };
  return { empresaId: s.empresaId, departamentoId: { in: await departamentosDoGestor(s.usuarioId) } };
}

/** Garante que o funcionário existe e está no escopo de quem pede; senão, 404. */
export async function funcionarioNoEscopo(s: Sessao, funcionarioId: string) {
  const f = await prisma.funcionario.findFirst({ where: { id: funcionarioId, ...(await filtroFuncionarios(s)) } });
  if (!f) throw naoEncontrado("Funcionário");
  return f;
}
