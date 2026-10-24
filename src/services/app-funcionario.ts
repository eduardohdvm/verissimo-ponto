// Dados da tela inicial e do histórico do app do funcionário.
import { prisma } from "../db.js";
import { intervalosPrevistos, minutosPrevistos, type ConfigJornada } from "../lib/calculo.js";
import { diasEntre, partesLocais, somarDias, utcDeLocal } from "../lib/tempo.js";
import { gerarEspelho, periodoDoMes } from "./espelho.js";

/** Nome de cada batida pela posição no dia: Entrada, Saída pausa, Retorno pausa…, Saída. */
export function tipoBatida(indice: number, totalPrevisto: number): string {
  const total = Math.max(totalPrevisto, 2);
  if (indice === 0) return "Entrada";
  if (indice >= total - 1) return indice % 2 === 1 ? "Saída" : "Entrada";
  return indice % 2 === 1 ? "Saída pausa" : "Retorno pausa";
}

const segundaDaSemana = (dia: string) => {
  const d = new Date(dia + "T12:00:00Z").getUTCDay(); // 0 = domingo
  return somarDias(dia, d === 0 ? -6 : 1 - d);
};

function batidasPrevistas(config: ConfigJornada | null, dia: string): string[] {
  return config ? intervalosPrevistos(config, dia).flat() : [];
}

export async function resumoInicio(empresaId: string, funcionarioId: string, usuarioId: string) {
  const f = await prisma.funcionario.findUniqueOrThrow({
    where: { id: funcionarioId },
    include: { empresa: true, jornada: true, filial: true, departamento: true },
  });
  const fuso = f.empresa.fusoHorario;
  const hoje = partesLocais(new Date(), fuso).data;
  const config = f.jornada ? (JSON.parse(f.jornada.horarios) as ConfigJornada) : null;

  const [marcacoesHoje, ultimas, espelhoMes, espelhoSemana, assinaturasPendentes, documentosPendentes, comunicados] = await Promise.all([
    prisma.marcacao.findMany({
      where: { funcionarioId, dataHora: { gte: utcDeLocal(hoje, "00:00", fuso), lt: utcDeLocal(somarDias(hoje, 1), "00:00", fuso) } },
      orderBy: { dataHora: "asc" },
    }),
    prisma.marcacao.findMany({ where: { funcionarioId }, orderBy: { dataHora: "desc" }, take: 2 }),
    gerarEspelho(empresaId, funcionarioId, `${hoje.slice(0, 7)}-01`, hoje).catch(() => null),
    gerarEspelho(empresaId, funcionarioId, segundaDaSemana(hoje), hoje).catch(() => null),
    prisma.assinaturaEspelho.count({ where: { funcionarioId, status: "PENDENTE", fechamento: { status: "FECHADO" } } }),
    prisma.documento.count({ where: { funcionarioId, exigeAssinatura: true, status: { not: "ASSINADO" } } }),
    comunicadosDoFuncionario(empresaId, f.departamentoId, usuarioId),
  ]);

  // Últimos registros com o nome da batida (posição dentro do dia dela)
  const ultimosRegistros = [];
  for (const m of ultimas) {
    const p = partesLocais(m.dataHora, fuso);
    const anteriores = await prisma.marcacao.count({
      where: { funcionarioId, dataHora: { gte: utcDeLocal(p.data, "00:00", fuso), lt: m.dataHora } },
    });
    ultimosRegistros.push({
      id: m.id, hora: p.hora, data: p.data,
      tipo: tipoBatida(anteriores, batidasPrevistas(config, p.data).length || 2),
    });
  }

  const previstasHoje = batidasPrevistas(config, hoje);
  const feitas = marcacoesHoje.length;
  // Sem jornada hoje (folga, hora extra), o dia tem só entrada e saída
  const total = previstasHoje.length || 2;
  // Passou das batidas previstas: alterna entrada/saída
  const proximoTipo = feitas < total ? tipoBatida(feitas, total) : feitas % 2 ? "Saída" : "Entrada";

  const semanaInicio = segundaDaSemana(hoje);
  const semana = diasEntre(semanaInicio, somarDias(semanaInicio, 6)).map((dia) => ({
    dia,
    previstoMin: config ? minutosPrevistos(intervalosPrevistos(config, dia)) : 0,
    trabalhadoMin: espelhoSemana?.dias.find((d) => d.data === dia)?.trabalhadoMin ?? 0,
    hoje: dia === hoje,
  }));

  return {
    funcionario: {
      nome: f.nome,
      cargo: f.cargo,
      lotacao: f.filial?.nome ?? f.departamento?.nome ?? null,
      temFoto: !!f.fotoCadastro || (await prisma.marcacao.count({ where: { funcionarioId, selfie: { not: null } } })) > 0,
    },
    empresa: { nome: f.empresa.razaoSocial, temLogo: !!f.empresa.logo },
    hoje,
    ultimosRegistros,
    proximo: {
      tipo: proximoTipo,
      previsto: previstasHoje[feitas] ?? null,
      feitas,
      total,
      semJornadaHoje: previstasHoje.length === 0,
    },
    banco: espelhoMes
      ? {
          competencia: hoje.slice(0, 7),
          ativo: espelhoMes.regras.bancoHoras,
          mesMin: espelhoMes.totais.saldoBancoMin,
          acumuladoMin: espelhoMes.totais.bancoAcumuladoMin,
          creditoMin: espelhoMes.totais.extraMin,
          debitoMin: espelhoMes.totais.debitoMin,
        }
      : null,
    semana: {
      dias: semana,
      totalMin: semana.reduce((s, d) => s + d.trabalhadoMin, 0),
      metaMin: semana.reduce((s, d) => s + d.previstoMin, 0),
    },
    pendentes: { assinaturas: assinaturasPendentes, documentos: documentosPendentes },
    comunicados,
  };
}

