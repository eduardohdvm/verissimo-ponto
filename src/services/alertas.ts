// Alertas automáticos, conferidos a cada minuto. Para o funcionário:
// - lembrete 5 min antes da entrada, se ainda não bateu o ponto;
// - aviso 1h depois do fim da jornada, se a última batida foi uma entrada.
// Para gestores e administradores (conforme as preferências de cada um, ver lib/preferencias.ts):
// - entrada não registrada depois de 15, 30 ou 60 min;
// - dia encerrado com batida faltando (1, 2 ou 4 h depois do fim da jornada);
// - hora extra acima de 2h no dia;
// - resumo diário do dia anterior, no horário escolhido.
// Cada alerta tem uma chave única, então nunca é enviado duas vezes.
// No Render grátis o servidor dorme sem uso; enquanto dorme, os alertas não rodam.
import type { Sessao } from "../auth.js";
import { prisma } from "../db.js";
import { intervalosPrevistos, minutosPrevistos, type ConfigJornada } from "../lib/calculo.js";
import { lerPreferencias, type Preferencias } from "../lib/preferencias.js";
import { horaParaMin, minParaHora, partesLocais, somarDias, utcDeLocal } from "../lib/tempo.js";
import { enviarEmail, urlApp } from "./email.js";
import { filtroFuncionarios } from "./escopo.js";
import { gerarEspelho } from "./espelho.js";
import { avisarEquipe, notificar } from "./notificacoes.js";

const JANELA_MIN = 10; // tolerância para não perder um alerta se o servidor atrasar alguns minutos
const dentro = (agora: number, alvo: number) => agora >= alvo && agora < alvo + JANELA_MIN;
const LIMITE_EXTRA_MIN = 120; // CLT art. 59

export async function verificarAlertas(agora = new Date()) {
  const empresas = await prisma.empresa.findMany({ where: { bloqueada: false }, select: { id: true, fusoHorario: true } });
  for (const emp of empresas) {
    const { data: hoje, minutoDoDia } = partesLocais(agora, emp.fusoHorario);
    await alertasDeJornada(emp, hoje, minutoDoDia);
    await resumosDiarios(emp, hoje, minutoDoDia);
  }
}

async function alertasDeJornada(emp: { id: string; fusoHorario: string }, hoje: string, minutoDoDia: number) {
  const funcionarios = await prisma.funcionario.findMany({
    where: { empresaId: emp.id, ativo: true, jornadaId: { not: null } },
    include: { jornada: true, usuario: { select: { id: true, ativo: true } } },
  });
  for (const f of funcionarios) {
    const intervalos = intervalosPrevistos(JSON.parse(f.jornada!.horarios) as ConfigJornada, hoje);
    if (!intervalos.length) continue;
    const entrada = horaParaMin(intervalos[0][0]);
    const saida = horaParaMin(intervalos[intervalos.length - 1][1]);
    if (saida <= entrada) continue; // turno que vira a noite: fica de fora dos alertas por enquanto

    const lembrete = dentro(minutoDoDia, entrada - 5);
    const atraso = [15, 30, 60].find((m) => dentro(minutoDoDia, entrada + m));
    const fimDoDia = [1, 2, 4].find((h) => dentro(minutoDoDia, saida + h * 60));
    const semSaida = dentro(minutoDoDia, saida + 60);
    if (!lembrete && !atraso && !fimDoDia && !semSaida) continue;

    // Só consulta o banco quando algum alerta está na janela
    const [folga, marcacoes] = await Promise.all([
      diaDeFolga(emp.id, f.id, f.filialId, hoje),
      prisma.marcacao.findMany({
        where: {
          funcionarioId: f.id,
          dataHora: { gte: utcDeLocal(hoje, "00:00", emp.fusoHorario), lt: utcDeLocal(somarDias(hoje, 1), "00:00", emp.fusoHorario) },
        },
        orderBy: { dataHora: "asc" },
        select: { dataHora: true },
      }),
    ]);
    if (folga) continue;
    const feitas = marcacoes.length;
    const previstas = intervalos.length * 2;
    const usuario = f.usuario?.ativo ? f.usuario : null;

    if (lembrete && feitas === 0 && usuario) {
      await notificar(emp.id, usuario.id, "Hora de bater o ponto", `Sua entrada está prevista para ${intervalos[0][0]}.`, "/ponto", `lembrete:${f.id}:${hoje}`);
    }
    if (semSaida && feitas % 2 === 1 && usuario) {
      await notificar(emp.id, usuario.id, "Esqueceu de bater a saída?", "Sua última marcação de hoje foi uma entrada. Se já saiu, peça o ajuste no app.",
        "/ponto#pedidos", `saida:${f.id}:${hoje}`);
    }
    if (atraso && feitas === 0) {
      await avisarEquipe(emp.id, f, "atraso", "Entrada não registrada",
        `${f.nome} ainda não bateu o ponto (entrada prevista ${intervalos[0][0]}, há ${atraso} min).`, "/admin#painel",
        { chave: `atraso:${f.id}:${hoje}`, filtro: (p) => (p as Preferencias["atraso"]).minutos === atraso });
    }
    if (fimDoDia && (feitas < previstas || feitas % 2 === 1)) {
      const texto = feitas === 0
        ? `${f.nome} não registrou nenhuma batida hoje (jornada ${intervalos[0][0]} às ${intervalos[intervalos.length - 1][1]}).`
        : `${f.nome} encerrou o dia com ${feitas} de ${previstas} batidas${feitas % 2 ? " (a última foi uma entrada)" : ""}.`;
      await avisarEquipe(emp.id, f, "batidaFaltando", feitas === 0 ? "Funcionário sem batidas hoje" : "Batida faltando", texto, "/admin#espelho",
        { chave: `faltando:${f.id}:${hoje}`, filtro: (p) => (p as Preferencias["batidaFaltando"]).horasDepois === fimDoDia });
    }
    if (fimDoDia === 1 && feitas >= 2) {
      let ms = 0;
      for (let i = 0; i + 1 < feitas; i += 2) ms += marcacoes[i + 1].dataHora.getTime() - marcacoes[i].dataHora.getTime();
      const extra = Math.round(ms / 60_000) - minutosPrevistos(intervalos);
      if (extra > LIMITE_EXTRA_MIN) {
        await avisarEquipe(emp.id, f, "horaExtra", "Hora extra acima do limite",
          `${f.nome} fez ${minParaHora(extra)} de hora extra hoje (limite da CLT: 2h por dia).`, "/admin#espelho",
          { chave: `extra:${f.id}:${hoje}` });
      }
    }
  }
}

