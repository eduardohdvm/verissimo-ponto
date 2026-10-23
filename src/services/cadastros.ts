// Validação dos cadastros, compartilhada entre o painel e a API de integração.
import { z } from "zod";

const hora = z.string().regex(/^\d{2}:\d{2}$/, "Use o formato HH:mm");
const intervalo = z.tuple([hora, hora]);
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato AAAA-MM-DD");

export const esquemaConfigJornada = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("SEMANAL"), dias: z.record(z.enum(["0", "1", "2", "3", "4", "5", "6"]), z.array(intervalo)) }),
  z.object({ tipo: z.literal("CICLO"), dataBase: data, ciclo: z.array(z.array(intervalo)).min(1) }),
]);

export const esquemaJornada = z.object({
  nome: z.string().min(1),
  config: esquemaConfigJornada,
  toleranciaMin: z.number().int().min(0).max(30).default(10),
});

export function validarCpf(cpf: string): boolean {
  const n = cpf.replace(/\D/g, "");
  if (n.length !== 11 || /^(\d)\1+$/.test(n)) return false;
  for (const t of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < t; i++) soma += +n[i] * (t + 1 - i);
    if (((soma * 10) % 11) % 10 !== +n[t]) return false;
  }
  return true;
}

export const esquemaFuncionario = z.object({
  nome: z.string().min(2),
  cpf: z
    .string()
    .transform((v) => v.replace(/\D/g, ""))
    .refine(validarCpf, "CPF inválido"),
  pis: z.string().optional().nullable(),
  matricula: z.string().optional().nullable(),
  cargo: z.string().optional().nullable(),
  admissao: data.optional().nullable(),
  ativo: z.boolean().optional(),
  exigeSelfie: z.boolean().optional(),
  exigeGps: z.boolean().optional(),
  exigeFacial: z.boolean().optional(),
  jornadaId: z.string().optional().nullable(),
  codigoExterno: z.string().optional().nullable(),
});

export function dadosFuncionario(d: z.infer<typeof esquemaFuncionario>) {
  return { ...d, admissao: d.admissao ? new Date(d.admissao + "T12:00:00Z") : d.admissao };
}

export const esquemaPeriodo = z.object({ inicio: data, fim: data }).refine((p) => p.inicio <= p.fim, "Período inválido");
