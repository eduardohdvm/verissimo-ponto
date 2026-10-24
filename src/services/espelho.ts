import { prisma } from "../db.js";
import { agruparTurnos, calcularPeriodo, totalizar, type ConfigJornada, type ResultadoDia, type Totais } from "../lib/calculo.js";
import { naoEncontrado } from "../lib/erros.js";
import { lerRegras } from "../lib/regras.js";
import { diasEntre, partesLocais, somarDias, utcDeLocal } from "../lib/tempo.js";

export interface Espelho {
  empresa: { razaoSocial: string; cnpj: string };
  funcionario: {
    id: string;
    nome: string;
    cpf: string;
    matricula: string | null;
    cargo: string | null;
    codigoExterno: string | null;
    jornada: string | null;
    departamento: string | null;
  };
  periodo: { inicio: string; fim: string };
  dias: ResultadoDia[];
  totais: Totais & { bancoAnteriorMin: number; bancoAcumuladoMin: number };
  regras: { bancoHoras: boolean; percentuais: string[] };
  fechamento?: { id: string; fechadoEm: Date; assinatura: string; assinadoEm: Date | null; hash: string } | null;
}

function subtrairMeses(data: string, meses: number) {
  const d = new Date(data + "T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - meses);
  return d.toISOString().slice(0, 10);
}

/**
 * Monta o espelho de ponto: marcações originais + tratamentos aprovados
 * (inclusões entram, desconsideradas saem, abonos zeram o débito do dia),
 * afastamentos, feriados (da empresa e da filial) e as regras da convenção.
 * Se o período já foi fechado, devolve o espelho congelado no fechamento.
 */
export async function gerarEspelho(
  empresaId: string,
  funcionarioId: string,
  inicio: string,
  fim: string,
  { usarCongelado = true } = {},
): Promise<Espelho> {
  const func = await prisma.funcionario.findFirst({
    where: { id: funcionarioId, empresaId },
    include: { jornada: true, empresa: true, departamento: true },
  });
  if (!func) throw naoEncontrado("Funcionário");

  const assinatura = await prisma.assinaturaEspelho.findFirst({
    where: { funcionarioId, fechamento: { status: "FECHADO", inicio, fim } },
    include: { fechamento: true },
  });
  if (assinatura && usarCongelado) {
    const congelado = JSON.parse(assinatura.espelho) as Espelho;
    return {
      ...congelado,
      fechamento: {
        id: assinatura.fechamentoId,
        fechadoEm: assinatura.fechamento.fechadoEm,
        assinatura: assinatura.status,
        assinadoEm: assinatura.assinadoEm,
        hash: assinatura.hash,
      },
    };
  }

  const fuso = func.empresa.fusoHorario;
  const regras = lerRegras(func.empresa.regras);

  // Busca um dia antes (interjornada) e um depois (turno noturno que termina no dia seguinte)
  const de = utcDeLocal(somarDias(inicio, -1), "00:00", fuso);
  const ate = utcDeLocal(somarDias(fim, 2), "00:00", fuso);

  const [marcacoes, tratamentos, feriados, afastamentos, bancoAnterior] = await Promise.all([
    prisma.marcacao.findMany({
      where: { funcionarioId, dataHora: { gte: de, lt: ate } },
      orderBy: { dataHora: "asc" },
    }),
    prisma.tratamento.findMany({
      where: { funcionarioId, status: "APROVADO", data: { gte: somarDias(inicio, -1), lte: somarDias(fim, 1) } },
    }),
    prisma.feriado.findMany({
      where: { empresaId, data: { gte: inicio, lte: fim }, OR: [{ filialId: null }, { filialId: func.filialId ?? "-" }] },
    }),
    prisma.afastamento.findMany({
      where: { funcionarioId, status: "APROVADO", inicio: { lte: fim }, fim: { gte: inicio } },
    }),
    // Banco de horas: soma dos saldos dos meses fechados ainda dentro da validade
    regras.bancoHoras.ativo
      ? prisma.assinaturaEspelho.aggregate({
          _sum: { saldoBancoMin: true },
          where: {
            funcionarioId,
            fechamento: { status: "FECHADO", fim: { lt: inicio, gte: subtrairMeses(inicio, regras.bancoHoras.validadeMeses) } },
          },
        })
      : null,
  ]);

  const desconsideradas = new Set(tratamentos.filter((t) => t.tipo === "DESCONSIDERAR").map((t) => t.marcacaoId));
  const incluidas = tratamentos.filter((t) => t.tipo === "INCLUSAO" && t.dataHora).map((t) => t.dataHora!);
  const marcas = [...marcacoes.filter((m) => !desconsideradas.has(m.id)).map((m) => m.dataHora), ...incluidas];

  const diasAfastado = new Map<string, string>();
  for (const a of afastamentos) for (const d of diasEntre(a.inicio, a.fim)) diasAfastado.set(d, a.tipo);

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
    afastamentos: diasAfastado,
    incluidas: new Set(incluidas.map((d) => d.getTime())),
    regras,
  });

  const totais = totalizar(dias);
  const bancoAnteriorMin = bancoAnterior?._sum.saldoBancoMin ?? 0;
  const percentuais = [
    ...new Set([...regras.faixasExtra.map((f) => String(f.percentual)), String(regras.percentualDomingoFeriado), ...Object.keys(totais.extras)]),
  ].sort((a, b) => Number(a) - Number(b));

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
      departamento: func.departamento?.nome ?? null,
    },
    periodo: { inicio, fim },
    dias,
    totais: { ...totais, bancoAnteriorMin, bancoAcumuladoMin: bancoAnteriorMin + totais.saldoBancoMin },
    regras: { bancoHoras: regras.bancoHoras.ativo, percentuais },
    fechamento: null,
  };
}

/** Primeiro e último dia de um mês "AAAA-MM". */
export function periodoDoMes(mes: string): { inicio: string; fim: string } {
  const [a, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { inicio: `${mes}-01`, fim: `${mes}-${String(ultimo).padStart(2, "0")}` };
}
