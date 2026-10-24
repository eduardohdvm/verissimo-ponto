import { api, esc, periodoDoMes } from "/app.js";
import { aoEnviar, baixar, conteudo, erroNo, topo } from "./ui.js";

function mesAnterior() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function telaFolha() {
  const [c, regras] = await Promise.all([api("GET", "/api/admin/folha/config"), api("GET", "/api/admin/regras")]);
  const percentuais = [...new Set([...regras.faixasExtra.map((f) => String(f.percentual)), String(regras.percentualDomingoFeriado)])];
  const sel = (nome, valor, opcoes) =>
    `<select name="${nome}">${opcoes.map(([v, t]) => `<option value="${v}" ${v === valor ? "selected" : ""}>${t}</option>`).join("")}</select>`;
  conteudo().innerHTML = `${topo("Exportar para a folha")}
    <div class="stack">
      <form class="card" id="form-exportar">
        <h2>Gerar arquivo</h2>
        <p class="muted small">Usa o espelho de cada funcionário ativo no mês (o espelho congelado, se o mês já foi fechado).
          O ideal é fechar o mês antes de exportar.</p>
        <div class="acoes">
          <input type="month" name="mes" value="${mesAnterior()}" style="width:auto">
          <button class="primary">Baixar arquivo</button>
          <button type="button" id="previa">Ver prévia</button>
        </div>
        <pre id="amostra" class="mono oculto" style="background:var(--surface-2);padding:12px;border-radius:8px;overflow:auto;max-height:240px;margin-top:12px"></pre>
      </form>
      <form class="card" id="form-config">
        <h2>Formato do arquivo</h2>
        <p class="muted small">Configure igual à tela de importação de eventos do seu sistema de folha. Eventos sem código não são exportados.</p>
        <div class="grid2">
          <label>Formato${sel("formato", c.formato, [["EVENTOS", "Uma linha por evento (importação de eventos)"], ["RESUMO", "Uma linha por funcionário (planilha)"]])}</label>
          <label>Identificar o funcionário por${sel("identificador", c.identificador, [["MATRICULA", "Matrícula"], ["CPF", "CPF"], ["CODIGO_EXTERNO", "Código no ERP"]])}</label>
          <label>Separador${sel("separador", c.separador, [[";", "Ponto e vírgula (;)"], [",", "Vírgula (,)"], ["TAB", "Tabulação"]])}</label>
          <label>Horas em${sel("formatoHoras", c.formatoHoras, [["DECIMAL", "Decimal (8,50)"], ["HH:MM", "Horas e minutos (08:30)"]])}</label>
        </div>
        <label class="check"><input type="checkbox" name="cabecalho" ${c.cabecalho ? "checked" : ""}> Primeira linha com os nomes das colunas</label>
        <h3 style="margin-top:16px">Códigos dos eventos na folha</h3>
        <div class="grid2">
          <label>Horas trabalhadas<input name="trabalhadas" value="${esc(c.codigos.trabalhadas)}"></label>
          ${percentuais.map((p) => `<label>Hora extra ${p}%<input name="extra-${p}" value="${esc(c.codigos.extras[p] ?? "")}"></label>`).join("")}
          <label>Adicional noturno (horas)<input name="noturno" value="${esc(c.codigos.noturno)}"></label>
          <label>Faltas (dias)<input name="faltas" value="${esc(c.codigos.faltas)}"></label>
          <label>Atrasos (horas)<input name="atrasos" value="${esc(c.codigos.atrasos)}"></label>
          <label>Horas a descontar<input name="debito" value="${esc(c.codigos.debito)}"></label>
        </div>
        <div class="acoes"><button class="primary">Salvar formato</button></div>
      </form>
    </div>`;
  const formConfig = document.getElementById("form-config");
  aoEnviar(formConfig, async (fd) => {
    await api("PUT", "/api/admin/folha/config", {
      formato: fd.get("formato"), identificador: fd.get("identificador"), separador: fd.get("separador"),
      formatoHoras: fd.get("formatoHoras"), cabecalho: fd.has("cabecalho"),
      codigos: {
        trabalhadas: fd.get("trabalhadas"), noturno: fd.get("noturno"), faltas: fd.get("faltas"),
        atrasos: fd.get("atrasos"), debito: fd.get("debito"),
        extras: Object.fromEntries(percentuais.map((p) => [p, fd.get(`extra-${p}`)])),
      },
    });
    erroNo(formConfig, new Error("Formato salvo."));
    formConfig.querySelector(".alerta").className = "alerta ok";
  });
  const formExp = document.getElementById("form-exportar");
  const periodo = () => periodoDoMes(formExp.mes.value);
  aoEnviar(formExp, async () => {
    const { inicio, fim } = periodo();
    await baixar(`/api/admin/folha/exportar?inicio=${inicio}&fim=${fim}`, `folha_${formExp.mes.value}.csv`);
  });
  document.getElementById("previa").onclick = async () => {
    const { inicio, fim } = periodo();
    const r = await api("GET", `/api/admin/folha/exportar?inicio=${inicio}&fim=${fim}&previa=true`);
    const amostra = document.getElementById("amostra");
    amostra.classList.remove("oculto");
    amostra.textContent = (r.amostra.trim() || "(nenhum evento com código configurado)") +
      (r.semIdentificador.length ? `\n\nAtenção: sem identificador (${r.semIdentificador.length}): ${r.semIdentificador.join(", ")}` : "");
  };
}
