import { api, esc, hhmm, mesAtual, saldo } from "/app.js";
import { conteudo, topo } from "./ui.js";

const estadoInd = { mes: mesAtual() };
const pct = (v) => `${(v * 100).toFixed(1).replace(".", ",")}%`;
const ORIGEM = { MOBILE: "Celular", WEB: "Computador", QUIOSQUE: "Quiosque" };

/** Barra horizontal de magnitude (uma cor, valor sempre escrito ao lado; o título mostra o detalhe). */
const barra = (valor, maximo, texto, detalhe) => `<div class="barra-ind" title="${esc(detalhe)}">
  <span class="trilho"><i style="width:${maximo > 0 ? Math.max(2, (Math.abs(valor) / maximo) * 100) : 0}%"></i></span>
  <span class="tnum">${texto}</span></div>`;

export async function telaIndicadores() {
  conteudo().innerHTML = `${topo("Indicadores", `<input type="month" id="mes" value="${estadoInd.mes}" style="width:auto">`)}<div id="ind"><p class="muted">Calculando…</p></div>`;
  document.getElementById("mes").onchange = (e) => { estadoInd.mes = e.target.value; telaIndicadores(); };
  const r = await api("GET", `/api/admin/indicadores?mes=${estadoInd.mes}`);
  const t = r.total;
  const max = (campo) => Math.max(0, ...r.departamentos.map((d) => Math.abs(d[campo])));
  const maiores = [...r.pessoas].sort((a, b) => b.banco - a.banco);
  document.getElementById("ind").innerHTML = `<div class="stack">
    <div class="kpis">
      <div class="card kpi"><div class="valor">${pct(t.absenteismo)}</div><div class="rotulo">Absenteísmo (${t.faltas} falta(s) em ${t.diasPrevistos} dias de trabalho)</div></div>
      <div class="card kpi"><div class="valor">${hhmm(t.extraMin) === "—" ? "00:00" : hhmm(t.extraMin)}</div><div class="rotulo">Horas extras no mês</div></div>
      <div class="card kpi"><div class="valor">${t.atrasos}</div><div class="rotulo">Atrasos (${hhmm(t.atrasoMin) === "—" ? "0 min" : hhmm(t.atrasoMin)} no total)</div></div>
      <div class="card kpi"><div class="valor">${saldo(t.bancoMin)}</div><div class="rotulo">Banco de horas da equipe</div></div>
    </div>

    <div class="card">
      <h2>Agora</h2>
      ${r.agora.length ? `<p class="muted small">${r.agora.length} pessoa(s) com o turno aberto.</p>
        <div id="mapa" class="oculto" style="height:260px;border-radius:10px;margin-bottom:12px"></div>
        <div class="tabela-wrap"><table><thead><tr><th>Funcionário</th><th>Departamento</th><th>Entrou</th><th>Última marcação</th></tr></thead>
        <tbody>${r.agora.map((a) => `<tr><td>${esc(a.funcionario)}</td><td>${esc(a.departamento ?? "—")}</td><td class="tnum">${a.desde}</td>
          <td class="tnum">${a.ultima} <span class="muted small">${ORIGEM[a.origem] ?? ""}</span></td></tr>`).join("")}</tbody></table></div>`
        : '<p class="muted">Ninguém com o turno aberto agora.</p>'}
    </div>

    <div class="card">
      <h2>Por departamento</h2>
      ${r.departamentos.length ? `<div class="tabela-wrap"><table class="tabela-ind">
        <thead><tr><th>Departamento</th><th class="num">Pessoas</th><th>Absenteísmo</th><th>Horas extras</th><th>Atrasos</th><th>Banco de horas</th></tr></thead>
        <tbody>${r.departamentos.map((d) => `<tr><td><strong>${esc(d.nome)}</strong></td><td class="num">${d.funcionarios}</td>
          <td>${barra(d.absenteismo, max("absenteismo"), pct(d.absenteismo), `${d.faltas} falta(s) em ${d.diasPrevistos} dias`)}</td>
          <td>${barra(d.extraMin, max("extraMin"), hhmm(d.extraMin) === "—" ? "00:00" : hhmm(d.extraMin), `${d.extraMin} minutos`)}</td>
          <td>${barra(d.atrasos, max("atrasos"), String(d.atrasos), `${d.atrasoMin} minutos de atraso`)}</td>
          <td>${barra(d.bancoMin, max("bancoMin"), saldo(d.bancoMin), d.bancoMin >= 0 ? "Saldo positivo (a compensar ou pagar)" : "Saldo negativo (horas devidas)")}</td></tr>`).join("")}
        </tbody></table></div>` : '<p class="muted">Sem funcionários ativos.</p>'}
    </div>

    ${maiores.length ? `<div class="grid2" style="gap:16px">
      <div class="card"><h2>Maiores saldos no banco</h2>${listaPessoas(maiores.filter((p) => p.banco > 0).slice(0, 5))}</div>
      <div class="card"><h2>Saldos negativos</h2>${listaPessoas(maiores.filter((p) => p.banco < 0).reverse().slice(0, 5))}</div>
    </div>` : ""}
  </div>`;
  const comLocal = r.agora.filter((a) => a.latitude != null && a.longitude != null);
  if (comLocal.length) desenharMapa(comLocal).catch(() => {});
}

const listaPessoas = (lista) => lista.length
  ? `<table><tbody>${lista.map((p) => `<tr><td>${esc(p.nome)}<br><span class="muted small">${esc(p.departamento)}</span></td>
      <td class="num tnum"><strong>${saldo(p.banco)}</strong></td></tr>`).join("")}</tbody></table>`
  : '<p class="muted small">Ninguém.</p>';

/** Mapa (Leaflet + OpenStreetMap) com a última marcação de quem está trabalhando. */
async function desenharMapa(pontos) {
  if (!window.L) {
    const css = Object.assign(document.createElement("link"), { rel: "stylesheet", href: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" });
    document.head.append(css);
    await new Promise((ok, erro) => {
      const s = Object.assign(document.createElement("script"), { src: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", onload: ok, onerror: erro });
      document.head.append(s);
    });
  }
  const el = document.getElementById("mapa");
  if (!el) return;
  el.classList.remove("oculto");
  const mapa = window.L.map(el);
  window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "&copy; OpenStreetMap",
  }).addTo(mapa);
  const marcas = pontos.map((p) => window.L.marker([p.latitude, p.longitude]).bindPopup(`${esc(p.funcionario)} · ${p.ultima}`).addTo(mapa));
  mapa.fitBounds(window.L.featureGroup(marcas).getBounds().pad(0.3), { maxZoom: 16 });
}
