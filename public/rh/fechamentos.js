import { api, dataBr, esc, periodoDoMes, saldo } from "/app.js";
import { abrirModal, aoClicar, aoEnviar, conteudo, modal, topo } from "./ui.js";

const STATUS = { PENDENTE: ["Aguardando", "warn"], ASSINADO: ["Assinado", "ok"], CONTESTADO: ["Contestado", "danger"] };

function mesAnterior() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function telaFechamentos() {
  const lista = await api("GET", "/api/admin/fechamentos");
  conteudo().innerHTML = `${topo("Fechamento do mês")}
    <div class="stack">
      <form class="card" id="form-fechar">
        <h2>Fechar um período</h2>
        <p class="muted small">Fechar congela o espelho de cada funcionário: ajustes e afastamentos nesse período ficam bloqueados,
          e cada funcionário recebe o espelho no app para assinar (com a senha dele) ou contestar.
          O saldo do mês entra no banco de horas acumulado.</p>
        <div class="acoes">
          <label style="margin:0">Mês<input type="month" name="mes" value="${mesAnterior()}" style="width:auto"></label>
          <button class="primary">Fechar período</button>
        </div>
      </form>
      <div class="card">
        <h2>Períodos fechados</h2>
        ${lista.length ? `<div class="tabela-wrap"><table>
          <thead><tr><th>Período</th><th>Fechado em</th><th>Assinaturas</th><th>Situação</th><th></th></tr></thead>
          <tbody>${lista.map((f) => `<tr>
            <td class="tnum">${dataBr(f.inicio)} a ${dataBr(f.fim)}</td>
            <td class="tnum">${new Date(f.fechadoEm).toLocaleDateString("pt-BR")}</td>
            <td>${f.assinados} de ${f.total}${f.contestados ? ` · <span class="tag danger">${f.contestados} contestado(s)</span>` : ""}</td>
            <td>${f.status === "FECHADO" ? '<span class="tag ok">Fechado</span>' : `<span class="tag" title="${esc(f.motivoReabertura ?? "")}">Reaberto</span>`}</td>
            <td class="num"><button class="sm" data-ver="${f.id}">Ver</button></td></tr>`).join("")}</tbody></table></div>`
          : '<p class="muted">Nenhum período fechado ainda.</p>'}
      </div>
    </div>`;
  const form = document.getElementById("form-fechar");
  aoEnviar(form, async (fd) => {
    const { inicio, fim } = periodoDoMes(fd.get("mes"));
    try {
      await api("POST", "/api/admin/fechamentos", { inicio, fim });
    } catch (e) {
      if (e.status !== 409 || !e.message.includes("pendentes")) throw e;
      if (!confirm(`${e.message}\n\nFechar mesmo assim?`)) return;
      await api("POST", "/api/admin/fechamentos", { inicio, fim, forcar: true });
    }
    telaFechamentos();
  });
  aoClicar(conteudo(), "ver", verFechamento);
}

async function verFechamento(id) {
  const f = await api("GET", `/api/admin/fechamentos/${id}`);
  abrirModal(`<h2>${dataBr(f.inicio)} a ${dataBr(f.fim)}</h2>
    ${f.status === "REABERTO" ? `<p class="alerta warn small">Reaberto em ${new Date(f.reabertoEm).toLocaleString("pt-BR")}: ${esc(f.motivoReabertura)}</p>` : ""}
    <div class="tabela-wrap" style="max-height:50vh"><table>
      <thead><tr><th>Funcionário</th><th>Saldo</th><th>Situação</th><th></th></tr></thead>
      <tbody>${f.assinaturas.map((a) => `<tr><td>${esc(a.funcionario.nome)}<br><span class="muted small">${esc(a.funcionario.departamento?.nome ?? "")}</span>
        ${a.status === "CONTESTADO" ? `<div class="small" style="color:var(--danger)">${esc(a.observacao)}</div>` : ""}</td>
        <td class="tnum">${saldo(a.saldoBancoMin)}</td>
        <td><span class="tag ${STATUS[a.status][1]}">${STATUS[a.status][0]}</span>${a.assinadoEm ? `<br><span class="muted small">${new Date(a.assinadoEm).toLocaleString("pt-BR")}</span>` : ""}</td>
        <td><a class="btn sm" href="/espelho-assinado?id=${a.id}" target="_blank">Abrir</a></td></tr>`).join("")}</tbody>
    </table></div>
    ${f.status === "FECHADO" ? `<form style="margin-top:16px" id="form-reabrir">
      <h3>Reabrir o período</h3>
      <p class="muted small">Use para corrigir um erro (por exemplo, depois de uma contestação). O fechamento atual fica guardado no histórico; depois de corrigir, feche de novo para gerar novos espelhos.</p>
      <label>Motivo<input name="motivo" required></label>
      <div class="acoes"><button class="primary danger">Reabrir</button><button type="button" data-fechar>Fechar</button></div>
    </form>` : `<div class="acoes" style="margin-top:16px"><button data-fechar>Fechar</button></div>`}`, (m) => {
    const form = m.querySelector("#form-reabrir");
    if (form) {
      aoEnviar(form, async (fd) => {
        await api("POST", `/api/admin/fechamentos/${id}/reabrir`, { motivo: fd.get("motivo") });
        modal().close();
        telaFechamentos();
      });
    }
  });
}

