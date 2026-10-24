import { api, dataBr, esc } from "/app.js";
import { aoClicar, conteudo, topo, verFoto } from "./ui.js";

const ORIGEM = { MOBILE: "Celular", WEB: "Computador", QUIOSQUE: "Quiosque" };

export async function telaPainel() {
  const p = await api("GET", "/api/admin/painel");
  const pendencias = p.tratamentosPendentes + p.afastamentosPendentes;
  conteudo().innerHTML = `${topo("Painel", `<span class="muted">${dataBr(p.hoje)}</span>`)}
    <div class="stack">
      <div class="kpis">
        <div class="card kpi"><div class="valor">${p.presentesHoje}<span class="muted" style="font-size:16px"> / ${p.funcionariosAtivos}</span></div><div class="rotulo">Bateram ponto hoje</div></div>
        <div class="card kpi"><div class="valor">${p.funcionariosAtivos - p.presentesHoje}</div><div class="rotulo">Ainda sem marcação</div></div>
        <div class="card kpi"><div class="valor">${pendencias}</div><div class="rotulo"><a href="#solicitacoes">Solicitações pendentes</a></div></div>
        <div class="card kpi"><div class="valor" style="${p.tentativasRecusadasHoje ? "color:var(--danger)" : ""}">${p.tentativasRecusadasHoje}</div><div class="rotulo">Rostos recusados hoje</div></div>
      </div>
      <div id="extra-painel" class="stack"></div>
      <div class="card oculto" id="tentativas"></div>
      <div class="card">
        <h2>Marcações de hoje</h2>
        ${p.ultimasMarcacoes.length ? `<div class="tabela-wrap"><table>
          <thead><tr><th>Hora</th><th>Funcionário</th><th>Origem</th><th>NSR</th><th></th></tr></thead>
          <tbody>${p.ultimasMarcacoes.map((m) => `<tr>
            <td class="tnum"><strong>${m.hora}</strong></td><td>${esc(m.funcionario)}</td>
            <td><span class="tag">${ORIGEM[m.origem] ?? m.origem}</span>
              ${m.provaVida ? `<span class="tag ${m.provaVida === "OFFLINE" ? "warn" : "ok"}" title="Distância ${m.distanciaFacial?.toFixed(2)}">${m.provaVida === "OFFLINE" ? "Rosto ok (offline)" : "Rosto ok"}</span>` : ""}</td>
            <td class="tnum muted">${m.nsr}</td>
            <td>${m.temSelfie ? `<button class="sm" data-selfie="${m.id}">Ver foto</button>` : ""}</td></tr>`).join("")}
          </tbody></table></div>` : `<p class="muted">Nenhuma marcação hoje ainda.</p>`}
      </div>
    </div>`;
  aoClicar(conteudo(), "selfie", (id) => verFoto(`/api/admin/marcacoes/${id}/selfie`, "Foto da marcação"));
  carregarTentativas();
  return p;
}

async function carregarTentativas() {
  const lista = await api("GET", "/api/admin/tentativas");
  const el = document.getElementById("tentativas");
  if (!el || !lista.length) return;
  el.classList.remove("oculto");
  el.innerHTML = `<h2>Reconhecimento facial recusado (últimos 7 dias)</h2>
    <p class="muted small">Tentativas de bater ponto em que o rosto não conferiu ou a prova de vida falhou. Vale conferir as fotos.</p>
    <div class="tabela-wrap"><table><thead><tr><th>Quando</th><th>Funcionário</th><th>Motivo</th><th></th></tr></thead>
    <tbody>${lista.map((t) => `<tr><td class="tnum">${dataBr(t.data).slice(0, 5)} ${t.hora}</td><td>${esc(t.funcionario)}</td>
      <td>${esc(t.motivo)}${t.distanciaFacial != null ? ` <span class="muted small">(distância ${t.distanciaFacial.toFixed(2)})</span>` : ""}</td>
      <td>${t.temFoto ? `<button class="sm" data-foto-tentativa="${t.id}">Ver foto</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`;
  aoClicar(el, "foto-tentativa", (id) => verFoto(`/api/admin/tentativas/${id}/foto`, "Tentativa recusada"));
}
