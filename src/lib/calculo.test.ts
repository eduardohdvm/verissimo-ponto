import assert from "node:assert/strict";
import { test } from "node:test";
import { agruparTurnos, calcularPeriodo, totalizar, type ConfigJornada } from "./calculo.js";
import { REGRAS_PADRAO } from "./regras.js";
import { utcDeLocal } from "./tempo.js";

const FUSO = "America/Sao_Paulo";
const comercial: ConfigJornada = {
  tipo: "SEMANAL",
  dias: Object.fromEntries(["1", "2", "3", "4", "5"].map((d) => [d, [["08:00", "12:00"], ["13:00", "17:00"]]])),
};
const marcas = (data: string, ...horas: string[]) => horas.map((h) => utcDeLocal(data, h, FUSO));

function calcular(m: Date[], dias: string[], config = comercial, extras: Partial<Parameters<typeof calcularPeriodo>[0]> = {}) {
  return calcularPeriodo({
    dias,
    turnos: agruparTurnos(m, FUSO),
    jornada: { config, toleranciaMin: 10 },
    fuso: FUSO,
    feriados: new Map(),
    abonos: new Set(),
    ...extras,
  });
}

// 2026-10-19 é segunda-feira
test("dia normal sem extras", () => {
  const [d] = calcular(marcas("2026-10-19", "08:00", "12:00", "13:00", "17:00"), ["2026-10-19"]);
  assert.equal(d.previstoMin, 480);
  assert.equal(d.trabalhadoMin, 480);
  assert.equal(d.extraMin + d.debitoMin, 0);
  assert.deepEqual(d.ocorrencias, []);
});

test("tolerância de 10 minutos não gera extra nem débito", () => {
  const [d] = calcular(marcas("2026-10-19", "08:05", "12:00", "13:00", "17:04"), ["2026-10-19"]);
  assert.equal(d.extraMin, 0);
  assert.equal(d.debitoMin, 0);
});

test("hora extra e débito", () => {
  const [extra] = calcular(marcas("2026-10-19", "08:00", "12:00", "13:00", "18:30"), ["2026-10-19"]);
  assert.equal(extra.extras["50"], 90);
  const [atraso] = calcular(marcas("2026-10-19", "09:00", "12:00", "13:00", "17:00"), ["2026-10-19"]);
  assert.equal(atraso.debitoMin, 60);
});

test("falta, abono e marcação ímpar", () => {
  const [falta] = calcular([], ["2026-10-19"]);
  assert.deepEqual(falta.ocorrencias, ["FALTA"]);
  assert.equal(falta.debitoMin, 480);
  const [abonado] = calcular([], ["2026-10-19"], comercial, { abonos: new Set(["2026-10-19"]) });
  assert.equal(abonado.debitoMin, 0);
  const [impar] = calcular(marcas("2026-10-19", "08:00", "12:00", "13:00"), ["2026-10-19"]);
  assert.ok(impar.ocorrencias.includes("MARCACAO_IMPAR"));
});

test("domingo e feriado são extras a 100%", () => {
  const [dom] = calcular(marcas("2026-10-25", "08:00", "12:00"), ["2026-10-25"]);
  assert.equal(dom.extras["100"], 240);
  const [fer] = calcular(marcas("2026-10-19", "08:00", "12:00"), ["2026-10-19"], comercial, {
    feriados: new Map([["2026-10-19", "Feriado municipal"]]),
  });
  assert.equal(fer.extras["100"], 240);
  assert.equal(fer.debitoMin, 0);
});

