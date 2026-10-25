// "Minhas notificações": cada gestor/administrador escolhe quais avisos da equipe quer receber e por onde.
import { api, esc } from "/app.js";
import { ativarPush, estadoPush } from "/push.js";
import { conteudo, ehAdmin, erroNo, topo } from "./ui.js";

const CANAIS = [["OFF", "Desligado"], ["APP", "No painel e no celular"], ["APP_EMAIL", "No painel, no celular e por e-mail"]];

// [chave, título, explicação, opção extra: [campo, rótulo, [[valor, texto]...]]]
const EVENTOS = [
  ["batida", "Batida de ponto da equipe", "A cada entrada ou saída registrada.",
    ["modo", "Quais batidas", [["FORA_DO_HORARIO", "Só as fora do horário (mais de 15 min de diferença)"], ["TODAS", "Todas"]]]],
  ["atraso", "Entrada não registrada", "Quando alguém ainda não bateu a entrada depois do horário previsto.",
    ["minutos", "Avisar depois de", [[15, "15 minutos"], [30, "30 minutos"], [60, "1 hora"]]]],
  ["batidaFaltando", "Dia encerrado com batida faltando", "Quando o dia termina sem todas as batidas previstas, ou sem nenhuma.",
    ["horasDepois", "Conferir", [[1, "1 hora depois do fim da jornada"], [2, "2 horas depois"], [4, "4 horas depois"]]]],
  ["horaExtra", "Hora extra acima do limite", "Quando alguém passa de 2h extras no dia (limite da CLT)."],
  ["solicitacoes", "Pedidos de ajuste e atestados", "Quando alguém da equipe pede ajuste ou envia atestado para você aprovar."],
  ["contestacoes", "Espelho contestado", "Quando alguém contesta o espelho do mês fechado."],
  ["facialRecusado", "Rosto recusado", "Quando o reconhecimento facial recusa uma batida (possível fraude)."],
  ["resumoDiario", "Resumo diário", "Um aviso só por dia com faltas, atrasos, batidas faltando e horas extras do dia anterior.",
    ["hora", "Receber às", ["06:00", "07:00", "08:00", "09:00", "10:00", "12:00", "18:00"].map((h) => [h, h])]],
];

export async function telaMinhasNotificacoes() {
  const [{ preferencias: p, email, emailConfigurado }, push] = await Promise.all([api("GET", "/api/admin/minhas-notificacoes"), estadoPush()]);
  const sel = (nome, valor, opcoes) =>
    `<select name="${nome}">${opcoes.map(([v, t]) => `<option value="${v}" ${String(v) === String(valor) ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
  conteudo().innerHTML = `${topo("Minhas notificações")}
    <div class="stack">
      <div class="card">
        <p style="margin-top:0">Escolha quais avisos ${ehAdmin() ? "da empresa" : "da sua equipe"} você quer receber e por onde.
          ${ehAdmin() ? "Como administrador, você recebe os avisos de todos os departamentos." : "Você recebe só os avisos dos departamentos que gere."}</p>
        <div class="acoes">
          ${push === "ATIVO" ? '<span class="tag ok">Avisos ligados neste aparelho</span>'
            : push === "INATIVO" ? '<button id="ativar-push">Receber avisos neste aparelho</button>'
            : `<span class="tag warn">${push === "BLOQUEADO" ? "Avisos bloqueados no navegador" : "Este navegador não recebe avisos"}</span>`}
          <button id="testar">Enviar aviso de teste</button>
          <span class="muted small">E-mail: ${esc(email)}${emailConfigurado ? "" : " · envio de e-mail ainda não configurado no servidor"}</span>
        </div>
      </div>
      <form class="card" id="form-pref">
        <div class="tabela-wrap"><table class="tabela-pref">
          <thead><tr><th>Aviso</th><th>Receber</th><th>Opção</th></tr></thead>
          <tbody>${EVENTOS.map(([chave, titulo, texto, extra]) => `<tr>
            <td><strong>${titulo}</strong><br><span class="muted small">${texto}</span></td>
            <td>${sel(`${chave}.canal`, p[chave].canal, CANAIS)}</td>
            <td>${extra ? `<label class="small" style="margin:0">${extra[1]}${sel(`${chave}.${extra[0]}`, p[chave][extra[0]], extra[2])}</label>` : ""}</td></tr>`).join("")}
          </tbody></table></div>
        <div class="acoes" style="margin-top:12px"><button class="primary">Salvar</button></div>
      </form>
    </div>`;

  const form = document.getElementById("form-pref");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const corpo = {};
    for (const [chave, , , extra] of EVENTOS) {
      corpo[chave] = { canal: fd.get(`${chave}.canal`) };
      if (extra) {
        const v = fd.get(`${chave}.${extra[0]}`);
        corpo[chave][extra[0]] = typeof extra[2][0][0] === "number" ? Number(v) : v;
      }
    }
    try {
      await api("PUT", "/api/admin/minhas-notificacoes", corpo);
      erroNo(form, new Error("Preferências salvas."));
      form.querySelector(".alerta").className = "alerta ok";
    } catch (err) {
      erroNo(form, err);
    }
  };
  document.getElementById("ativar-push")?.addEventListener("click", async () => {
    try {
      await ativarPush();
      telaMinhasNotificacoes();
    } catch (err) {
      alert(err.message);
    }
  });
  document.getElementById("testar").onclick = async (e) => {
    e.target.disabled = true;
    try {
      await api("POST", "/api/admin/minhas-notificacoes/teste", { email: emailConfigurado });
      e.target.textContent = emailConfigurado ? "Enviado (veja o sininho e o e-mail)" : "Enviado (veja o sininho)";
    } catch (err) {
      alert(err.message);
      e.target.disabled = false;
    }
  };
}
