import { z } from "zod";
import { prisma } from "../db.js";
import { salvarAnexo } from "./arquivos.js";
import { garantirSemFechamento } from "./fechamentos.js";

export const TIPOS_AFASTAMENTO = ["FERIAS", "ATESTADO", "LICENCA", "FOLGA", "OUTRO"] as const;

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida");
export const esquemaAfastamento = z
  .object({
    tipo: z.enum(TIPOS_AFASTAMENTO),
    inicio: data,
    fim: data,
    observacao: z.string().trim().max(500).optional().nullable(),
    anexo: z.string().optional().nullable(), // data URL de foto ou PDF
  })
  .refine((a) => a.inicio <= a.fim, "A data final é antes da inicial");

export async function criarAfastamento(
  empresaId: string,
  funcionarioId: string,
  usuarioId: string,
  corpo: unknown,
  aprovado: boolean,
) {
  const a = esquemaAfastamento.parse(corpo);
  await garantirSemFechamento(empresaId, a.inicio, a.fim);
  return prisma.afastamento.create({
    data: {
      empresaId,
      funcionarioId,
      tipo: a.tipo,
      inicio: a.inicio,
      fim: a.fim,
      observacao: a.observacao || null,
      anexo: a.anexo ? await salvarAnexo(empresaId, "afastamento", a.anexo) : null,
      solicitadoPor: usuarioId,
      status: aprovado ? "APROVADO" : "PENDENTE",
      ...(aprovado ? { decididoPor: usuarioId, decididoEm: new Date() } : {}),
    },
  });
}
