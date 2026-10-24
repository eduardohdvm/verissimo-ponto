import { api, dataBr, DIAS, esc } from "/app.js";
import { abrirModal, aoClicar, aoEnviar, conteudo, modal, topo } from "./ui.js";
import { cardRegras } from "./regras.js";

const intervalosTexto = (lista) => (lista ?? []).map(([a, b]) => `${a}-${b}`).join(", ");
function lerIntervalos(texto) {
  const t = texto.trim();
  if (!t || t.toLowerCase() === "folga") return [];
  return t.split(",").map((parte) => {
    const m = parte.trim().match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
    if (!m) throw new Error(`Horário inválido: "${parte.trim()}". Use o formato 08:00-12:00`);
    return [m[1].padStart(5, "0"), m[2].padStart(5, "0")];
  });
}

export async function telaJornadas() {
  const lista = await api("GET", "/api/admin/jornadas");
  const resumo = (c) => c.tipo === "SEMANAL"
    ? DIAS.map((d, i) => (c.dias[i]?.length ? `${d} ${intervalosTexto(c.dias[i])}` : null)).filter(Boolean).join(" · ")
    : `Ciclo de ${c.ciclo.length} dias a partir de ${dataBr(c.dataBase)}`;
  conteudo().innerHTML = `${topo("Jornadas e regras", `<button class="primary" id="nova">Nova jornada</button>`)}
    <div class="stack">
      <div class="card"><h2>Jornadas</h2><div class="tabela-wrap"><table>
        <thead><tr><th>Nome</th><th>Horários</th><th>Tolerância</th><th></th></tr></thead>
        <tbody>${lista.map((j) => `<tr><td><strong>${esc(j.nome)}</strong></td><td class="small">${esc(resumo(j.config))}</td>
          <td>${j.toleranciaMin} min</td><td><button class="sm" data-editar="${j.id}">Editar</button></td></tr>`).join("")}</tbody>
      </table></div></div>
      <div id="regras"></div>
    </div>`;
  document.getElementById("nova").onclick = () => formJornada(null);
  aoClicar(conteudo(), "editar", (id) => formJornada(lista.find((j) => j.id === id)));
  await cardRegras(document.getElementById("regras"));
}

function formJornada(j) {
  const c = j?.config ?? { tipo: "SEMANAL", dias: {} };
  const ciclo = c.tipo === "CICLO" ? c : { dataBase: new Date().toISOString().slice(0, 10), ciclo: [[["07:00", "19:00"]], []] };
  abrirModal(`<form>
    <h2>${j ? "Editar jornada" : "Nova jornada"}</h2>
    <div class="grid2">
      <label>Nome<input name="nome" value="${esc(j?.nome ?? "")}" required></label>
      <label>Tolerância diária (min)<input name="tol" type="number" min="0" max="30" value="${j?.toleranciaMin ?? 10}"></label>
    </div>
    <label>Tipo<select name="tipo">
      <option value="SEMANAL" ${c.tipo === "SEMANAL" ? "selected" : ""}>Semanal (mesmo horário toda semana)</option>
      <option value="CICLO" ${c.tipo === "CICLO" ? "selected" : ""}>Escala em ciclo (12x36, 6x2…)</option>
    </select></label>
    <div id="semanal">
      <p class="muted small">Intervalos separados por vírgula, ex.: 08:00-12:00, 13:00-17:48. Deixe vazio para folga.</p>
      ${DIAS.map((d, i) => `<label>${d}<input name="d${i}" value="${intervalosTexto(c.tipo === "SEMANAL" ? c.dias[i] : [])}"></label>`).join("")}
    </div>
    <div id="ciclo">
      <label>Primeiro dia do ciclo<input name="dataBase" type="date" value="${ciclo.dataBase}"></label>
      <label>Um dia por linha (vazio = folga)<textarea name="ciclo" rows="5">${ciclo.ciclo.map(intervalosTexto).join("\n")}</textarea></label>
      <p class="muted small">12x36: primeira linha 07:00-19:00, segunda linha vazia.</p>
    </div>
    <div class="acoes"><button class="primary">Salvar</button><button type="button" data-fechar>Cancelar</button></div>
  </form>`, (m) => {
    const form = m.querySelector("form");
    const alternar = () => {
      m.querySelector("#semanal").classList.toggle("oculto", form.tipo.value !== "SEMANAL");
      m.querySelector("#ciclo").classList.toggle("oculto", form.tipo.value !== "CICLO");
    };
    form.tipo.onchange = alternar;
    alternar();
    aoEnviar(form, async (fd) => {
      const config = fd.get("tipo") === "SEMANAL"
        ? { tipo: "SEMANAL", dias: Object.fromEntries(DIAS.map((_, i) => [String(i), lerIntervalos(fd.get(`d${i}`))])) }
        : { tipo: "CICLO", dataBase: fd.get("dataBase"), ciclo: fd.get("ciclo").replace(/\r/g, "").split("\n").map(lerIntervalos) };
      await api(j ? "PUT" : "POST", j ? `/api/admin/jornadas/${j.id}` : "/api/admin/jornadas", {
        nome: fd.get("nome"), toleranciaMin: Number(fd.get("tol")), config,
      });
      modal().close();
      telaJornadas();
    });
  });
}
