// Alertas automáticos, conferidos a cada minuto:
// - lembrete ao funcionário 5 min antes da entrada, se ainda não bateu o ponto;
// - aviso aos gestores quando a entrada atrasa mais de 15 min;
// - aviso ao funcionário quando a saída não foi batida 1h depois do fim da jornada.
// Cada alerta tem uma chave única por dia, então nunca é enviado duas vezes.
// No Render grátis o servidor dorme sem uso; enquanto dorme, os alertas não rodam.
import { prisma } from "../db.js";
import { intervalosPrevistos, type ConfigJornada } from "../lib/calculo.js";
import { horaParaMin, partesLocais, somarDias, utcDeLocal } from "../lib/tempo.js";
import { notificar, responsaveisPor } from "./notificacoes.js";

const JANELA_MIN = 10; // tolerância para não perder um alerta se o servidor atrasar alguns minutos
const dentro = (agora: number, alvo: number) => agora >= alvo && agora < alvo + JANELA_MIN;

export async function verificarAlertas(agora = new Date()) {
  const empresas = await prisma.empresa.findMany({ where: { bloqueada: false }, select: { id: true, fusoHorario: true } });
  for (const emp of empresas) {
    const { data: hoje, minutoDoDia } = partesLocais(agora, emp.fusoHorario);
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
      const atraso = dentro(minutoDoDia, entrada + 15);
      const semSaida = dentro(minutoDoDia, saida + 60);
      if (!lembrete && !atraso && !semSaida) continue;

      // Só consulta o banco quando algum alerta está na janela
      const [folga, marcacoes] = await Promise.all([
        diaDeFolga(emp.id, f.id, f.filialId, hoje),
        prisma.marcacao.count({
          where: {
            funcionarioId: f.id,
            dataHora: { gte: utcDeLocal(hoje, "00:00", emp.fusoHorario), lt: utcDeLocal(somarDias(hoje, 1), "00:00", emp.fusoHorario) },
          },
        }),
      ]);
      if (folga) continue;
      const usuario = f.usuario?.ativo ? f.usuario : null;

      if (lembrete && marcacoes === 0 && usuario) {
        await notificar(emp.id, usuario.id, "Hora de bater o ponto", `Sua entrada está prevista para ${intervalos[0][0]}.`, "/ponto", `lembrete:${f.id}:${hoje}`);
      }
      if (atraso && marcacoes === 0) {
        for (const r of await responsaveisPor(emp.id, f.departamentoId)) {
          await notificar(emp.id, r.id, "Entrada não registrada", `${f.nome} ainda não bateu o ponto (entrada prevista ${intervalos[0][0]}).`,
            "/admin#painel", `atraso:${f.id}:${hoje}:${r.id}`);
        }
      }
      if (semSaida && marcacoes % 2 === 1 && usuario) {
        await notificar(emp.id, usuario.id, "Esqueceu de bater a saída?", "Sua última marcação de hoje foi uma entrada. Se já saiu, peça o ajuste no app.",
          "/ponto#ajuste", `saida:${f.id}:${hoje}`);
      }
    }
  }
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
