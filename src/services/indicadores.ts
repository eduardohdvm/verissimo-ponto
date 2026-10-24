// Indicadores do mês para o painel: absenteísmo, horas extras, atrasos e banco de horas,
// no total e por departamento, e quem está trabalhando agora.
import type { Sessao } from "../auth.js";
import { prisma } from "../db.js";
import { partesLocais, somarDias, utcDeLocal } from "../lib/tempo.js";
import { filtroFuncionarios } from "./escopo.js";
import { gerarEspelho } from "./espelho.js";

interface Acumulado {
  funcionarios: number;
  diasPrevistos: number;
  faltas: number;
  extraMin: number;
  atrasos: number;
  atrasoMin: number;
  bancoMin: number;
}

const vazio = (): Acumulado => ({ funcionarios: 0, diasPrevistos: 0, faltas: 0, extraMin: 0, atrasos: 0, atrasoMin: 0, bancoMin: 0 });

function somar(a: Acumulado, e: Awaited<ReturnType<typeof gerarEspelho>>) {
  a.funcionarios++;
  a.diasPrevistos += e.dias.filter((d) => d.previstoMin > 0 && !d.afastamento && !d.feriado).length;
  a.faltas += e.totais.faltas;
  a.extraMin += e.totais.extraMin;
  a.atrasos += e.totais.atrasos;
  a.atrasoMin += e.totais.atrasoMin;
  a.bancoMin += e.totais.bancoAcumuladoMin;
}

const resumo = (a: Acumulado) => ({
  ...a,
  absenteismo: a.diasPrevistos ? a.faltas / a.diasPrevistos : 0,
});

export async function indicadoresDoMes(s: Sessao, inicio: string, fim: string) {
  const funcionarios = await prisma.funcionario.findMany({
    where: { ...(await filtroFuncionarios(s)), ativo: true },
    include: { departamento: { select: { nome: true } } },
    orderBy: { nome: "asc" },
  });
  const total = vazio();
  const porDep = new Map<string, Acumulado>();
  const pessoas = [];
  for (const f of funcionarios) {
    const e = await gerarEspelho(s.empresaId, f.id, inicio, fim);
    somar(total, e);
    const dep = f.departamento?.nome ?? "Sem departamento";
    if (!porDep.has(dep)) porDep.set(dep, vazio());
    somar(porDep.get(dep)!, e);
    pessoas.push({ id: f.id, nome: f.nome, departamento: dep, banco: e.totais.bancoAcumuladoMin, extra: e.totais.extraMin, faltas: e.totais.faltas, atrasos: e.totais.atrasos });
  }
  return {
    total: resumo(total),
    departamentos: [...porDep.entries()].map(([nome, a]) => ({ nome, ...resumo(a) })).sort((a, b) => a.nome.localeCompare(b.nome)),
    pessoas,
  };
}

/** Quem está com o turno aberto agora (número ímpar de marcações hoje) e onde foi a última marcação. */
export async function trabalhandoAgora(s: Sessao) {
  const emp = await prisma.empresa.findUniqueOrThrow({ where: { id: s.empresaId } });
  const hoje = partesLocais(new Date(), emp.fusoHorario).data;
  // Desde ontem 12h, para pegar turnos noturnos que viraram a meia-noite
  const desde = utcDeLocal(somarDias(hoje, -1), "12:00", emp.fusoHorario);
  const marcacoes = await prisma.marcacao.findMany({
    where: { empresaId: s.empresaId, dataHora: { gte: desde }, funcionario: { ...(await filtroFuncionarios(s)), ativo: true } },
    include: { funcionario: { select: { nome: true, departamento: { select: { nome: true } } } } },
    orderBy: { dataHora: "asc" },
  });
  const porFunc = new Map<string, typeof marcacoes>();
  for (const m of marcacoes) {
    const l = porFunc.get(m.funcionarioId) ?? [];
    // Intervalo de mais de 16h entre marcações: começa um turno novo
    if (l.length && m.dataHora.getTime() - l[l.length - 1].dataHora.getTime() > 16 * 3600_000) l.length = 0;
    l.push(m);
    porFunc.set(m.funcionarioId, l);
  }
  return [...porFunc.values()]
    .filter((l) => l.length % 2 === 1)
    .map((l) => {
      const ultima = l[l.length - 1];
      return {
        funcionario: ultima.funcionario.nome,
        departamento: ultima.funcionario.departamento?.nome ?? null,
        desde: partesLocais(l[0].dataHora, emp.fusoHorario).hora,
        ultima: partesLocais(ultima.dataHora, emp.fusoHorario).hora,
        origem: ultima.origem,
        latitude: ultima.latitude,
        longitude: ultima.longitude,
      };
    })
    .sort((a, b) => a.funcionario.localeCompare(b.funcionario));
}
