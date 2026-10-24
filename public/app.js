// Funções compartilhadas entre as telas.

export const LOGO = `<svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="var(--primary)"/><circle cx="16" cy="16" r="9" fill="none" stroke="var(--primary-text)" stroke-width="2.4"/><path d="M16 11v5.5l3.5 2" fill="none" stroke="var(--primary-text)" stroke-width="2.4" stroke-linecap="round"/></svg>`;

export const token = {
  get: () => localStorage.getItem("token"),
  set: (t) => localStorage.setItem("token", t),
  limpar: () => localStorage.removeItem("token"),
};

export async function api(metodo, url, corpo) {
  const resp = await fetch(url, {
    method: metodo,
    headers: {
      ...(corpo !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token.get() ? { Authorization: `Bearer ${token.get()}` } : {}),
    },
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
  });
  if (resp.status === 401 && !url.startsWith("/api/auth/login")) {
    token.limpar();
    location.href = "/";
    throw new Error("Sessão expirada");
  }
  const tipo = resp.headers.get("content-type") ?? "";
  const dados = tipo.includes("json") ? await resp.json() : await resp.text();
  if (!resp.ok) throw Object.assign(new Error(dados?.erro ?? "Erro inesperado"), { status: resp.status });
  return dados;
}

/** Baixa um recurso autenticado e devolve uma URL local (para imagens e downloads). */
export async function blobAutenticado(url) {
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token.get()}` } });
  if (!resp.ok) throw new Error("Não foi possível carregar o arquivo");
  return URL.createObjectURL(await resp.blob());
}

export function sair() {
  token.limpar();
  location.href = "/";
}

export const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function hhmm(min) {
  if (!min) return "—";
  const sinal = min < 0 ? "-" : "";
  const a = Math.abs(Math.round(min));
  return `${sinal}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

export const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
export const diaSemana = (data) => DIAS[new Date(data + "T12:00:00Z").getUTCDay()];
export const dataBr = (data) => data.split("-").reverse().join("/");

export const OCORRENCIAS = {
  FALTA: ["Falta", "danger"],
  MARCACAO_IMPAR: ["Marcação ímpar", "warn"],
  ATRASO: ["Atraso", "warn"],
  INTERVALO_INSUFICIENTE: ["Intervalo < 1h", "warn"],
  INTERJORNADA_INSUFICIENTE: ["Interjornada < 11h", "warn"],
  HORA_EXTRA_ACIMA_LIMITE: ["Extra > 2h", "warn"],
};

export const tagsOcorrencias = (lista) =>
  lista.map((o) => `<span class="tag ${OCORRENCIAS[o]?.[1] ?? ""}">${OCORRENCIAS[o]?.[0] ?? o}</span>`).join(" ");

export function mesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function periodoDoMes(mes) {
  const [a, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { inicio: `${mes}-01`, fim: `${mes}-${String(ultimo).padStart(2, "0")}` };
}

export const NOME_AFASTAMENTO = {
  FERIAS: "Férias", ATESTADO: "Atestado", LICENCA: "Licença", FOLGA: "Folga", OUTRO: "Afastado",
};

/** Saldo sempre com sinal e 00:00 quando zerado (hhmm mostra "—" para zero). */
export const saldo = (min) => (min > 0 ? "+" : "") + (min ? hhmm(min) : "00:00");

/** Tabela do espelho de ponto; `acao(dia)` pode devolver HTML de uma coluna extra. */
export function tabelaEspelho(e, acao) {
  const percentuais = e.regras?.percentuais ?? Object.keys(e.totais.extras ?? {});
  const linhas = e.dias
    .map((d) => {
      const fds = d.previstoMin === 0 || d.feriado;
      const marc = d.marcacoes.map((m) => (m.incluida ? `<span title="Incluída por ajuste">${m.hora}*</span>` : m.hora)).join(" ");
      return `<tr class="${fds ? "fds" : ""}">
        <td class="tnum">${dataBr(d.data).slice(0, 5)} <span class="muted">${diaSemana(d.data)}</span></td>
        <td class="tnum">${marc || (d.feriado ? `<span class="muted">${esc(d.feriado)}</span>` : "")}</td>
        <td class="num">${hhmm(d.previstoMin)}</td>
        <td class="num">${hhmm(d.trabalhadoMin)}</td>
        ${percentuais.map((p) => `<td class="num">${hhmm(d.extras?.[p])}</td>`).join("")}
        <td class="num">${hhmm(d.noturnoReduzidoMin)}</td>
        <td class="num">${hhmm(d.debitoMin)}</td>
        <td>${d.afastamento ? `<span class="tag info">${NOME_AFASTAMENTO[d.afastamento] ?? d.afastamento}</span> ` : d.abonado ? '<span class="tag info">Abonado</span> ' : ""}${tagsOcorrencias(d.ocorrencias)}</td>
        ${acao ? `<td class="nao-imprimir">${acao(d)}</td>` : ""}
      </tr>`;
    })
    .join("");
  const t = e.totais;
  const resumo = [
    `${t.faltas} falta(s)`,
    t.atrasos ? `${t.atrasos} atraso(s)` : null,
    t.diasAfastado ? `${t.diasAfastado} dia(s) de afastamento` : null,
  ].filter(Boolean).join(" · ");
  return `<div class="tabela-wrap"><table>
    <thead><tr><th>Dia</th><th>Marcações</th><th class="num">Previsto</th><th class="num">Trabalhado</th>
      ${percentuais.map((p) => `<th class="num">Extra ${p}%</th>`).join("")}<th class="num">Noturno</th><th class="num">Débito</th>
      <th>Ocorrências</th>${acao ? '<th class="nao-imprimir"></th>' : ""}</tr></thead>
    <tbody>${linhas}</tbody>
    <tfoot><tr><td colspan="2">Totais · ${resumo}</td>
      <td class="num">${hhmm(t.previstoMin)}</td><td class="num">${hhmm(t.trabalhadoMin)}</td>
      ${percentuais.map((p) => `<td class="num">${hhmm(t.extras?.[p])}</td>`).join("")}
      <td class="num">${hhmm(t.noturnoReduzidoMin)}</td><td class="num">${hhmm(t.debitoMin)}</td>
      <td colspan="${acao ? 2 : 1}"></td></tr></tfoot>
  </table></div>
  <div class="acoes" style="margin-top:12px;gap:24px">
    <span>Saldo do período: <strong>${saldo(t.saldoBancoMin)}</strong></span>
    ${e.regras?.bancoHoras !== false && t.bancoAnteriorMin !== undefined ? `<span>Banco anterior: <strong>${saldo(t.bancoAnteriorMin)}</strong></span>
      <span>Banco acumulado: <strong>${saldo(t.bancoAcumuladoMin)}</strong></span>` : ""}
  </div>
  <p class="muted small">* marcação incluída por ajuste. A marcação original nunca é alterada.</p>`;
}