export async function comunicadosDoFuncionario(empresaId: string, departamentoId: string | null, usuarioId: string) {
  const lista = await prisma.comunicado.findMany({
    where: {
      empresaId,
      OR: [{ departamentoId: null }, { departamentoId: departamentoId ?? "-" }],
      AND: [{ OR: [{ expiraEm: null }, { expiraEm: { gt: new Date() } }] }],
    },
    include: { leituras: { where: { usuarioId }, select: { lidoEm: true } } },
    orderBy: { criadoEm: "desc" },
    take: 10,
  });
  return lista.map(({ leituras, imagem, criadoPor, ...c }) => ({ ...c, temImagem: !!imagem, lido: leituras.length > 0 }));
}

/** Histórico do mês: marcações de cada dia com a posição e se tem foto. */
export async function historicoDoMes(funcionarioId: string, mes: string) {
  const f = await prisma.funcionario.findUniqueOrThrow({ where: { id: funcionarioId }, include: { empresa: true, jornada: true } });
  const fuso = f.empresa.fusoHorario;
  const config = f.jornada ? (JSON.parse(f.jornada.horarios) as ConfigJornada) : null;
  const { inicio, fim } = periodoDoMes(mes);
  const marcacoes = await prisma.marcacao.findMany({
    where: { funcionarioId, dataHora: { gte: utcDeLocal(inicio, "00:00", fuso), lt: utcDeLocal(somarDias(fim, 1), "00:00", fuso) } },
    orderBy: { dataHora: "asc" },
  });
  const porDia = new Map<string, typeof marcacoes>();
  for (const m of marcacoes) {
    const d = partesLocais(m.dataHora, fuso).data;
    porDia.set(d, [...(porDia.get(d) ?? []), m]);
  }
  return [...porDia.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([dia, ms]) => {
      const total = batidasPrevistas(config, dia).length || 2;
      return {
        dia,
        marcacoes: ms.map((m, i) => ({
          id: m.id,
          hora: partesLocais(m.dataHora, fuso).hora,
          rotulo: `${i % 2 ? "S" : "E"}${Math.floor(i / 2) + 1}`,
          tipo: tipoBatida(i, Math.max(total, ms.length)),
          temFoto: !!m.selfie,
          origem: m.origem,
        })),
      };
    });
}
