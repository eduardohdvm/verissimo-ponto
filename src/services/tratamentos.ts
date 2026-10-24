// Ajustes de ponto (inclusão, desconsiderar marcação, abono). A marcação original nunca muda.
import { z } from "zod";
import { prisma } from "../db.js";
import { naoEncontrado } from "../lib/erros.js";
import { utcDeLocal } from "../lib/tempo.js";
import { garantirPeriodoAberto } from "./fechamentos.js";

export const esquemaTratamento = z
  .object({
    tipo: z.enum(["INCLUSAO", "DESCONSIDERAR", "ABONO"]),
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    hora: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    marcacaoId: z.string().optional(),
    motivo: z.string().min(3, "Informe o motivo"),
  })
  .refine((t) => t.tipo !== "INCLUSAO" || t.hora, "Informe o horário a incluir")
  .refine((t) => t.tipo !== "DESCONSIDERAR" || t.marcacaoId, "Informe a marcação a desconsiderar");

/** Cria um tratamento; usado pelo gestor (já aprovado) e pelo funcionário (pendente). */
export async function criarTratamento(
  empresaId: string,
  funcionarioId: string,
  usuarioId: string,
  corpo: unknown,
  aprovado: boolean,
) {
  const t = esquemaTratamento.parse(corpo);
  await garantirPeriodoAberto(empresaId, t.data);
  const emp = await prisma.empresa.findUniqueOrThrow({ where: { id: empresaId } });
  if (t.marcacaoId) {
    const m = await prisma.marcacao.findFirst({ where: { id: t.marcacaoId, funcionarioId, empresaId } });
    if (!m) throw naoEncontrado("Marcação");
  }
  return prisma.tratamento.create({
    data: {
      empresaId,
      funcionarioId,
      tipo: t.tipo,
      data: t.data,
      dataHora: t.tipo === "INCLUSAO" ? utcDeLocal(t.data, t.hora!, emp.fusoHorario) : null,
      marcacaoId: t.tipo === "DESCONSIDERAR" ? t.marcacaoId : null,
      motivo: t.motivo,
      solicitadoPor: usuarioId,
      ...(aprovado ? { status: "APROVADO", decididoPor: usuarioId, decididoEm: new Date() } : {}),
    },
  });
}
