// Motor de cálculo de jornada. Funções puras, sem acesso ao banco, para facilitar testes.
import { distribuirExtras, REGRAS_PADRAO, type Regras } from "./regras.js";
import { diasEntre, horaParaMin, offsetMs, partesLocais } from "./tempo.js";

export type Intervalo = [string, string]; // ["08:00","12:00"]; fim < início = vira o dia

/**
 * SEMANAL: horários por dia da semana (0 = domingo).
 * CICLO: padrão que se repete a partir de dataBase (ex.: 12x36 = [[["07:00","19:00"]], []]).
 */
export type ConfigJornada =
  | { tipo: "SEMANAL"; dias: Record<string, Intervalo[]> }
  | { tipo: "CICLO"; dataBase: string; ciclo: Intervalo[][] };

export interface JornadaCalc {
  config: ConfigJornada;
  toleranciaMin: number;
}

export type Ocorrencia =
  | "FALTA"
  | "ATRASO"
  | "MARCACAO_IMPAR"
  | "INTERVALO_INSUFICIENTE"
  | "INTERJORNADA_INSUFICIENTE"
  | "HORA_EXTRA_ACIMA_LIMITE";

export interface ResultadoDia {
  data: string;
  marcacoes: { hora: string; incluida: boolean }[]; // incluida = veio de tratamento
  previstoMin: number;
  trabalhadoMin: number;
  extraMin: number;
  extras: Record<string, number>; // minutos extras por percentual, ex.: { "50": 120, "100": 30 }
  debitoMin: number;
  atrasoMin: number; // quanto a primeira entrada passou do horário (além da tolerância)
  noturnoMin: number; // minutos reais entre 22h e 5h
  noturnoReduzidoMin: number; // convertidos pela hora noturna de 52m30s (se a regra estiver ligada)
  abonado: boolean;
  afastamento: string | null; // FERIAS | ATESTADO | LICENCA | FOLGA | OUTRO
  feriado: string | null;
  ocorrencias: Ocorrencia[];
}

export interface Turno {
  data: string; // dia do turno = dia local da primeira marcação
  marcas: Date[];
}

const LIMITE_NOVO_TURNO_MS = 8 * 3600_000; // intervalo maior que isso inicia outro turno
const LIMITE_SAIDA_MS = 16 * 3600_000; // entrada sem saída por mais tempo que isso = esqueceu de marcar
const NOITE_INICIO = 22 * 60;
const NOITE_FIM = 5 * 60;

export function intervalosPrevistos(j: ConfigJornada, data: string): Intervalo[] {
  if (j.tipo === "SEMANAL") {
    const dia = new Date(data + "T00:00:00Z").getUTCDay();
    return j.dias[String(dia)] ?? [];
  }
  if (!j.ciclo.length) return [];
  const diff = Math.round((Date.parse(data) - Date.parse(j.dataBase)) / 86400_000);
  const n = j.ciclo.length;
  return j.ciclo[((diff % n) + n) % n];
}

export function minutosPrevistos(intervalos: Intervalo[]): number {
  return intervalos.reduce((soma, [ini, fim]) => {
    let d = horaParaMin(fim) - horaParaMin(ini);
    if (d < 0) d += 1440;
    return soma + d;
  }, 0);
}

/**
 * Agrupa marcações em turnos. Assim um turno noturno (22h às 6h) fica inteiro
 * no dia em que começou, em vez de ser partido à meia-noite.
 */
export function agruparTurnos(marcas: Date[], fuso: string): Turno[] {
  const ordenadas = [...marcas].sort((a, b) => a.getTime() - b.getTime());
  const turnos: Turno[] = [];
  for (const m of ordenadas) {
    const atual = turnos[turnos.length - 1];
    const ultima = atual?.marcas[atual.marcas.length - 1];
    // Com uma entrada em aberto, a próxima marcação é a saída (turnos de 12h sem intervalo)
    const limite = atual && atual.marcas.length % 2 === 1 ? LIMITE_SAIDA_MS : LIMITE_NOVO_TURNO_MS;
    if (atual && ultima && m.getTime() - ultima.getTime() <= limite) {
      atual.marcas.push(m);
    } else {
      turnos.push({ data: partesLocais(m, fuso).data, marcas: [m] });
    }
  }
  return turnos;
}

