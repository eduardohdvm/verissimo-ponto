// Preferências de notificação de quem acompanha equipes (gestor e administrador).
// Guardadas em Usuario.preferenciasNotificacao (JSON). O que não foi configurado usa o padrão.
import { z } from "zod";

const canal = z.enum(["OFF", "APP", "APP_EMAIL"]); // APP = no painel/app e no celular (push)
export type Canal = z.infer<typeof canal>;

export const esquemaPreferencias = z.object({
  batida: z.object({ canal, modo: z.enum(["TODAS", "FORA_DO_HORARIO"]) }),
  atraso: z.object({ canal, minutos: z.union([z.literal(15), z.literal(30), z.literal(60)]) }),
  batidaFaltando: z.object({ canal, horasDepois: z.union([z.literal(1), z.literal(2), z.literal(4)]) }),
  horaExtra: z.object({ canal }),
  solicitacoes: z.object({ canal }),
  contestacoes: z.object({ canal }),
  facialRecusado: z.object({ canal }),
  resumoDiario: z.object({ canal, hora: z.string().regex(/^\d{2}:\d{2}$/) }),
});
export type Preferencias = z.infer<typeof esquemaPreferencias>;
export type EventoEquipe = keyof Preferencias;

// Padrão = o que o sistema já fazia antes das preferências existirem
export const PREFERENCIAS_PADRAO: Preferencias = {
  batida: { canal: "OFF", modo: "FORA_DO_HORARIO" },
  atraso: { canal: "APP", minutos: 15 },
  batidaFaltando: { canal: "APP", horasDepois: 2 },
  horaExtra: { canal: "OFF" },
  solicitacoes: { canal: "APP" },
  contestacoes: { canal: "APP" },
  facialRecusado: { canal: "OFF" },
  resumoDiario: { canal: "OFF", hora: "08:00" },
};

export function lerPreferencias(json: string | null | undefined): Preferencias {
  let salvo: Record<string, unknown> = {};
  try {
    salvo = JSON.parse(json || "{}");
  } catch {}
  const resultado = { ...PREFERENCIAS_PADRAO } as Record<string, unknown>;
  for (const [chave, padrao] of Object.entries(PREFERENCIAS_PADRAO)) {
    const item = esquemaPreferencias.shape[chave as EventoEquipe].safeParse({ ...padrao, ...(salvo[chave] as object) });
    resultado[chave] = item.success ? item.data : padrao;
  }
  return resultado as Preferencias;
}
