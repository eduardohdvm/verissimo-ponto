// Planos do SaaS. Os preços e limites abaixo são um ponto de partida: ajuste à sua tabela.
// Preço em reais por funcionário ativo por mês.
export interface Plano {
  nome: string;
  limiteFuncionarios: number | null; // null = sem limite
  precoPorFuncionario: number;
}

export const PLANOS: Record<string, Plano> = {
  TRIAL: { nome: "Teste grátis", limiteFuncionarios: 15, precoPorFuncionario: 0 },
  BASICO: { nome: "Básico", limiteFuncionarios: 50, precoPorFuncionario: 8 },
  PRO: { nome: "Profissional", limiteFuncionarios: null, precoPorFuncionario: 12 },
};

export const DIAS_TESTE = 14;

export const limiteFuncionarios = (plano: string) => (PLANOS[plano] ?? PLANOS.TRIAL).limiteFuncionarios;

export interface SituacaoEmpresa {
  plano: string;
  bloqueada: boolean;
  trialAte: Date | null;
}

/** Motivo do bloqueio de acesso, ou null se a empresa pode usar o sistema. */
export function motivoBloqueio(e: SituacaoEmpresa, agora = new Date()): string | null {
  if (e.bloqueada) return "O acesso desta empresa está suspenso. Fale com o suporte.";
  if (e.plano === "TRIAL" && e.trialAte && e.trialAte < agora) {
    return "O período de teste terminou. Fale com a gente para contratar um plano e continuar usando.";
  }
  return null;
}