function minutosNoturnos(inicio: Date, fim: Date, fuso: string): number {
  const off = offsetMs(inicio, fuso);
  let total = 0;
  for (let t = inicio.getTime(); t < fim.getTime(); t += 60_000) {
    const minDia = Math.floor((t + off) / 60_000) % 1440;
    if (minDia >= NOITE_INICIO || minDia < NOITE_FIM) total++;
  }
  return total;
}

export interface EntradaCalculo {
  dias: string[];
  turnos: Turno[];
  jornada: JornadaCalc | null;
  fuso: string;
  feriados: Map<string, string>;
  abonos: Set<string>;
  afastamentos?: Map<string, string>; // dia -> tipo (férias, atestado...)
  incluidas?: Set<number>; // timestamps das marcações vindas de tratamento de inclusão
  regras?: Regras;
}

export function calcularPeriodo(e: EntradaCalculo): ResultadoDia[] {
  const turnosPorDia = new Map<string, Turno[]>();
  for (const t of e.turnos) {
    const lista = turnosPorDia.get(t.data) ?? [];
    lista.push(t);
    turnosPorDia.set(t.data, lista);
  }

  // Fim do último turno anterior ao período, para checar interjornada no primeiro dia
  let fimTurnoAnterior: Date | null = null;
  const primeiro = e.dias[0];
  for (const t of e.turnos) {
    if (t.data < primeiro) fimTurnoAnterior = t.marcas[t.marcas.length - 1];
  }

  return e.dias.map((data) => {
    const turnos = turnosPorDia.get(data) ?? [];
    const intervalos = e.jornada ? intervalosPrevistos(e.jornada.config, data) : [];
    const previstoMin = minutosPrevistos(intervalos);
    const tolerancia = e.jornada?.toleranciaMin ?? 10;
    const feriado = e.feriados.get(data) ?? null;
    const afastamento = e.afastamentos?.get(data) ?? null;
    // Afastamento aprovado (férias, atestado...) funciona como abono: sem falta e sem débito
    const abonado = e.abonos.has(data) || afastamento !== null;
    const domingo = new Date(data + "T00:00:00Z").getUTCDay() === 0;
    const regras = e.regras ?? REGRAS_PADRAO;
    const ocorrencias = new Set<Ocorrencia>();

    let trabalhadoMs = 0;
    let noturnoMin = 0;
    let maiorIntervaloMs = 0;
    const marcasDoDia: Date[] = [];

    for (const turno of turnos) {
      const m = turno.marcas;
      marcasDoDia.push(...m);
      if (m.length % 2 === 1) ocorrencias.add("MARCACAO_IMPAR");
      if (fimTurnoAnterior && m[0].getTime() - fimTurnoAnterior.getTime() < 11 * 3600_000) {
        ocorrencias.add("INTERJORNADA_INSUFICIENTE");
      }
      for (let i = 0; i + 1 < m.length; i += 2) {
        trabalhadoMs += m[i + 1].getTime() - m[i].getTime();
        noturnoMin += minutosNoturnos(m[i], m[i + 1], e.fuso);
        if (i + 2 < m.length) {
          maiorIntervaloMs = Math.max(maiorIntervaloMs, m[i + 2].getTime() - m[i + 1].getTime());
        }
      }
      fimTurnoAnterior = m[m.length - 1];
    }

    const trabalhadoMin = Math.round(trabalhadoMs / 60_000);
    let extraMin = 0;
    let extras: Record<string, number> = {};
    let debitoMin = 0;
    let atrasoMin = 0;

    if (previstoMin === 0 || feriado) {
      // Dia sem jornada prevista: tudo que for trabalhado é extra
      extraMin = trabalhadoMin;
      extras = domingo || feriado
        ? { [regras.percentualDomingoFeriado]: trabalhadoMin }
        : distribuirExtras(trabalhadoMin, regras.faixasExtra);
    } else {
      const saldo = trabalhadoMin - previstoMin;
      if (Math.abs(saldo) > tolerancia) {
        if (saldo > 0) {
          extraMin = saldo;
          extras = distribuirExtras(saldo, regras.faixasExtra);
        } else if (!abonado) debitoMin = -saldo;
      }
      if (turnos.length === 0 && !abonado) ocorrencias.add("FALTA");
      // Atraso: primeira entrada depois do início previsto, além da tolerância
      if (marcasDoDia.length && intervalos.length && !abonado) {
        const diff = partesLocais(marcasDoDia[0], e.fuso).minutoDoDia - horaParaMin(intervalos[0][0]);
        if (diff > tolerancia && diff < 12 * 60) {
          atrasoMin = diff;
          ocorrencias.add("ATRASO");
        }
      }
    }
    if (trabalhadoMin === 0) extras = {};

    // CLT art. 71: mais de 6h de trabalho exige intervalo mínimo de 1h
    if (trabalhadoMin > 360 && maiorIntervaloMs < 3600_000) ocorrencias.add("INTERVALO_INSUFICIENTE");
    // CLT art. 59: limite de 2h extras por dia
    if (previstoMin > 0 && extraMin > 120) ocorrencias.add("HORA_EXTRA_ACIMA_LIMITE");

    return {
      data,
      marcacoes: marcasDoDia.map((m) => ({
        hora: partesLocais(m, e.fuso).hora,
        incluida: e.incluidas?.has(m.getTime()) ?? false,
      })),
      previstoMin,
      trabalhadoMin,
      extraMin,
      extras,
      debitoMin,
      atrasoMin,
      noturnoMin,
      noturnoReduzidoMin: regras.horaNoturnaReduzida ? Math.round((noturnoMin * 60) / 52.5) : noturnoMin,
      abonado,
      afastamento,
      feriado,
      ocorrencias: [...ocorrencias],
    };
  });
}