/** Resumo do dia anterior, para quem ligou o resumo diário, no horário que escolheu. */
async function resumosDiarios(emp: { id: string; fusoHorario: string }, hoje: string, minutoDoDia: number) {
  const usuarios = await prisma.usuario.findMany({ where: { empresaId: emp.id, ativo: true, papel: { in: ["ADMIN", "GESTOR"] } } });
  for (const u of usuarios) {
    const pref = lerPreferencias(u.preferenciasNotificacao).resumoDiario;
    if (pref.canal === "OFF" || !dentro(minutoDoDia, horaParaMin(pref.hora))) continue;
    const ontem = somarDias(hoje, -1);
    const chave = `resumo:${u.id}:${ontem}`;
    if (await prisma.notificacao.findUnique({ where: { chave } })) continue;
    const resumo = await montarResumo({ usuarioId: u.id, empresaId: emp.id, papel: u.papel as Sessao["papel"], funcionarioId: u.funcionarioId }, ontem);
    if (!resumo) continue;
    const titulo = `Resumo de ${ontem.split("-").reverse().join("/")}`;
    const enviado = await notificar(emp.id, u.id, titulo, resumo.curto, "/admin#indicadores", chave);
    if (enviado && pref.canal === "APP_EMAIL") {
      enviarEmail({ para: u.email, assunto: titulo, titulo, paragrafos: resumo.linhas, botao: { texto: "Abrir o painel", url: `${urlApp()}/admin#espelho` } })
        .catch((e) => console.warn("Falha no e-mail do resumo:", (e as Error).message));
    }
  }
}

async function montarResumo(s: Sessao, dia: string) {
  const funcionarios = await prisma.funcionario.findMany({
    where: { ...(await filtroFuncionarios(s)), ativo: true, jornadaId: { not: null } },
    select: { id: true, nome: true, jornada: { select: { horarios: true } } },
    orderBy: { nome: "asc" },
  });
  if (!funcionarios.length) return null;
  const faltas: string[] = [], atrasos: string[] = [], incompletos: string[] = [], extras: string[] = [];
  let comJornada = 0;
  for (const f of funcionarios) {
    const d = (await gerarEspelho(s.empresaId, f.id, dia, dia)).dias[0];
    if (!d || d.previstoMin === 0 || d.afastamento || d.feriado) continue;
    comJornada++;
    if (d.ocorrencias.includes("FALTA")) faltas.push(f.nome);
    else {
      if (d.ocorrencias.includes("ATRASO")) atrasos.push(`${f.nome} (${minParaHora(d.atrasoMin)})`);
      const previstas = f.jornada ? intervalosPrevistos(JSON.parse(f.jornada.horarios) as ConfigJornada, dia).length * 2 : 2;
      if (d.ocorrencias.includes("MARCACAO_IMPAR") || d.marcacoes.length < previstas) {
        incompletos.push(`${f.nome} (${d.marcacoes.length} de ${previstas} batidas)`);
      }
      if (d.extraMin > 0) extras.push(`${f.nome} (+${minParaHora(d.extraMin)})`);
    }
  }
  if (!comJornada) return null;
  const linhas = [
    `${comJornada} pessoa(s) com jornada prevista.`,
    `Faltas: ${faltas.length ? faltas.join(", ") : "nenhuma"}.`,
    `Atrasos: ${atrasos.length ? atrasos.join(", ") : "nenhum"}.`,
    `Batidas faltando: ${incompletos.length ? incompletos.join(", ") : "nenhuma"}.`,
    `Horas extras: ${extras.length ? extras.join(", ") : "nenhuma"}.`,
  ];
  const curto = faltas.length + atrasos.length + incompletos.length
    ? `${faltas.length} falta(s), ${atrasos.length} atraso(s), ${incompletos.length} com batida faltando.`
    : `Tudo certo: ${comJornada} pessoa(s) com o ponto completo.`;
  return { curto, linhas };
}

async function diaDeFolga(empresaId: string, funcionarioId: string, filialId: string | null, dia: string) {
  const [feriado, afastamento] = await Promise.all([
    prisma.feriado.findFirst({ where: { empresaId, data: dia, OR: [{ filialId: null }, { filialId: filialId ?? "-" }] } }),
    prisma.afastamento.findFirst({ where: { funcionarioId, status: "APROVADO", inicio: { lte: dia }, fim: { gte: dia } } }),
  ]);
  return !!(feriado || afastamento);
}

export function iniciarAlertas() {
  if (process.env.ALERTAS_ATIVOS === "false") return;
  const rodar = () => verificarAlertas().catch((e) => console.error("Erro nos alertas:", e));
  setInterval(rodar, 60_000);
  setTimeout(rodar, 5_000);
}
