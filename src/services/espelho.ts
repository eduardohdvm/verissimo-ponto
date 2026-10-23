import { prisma } from "../db.js";
import { naoEncontrado } from "../lib/erros.js";
import { agruparTurnos, calcularPeriodo, totalizar, type ConfigJornada } from "../lib/calculo.js";
import { diasEntre, partesLocais, somarDias, utcDeLocal } from "../lib/tempo.js";

/**
 * Monta o espelho de ponto: marcações originais + tratamentos aprovados
 * (inclusões entram, desconsideradas saem, abonos zeram o débito do dia).
 */
export async function gerarEspelho(empresaId: string, funcionarioId: string, inicio: string, fim: string) {
  const func = await prisma.funcionario.findFirst({
    where: { id: funcionarioId, empresaId },
    include: { jornada: true, empresa: true },
  });
  if (!func) throw naoEncontrado("Funcionário");
  const fuso = func.empresa.fusoHorario;

  // Busca um dia antes (interjornada) e um depois (turno noturno que termina no dia seguinte)
  const de = utcDeLocal(somarDias(inicio, -1), "00:00", fuso);
  const ate = utcDeLocal(somarDias(fim, 2), "00:00", fuso);

  const [marcacoes, tratamentos, feriados] = await Promise.all([
    prisma.marcacao.findMany({
      where: { funcionarioId, dataHora: { gte: de, lt: ate } },
      orderBy: { dataHora: "asc" },
    }),
    prisma.tratamento.findMany({
      where: { funcionarioId, status: "APROVADO", data: { gte: somarDias(inicio, -1), lte: somarDias(fim, 1) } },
    }),
    prisma.feriado.findMany({ where: { empresaId, data: { gte: inicio, lte: fim } } }),
  ]);

  const desconsideradas = new Set(tratamentos.filter((t) => t.tipo === "DESCONSIDERAR").map((t) => t.marcacaoId));
  const incluidas = tratamentos.filter((t) => t.tipo === "INCLUSAO" && t.dataHora).map((t) => t.dataHora!);
  const marcas = [...marcacoes.filter((m) => !desconsideradas.has(m.id)).map((m) => m.dataHora), ...incluidas];

  // Dias antes da admissão e dias futuros não entram no cálculo (senão viram falta)
  const admissao = func.admissao?.toISOString().slice(0, 10);
  const hoje = partesLocais(new Date(), fuso).data;
  const dias = calcularPeriodo({
    dias: diasEntre(admissao && admissao > inicio ? admissao : inicio, fim < hoje ? fim : hoje),
    turnos: agruparTurnos(marcas, fuso).filter((t) => t.data <= fim),
    jornada: func.jornada
      ? { config: JSON.parse(func.jornada.horarios) as ConfigJornada, toleranciaMin: func.jornada.toleranciaMin }
      : null,
    fuso,
    feriados: new Map(feriados.map((f) => [f.data, f.descricao])),
    abonos: new Set(tratamentos.filter((t) => t.tipo === "ABONO").map((t) => t.data)),
    incluidas: new Set(incluidas.map((d) => d.getTime())),
  });

  return {
    empresa: { razaoSocial: func.empresa.razaoSocial, cnpj: func.empresa.cnpj },
    funcionario: {
      id: func.id,
      nome: func.nome,
      cpf: func.cpf,
      matricula: func.matricula,
      cargo: func.cargo,
      codigoExterno: func.codigoExterno,
      jornada: func.jornada?.nome ?? null,
    },
    periodo: { inicio, fim },
    dias,
    totais: totalizar(dias),
  };
}

/** Primeiro e último dia de um mês "AAAA-MM". */
export function periodoDoMes(mes: string): { inicio: string; fim: string } {
  const [a, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { inicio: `${mes}-01`, fim: `${mes}-${String(ultimo).padStart(2, "0")}` };
}
