// Feriados nacionais do Brasil, calculados para qualquer ano (incluindo os móveis, que dependem da Páscoa).
import { somarDias } from "./tempo.js";

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
export function pascoa(ano: number): string {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

export function feriadosNacionais(ano: number, incluirFacultativos = false): { data: string; descricao: string }[] {
  const p = pascoa(ano);
  const lista = [
    { data: `${ano}-01-01`, descricao: "Confraternização Universal" },
    { data: somarDias(p, -2), descricao: "Sexta-feira Santa" },
    { data: `${ano}-04-21`, descricao: "Tiradentes" },
    { data: `${ano}-05-01`, descricao: "Dia do Trabalho" },
    { data: `${ano}-09-07`, descricao: "Independência do Brasil" },
    { data: `${ano}-10-12`, descricao: "Nossa Senhora Aparecida" },
    { data: `${ano}-11-02`, descricao: "Finados" },
    { data: `${ano}-11-15`, descricao: "Proclamação da República" },
    { data: `${ano}-11-20`, descricao: "Dia Nacional de Zumbi e da Consciência Negra" },
    { data: `${ano}-12-25`, descricao: "Natal" },
  ];
  if (incluirFacultativos) {
    lista.push(
      { data: somarDias(p, -48), descricao: "Carnaval (ponto facultativo)" },
      { data: somarDias(p, -47), descricao: "Carnaval (ponto facultativo)" },
      { data: somarDias(p, 60), descricao: "Corpus Christi (ponto facultativo)" },
    );
  }
  return lista.sort((a, b) => a.data.localeCompare(b.data));
}
