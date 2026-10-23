// Conversões entre UTC (como tudo é gravado) e o horário local da empresa.

export interface PartesLocais {
  data: string; // AAAA-MM-DD
  hora: string; // HH:mm
  minutoDoDia: number;
  diaSemana: number; // 0 = domingo
}

const formatadores = new Map<string, Intl.DateTimeFormat>();

function formatador(fuso: string) {
  let f = formatadores.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: fuso,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatadores.set(fuso, f);
  }
  return f;
}

/** Diferença, em ms, entre o horário local do fuso e o UTC naquele instante. */
export function offsetMs(instante: Date, fuso: string): number {
  const p = Object.fromEntries(formatador(fuso).formatToParts(instante).map((x) => [x.type, x.value]));
  const comoUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return comoUtc - Math.floor(instante.getTime() / 1000) * 1000;
}

export function partesLocais(instante: Date, fuso: string): PartesLocais {
  const local = new Date(instante.getTime() + offsetMs(instante, fuso));
  const data = local.toISOString().slice(0, 10);
  const hora = local.toISOString().slice(11, 16);
  return {
    data,
    hora,
    minutoDoDia: local.getUTCHours() * 60 + local.getUTCMinutes(),
    diaSemana: local.getUTCDay(),
  };
}

/** Converte data + hora locais da empresa em um instante UTC. */
export function utcDeLocal(data: string, hora: string, fuso: string): Date {
  const [a, m, d] = data.split("-").map(Number);
  const [h, mi] = hora.split(":").map(Number);
  const palpite = Date.UTC(a, m - 1, d, h, mi);
  let resultado = palpite - offsetMs(new Date(palpite), fuso);
  resultado = palpite - offsetMs(new Date(resultado), fuso);
  return new Date(resultado);
}

export function horaParaMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function minParaHora(min: number): string {
  const sinal = min < 0 ? "-" : "";
  const abs = Math.abs(Math.round(min));
  return `${sinal}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

export function somarDias(data: string, dias: number): string {
  const d = new Date(data + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function diasEntre(inicio: string, fim: string): string[] {
  const dias: string[] = [];
  for (let d = inicio; d <= fim; d = somarDias(d, 1)) dias.push(d);
  return dias;
}

/** ISO 8601 com o offset local, ex.: 2026-10-23T08:01:00-0300 (formato do AFD). */
export function isoComOffset(instante: Date, fuso: string): string {
  const off = offsetMs(instante, fuso) / 60000;
  const p = partesLocais(instante, fuso);
  const sinal = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${p.data}T${p.hora}:00${sinal}${hh}${mm}`;
}
