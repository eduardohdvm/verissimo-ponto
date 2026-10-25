// AEJ (Arquivo Eletrônico de Jornada), gerado pelo "programa de tratamento" (Portaria MTP 671/2021, Anexo VI):
// vínculos, horários contratuais, marcações tratadas (originais, incluídas, desconsideradas),
// ausências abonadas e movimentos de banco de horas. Campos separados por "|".
//
// ATENÇÃO: a estrutura segue o Anexo VI (registros 01 a 07 e 99), mas a ordem e o formato
// exatos dos campos precisam ser conferidos com o texto oficial vigente e validados no
// validador do Ministério antes do uso em fiscalização.
import { prisma } from "../db.js";
import { intervalosPrevistos, minutosPrevistos, type ConfigJornada } from "../lib/calculo.js";
import { naoEncontrado } from "../lib/erros.js";
import { diasEntre, isoComOffset, somarDias, utcDeLocal } from "../lib/tempo.js";
import { gerarEspelho } from "./espelho.js";

const DESENVOLVEDOR = {
  nome: "Verissimo Ponto",
  versao: "0.2.0",
  cnpj: process.env.FABRICANTE_CNPJ ?? "00000000000000",
  razao: process.env.FABRICANTE_NOME ?? "Desenvolvedor do sistema",
  email: process.env.FABRICANTE_EMAIL ?? "",
};

const TIPO_AUSENCIA: Record<string, string> = { FERIAS: "1", ATESTADO: "2", LICENCA: "3", FOLGA: "4", OUTRO: "9", ABONO: "9" };

export async function gerarAej(empresaId: string, inicio: string, fim: string): Promise<string> {
  const emp = await prisma.empresa.findUnique({ where: { id: empresaId } });
  if (!emp) throw naoEncontrado("Empresa");
  const fuso = emp.fusoHorario;
  const de = utcDeLocal(inicio, "00:00", fuso);
  const ate = utcDeLocal(somarDias(fim, 1), "00:00", fuso);

  const funcionarios = await prisma.funcionario.findMany({
    where: { empresaId, OR: [{ ativo: true }, { marcacoes: { some: { dataHora: { gte: de, lt: ate } } } }] },
    include: { jornada: true },
    orderBy: { nome: "asc" },
  });
  const jornadas = [...new Map(funcionarios.filter((f) => f.jornada).map((f) => [f.jornada!.id, f.jornada!])).values()];
  const codJornada = new Map(jornadas.map((j, i) => [j.id, String(i + 1)]));

  const r: string[][] = [];
  r.push(["01", "1", emp.cnpj, "", "", emp.razaoSocial, inicio, fim, isoComOffset(new Date(), fuso), "001"]);
  r.push(["02", "1", "3", process.env.REGISTRO_INPI ?? ""]); // tipo 3 = REP-P

  funcionarios.forEach((f, i) => r.push(["03", String(i + 1), f.cpf, f.nome]));

  for (const j of jornadas) {
    const cfg = JSON.parse(j.horarios) as ConfigJornada;
    // Horário de referência: o primeiro dia com jornada no período
    const dia = diasEntre(inicio, fim).find((d) => intervalosPrevistos(cfg, d).length) ?? inicio;
    const iv = intervalosPrevistos(cfg, dia);
    r.push(["04", codJornada.get(j.id)!, String(minutosPrevistos(iv)), ...iv.flat()]);
  }

  for (const [i, f] of funcionarios.entries()) {
    const vinculo = String(i + 1);
    const cod = f.jornadaId ? codJornada.get(f.jornadaId) ?? "" : "";
    const [marcacoes, tratamentos, afastamentos] = await Promise.all([
      prisma.marcacao.findMany({ where: { funcionarioId: f.id, dataHora: { gte: de, lt: ate } }, orderBy: { dataHora: "asc" } }),
      prisma.tratamento.findMany({ where: { funcionarioId: f.id, status: "APROVADO", data: { gte: inicio, lte: fim } } }),
      prisma.afastamento.findMany({ where: { funcionarioId: f.id, status: "APROVADO", inicio: { lte: fim }, fim: { gte: inicio } } }),
    ]);
    const desconsideradas = new Map(tratamentos.filter((t) => t.tipo === "DESCONSIDERAR").map((t) => [t.marcacaoId, t.motivo]));
    const todas = [
      ...marcacoes.map((m) => ({ quando: m.dataHora, fonte: desconsideradas.has(m.id) ? "D" : "O", motivo: desconsideradas.get(m.id) ?? "" })),
      ...tratamentos.filter((t) => t.tipo === "INCLUSAO" && t.dataHora).map((t) => ({ quando: t.dataHora!, fonte: "I", motivo: t.motivo })),
    ].sort((a, b) => a.quando.getTime() - b.quando.getTime());
    let seq = 0;
    for (const m of todas) {
      const valida = m.fonte !== "D";
      if (valida) seq++;
      // E/S alternados entre as marcações válidas; desconsideradas ficam registradas com tipo "D"
      r.push(["05", vinculo, isoComOffset(m.quando, fuso), "1", valida ? (seq % 2 ? "E" : "S") : "D", valida ? String(Math.ceil(seq / 2)) : "", m.fonte, cod, m.motivo]);
    }

    for (const a of afastamentos) {
      for (const d of diasEntre(a.inicio < inicio ? inicio : a.inicio, a.fim > fim ? fim : a.fim)) {
        r.push(["07", vinculo, TIPO_AUSENCIA[a.tipo] ?? "9", d, "", ""]);
      }
    }
    for (const t of tratamentos.filter((x) => x.tipo === "ABONO")) r.push(["07", vinculo, TIPO_AUSENCIA.ABONO, t.data, "", ""]);

    // Banco de horas: um movimento por dia com saldo (C = crédito, D = débito)
    const e = await gerarEspelho(empresaId, f.id, inicio, fim);
    if (e.regras.bancoHoras) {
      for (const d of e.dias) {
        const saldo = d.extraMin - d.debitoMin;
        if (saldo) r.push(["07", vinculo, "BH", d.data, String(Math.abs(saldo)), saldo > 0 ? "C" : "D"]);
      }
    }
  }

  r.push(["06", DESENVOLVEDOR.nome, DESENVOLVEDOR.versao, "1", DESENVOLVEDOR.cnpj, DESENVOLVEDOR.razao, DESENVOLVEDOR.email]);
  const conta = (t: string) => String(r.filter((l) => l[0] === t).length);
  r.push(["99", ...["01", "02", "03", "04", "05", "06", "07"].map(conta)]);
  return r.map((l) => l.map((c) => c.replace(/[|\r\n]/g, " ")).join("|")).join("\r\n") + "\r\n";
}