test("turno 12x36 noturno fica no dia em que começou e conta adicional noturno", () => {
  const ciclo: ConfigJornada = { tipo: "CICLO", dataBase: "2026-10-19", ciclo: [[["19:00", "07:00"]], []] };
  const m = [utcDeLocal("2026-10-19", "19:00", FUSO), utcDeLocal("2026-10-20", "07:00", FUSO)];
  const [seg, ter] = calcular(m, ["2026-10-19", "2026-10-20"], ciclo);
  assert.equal(seg.previstoMin, 720);
  assert.equal(seg.trabalhadoMin, 720);
  assert.equal(seg.noturnoMin, 420); // 22h às 5h
  assert.equal(seg.noturnoReduzidoMin, 480);
  assert.equal(ter.previstoMin, 0);
  assert.equal(ter.trabalhadoMin, 0);
  assert.ok(seg.ocorrencias.includes("INTERVALO_INSUFICIENTE"));
});

test("interjornada menor que 11h", () => {
  const m = [...marcas("2026-10-19", "08:00", "12:00", "13:00", "23:00"), ...marcas("2026-10-20", "08:00", "12:00", "13:00", "17:00")];
  const [, ter] = calcular(m, ["2026-10-19", "2026-10-20"]);
  assert.ok(ter.ocorrencias.includes("INTERJORNADA_INSUFICIENTE"));
});

test("totais e saldo de banco de horas", () => {
  const m = [...marcas("2026-10-19", "08:00", "12:00", "13:00", "18:00"), ...marcas("2026-10-20", "08:00", "12:00", "13:00", "16:30")];
  const t = totalizar(calcular(m, ["2026-10-19", "2026-10-20"]));
  assert.equal(t.extras["50"], 60);
  assert.equal(t.debitoMin, 30);
  assert.equal(t.saldoBancoMin, 30);
});

test("faixas de hora extra da convenção: 2h a 50% e o resto a 100%", () => {
  const regras = { ...REGRAS_PADRAO, faixasExtra: [{ ateMin: 120, percentual: 50 }, { ateMin: null, percentual: 100 }] };
  const [d] = calcular(marcas("2026-10-19", "08:00", "12:00", "13:00", "20:00"), ["2026-10-19"], comercial, { regras });
  assert.equal(d.extraMin, 180);
  assert.deepEqual(d.extras, { "50": 120, "100": 60 });
});

test("domingo com percentual da convenção", () => {
  const regras = { ...REGRAS_PADRAO, percentualDomingoFeriado: 150 };
  const [d] = calcular(marcas("2026-10-25", "08:00", "10:00"), ["2026-10-25"], comercial, { regras });
  assert.deepEqual(d.extras, { "150": 120 });
});

test("férias e atestado não geram falta nem débito", () => {
  const afastamentos = new Map([["2026-10-19", "FERIAS"], ["2026-10-20", "ATESTADO"]]);
  const dias = calcular([], ["2026-10-19", "2026-10-20"], comercial, { afastamentos });
  for (const d of dias) {
    assert.deepEqual(d.ocorrencias, []);
    assert.equal(d.debitoMin, 0);
  }
  assert.equal(dias[0].afastamento, "FERIAS");
  assert.equal(totalizar(dias).diasAfastado, 2);
});

test("atraso na entrada", () => {
  const [d] = calcular(marcas("2026-10-19", "08:25", "12:00", "13:00", "17:00"), ["2026-10-19"]);
  assert.equal(d.atrasoMin, 25);
  assert.ok(d.ocorrencias.includes("ATRASO"));
  const [ok] = calcular(marcas("2026-10-19", "08:08", "12:00", "13:00", "17:00"), ["2026-10-19"]);
  assert.equal(ok.atrasoMin, 0);
});

test("hora noturna sem redução quando a convenção não usa", () => {
  const ciclo: ConfigJornada = { tipo: "CICLO", dataBase: "2026-10-19", ciclo: [[["22:00", "05:00"]], []] };
  const m = [utcDeLocal("2026-10-19", "22:00", FUSO), utcDeLocal("2026-10-20", "05:00", FUSO)];
  const regras = { ...REGRAS_PADRAO, horaNoturnaReduzida: false };
  const [d] = calcular(m, ["2026-10-19"], ciclo, { regras });
  assert.equal(d.noturnoReduzidoMin, 420);
});