export interface Totais {
  previstoMin: number;
  trabalhadoMin: number;
  extraMin: number;
  extras: Record<string, number>;
  debitoMin: number;
  atrasoMin: number;
  atrasos: number;
  noturnoReduzidoMin: number;
  faltas: number;
  diasAfastado: number;
  saldoBancoMin: number; // saldo do período (extras - débitos)
}

export function totalizar(dias: ResultadoDia[]): Totais {
  const t: Totais = {
    previstoMin: 0,
    trabalhadoMin: 0,
    extraMin: 0,
    extras: {},
    debitoMin: 0,
    atrasoMin: 0,
    atrasos: 0,
    noturnoReduzidoMin: 0,
    faltas: 0,
    diasAfastado: 0,
    saldoBancoMin: 0,
  };
  for (const d of dias) {
    t.previstoMin += d.previstoMin;
    t.trabalhadoMin += d.trabalhadoMin;
    t.extraMin += d.extraMin;
    for (const [p, min] of Object.entries(d.extras)) t.extras[p] = (t.extras[p] ?? 0) + min;
    t.debitoMin += d.debitoMin;
    t.atrasoMin += d.atrasoMin;
    t.noturnoReduzidoMin += d.noturnoReduzidoMin;
    if (d.ocorrencias.includes("FALTA")) t.faltas++;
    if (d.ocorrencias.includes("ATRASO")) t.atrasos++;
    if (d.afastamento && d.previstoMin > 0) t.diasAfastado++;
  }
  t.saldoBancoMin = t.extraMin - t.debitoMin;
  return t;
}

export { diasEntre };
