// Regras de cálculo configuráveis por empresa (convenção coletiva): percentuais de hora extra
// por faixa, domingo/feriado, hora noturna e banco de horas. Guardadas em Empresa.regras (JSON).
import { z } from "zod";

const faixa = z.object({
  ateMin: z.number().int().positive().nullable(), // minutos extras do dia cobertos por esta faixa; null = o resto
  percentual: z.number().int().min(0).max(300),
});

export const esquemaRegras = z.object({
  faixasExtra: z.array(faixa).min(1).max(5),
  percentualDomingoFeriado: z.number().int().min(0).max(300),
  adicionalNoturnoPercentual: z.number().int().min(0).max(100),
  horaNoturnaReduzida: z.boolean(),
  bancoHoras: z.object({
    ativo: z.boolean(),
    validadeMeses: z.number().int().min(1).max(12), // CLT art. 59 §5º: acordo individual até 6 meses; coletivo até 12
  }),
});

export type Regras = z.infer<typeof esquemaRegras>;

export const REGRAS_PADRAO: Regras = {
  faixasExtra: [{ ateMin: null, percentual: 50 }],
  percentualDomingoFeriado: 100,
  adicionalNoturnoPercentual: 20,
  horaNoturnaReduzida: true,
  bancoHoras: { ativo: true, validadeMeses: 6 },
};

/** Lê as regras salvas, completando com o padrão o que faltar. */
export function lerRegras(json: string | null | undefined): Regras {
  try {
    const salvo = JSON.parse(json || "{}");
    return esquemaRegras.parse({ ...REGRAS_PADRAO, ...salvo, bancoHoras: { ...REGRAS_PADRAO.bancoHoras, ...salvo.bancoHoras } });
  } catch {
    return REGRAS_PADRAO;
  }
}

/** Divide os minutos extras de um dia útil pelas faixas: ex. 2h a 50% e o resto a 100%. */
export function distribuirExtras(minutos: number, faixas: Regras["faixasExtra"]): Record<string, number> {
  const r: Record<string, number> = {};
  let resta = minutos;
  for (const f of faixas) {
    if (resta <= 0) break;
    const aqui = f.ateMin === null ? resta : Math.min(resta, f.ateMin);
    r[f.percentual] = (r[f.percentual] ?? 0) + aqui;
    resta -= aqui;
  }
  if (resta > 0) {
    const ultimo = faixas[faixas.length - 1].percentual;
    r[ultimo] = (r[ultimo] ?? 0) + resta;
  }
  return r;
}
