import { api, esc } from "/app.js";
import { aoEnviar, conteudo, erroNo, topo } from "./ui.js";

const reais = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export async function telaConta() {
  const c = await api("GET", "/api/admin/conta");
  const dias = c.trialAte ? Math.ceil((new Date(c.trialAte) - Date.now()) / 86400_000) : null;
  conteudo().innerHTML = `${topo("Conta e privacidade")}
    <div class="stack">
      <div class="card">
        <h2>Plano</h2>
        <div class="kpis">
          <div class="kpi"><div class="valor" style="font-size:22px">${esc(c.nomePlano)}</div>
            <div class="rotulo">${c.bloqueada ? '<span class="tag danger">Acesso suspenso</span>'
              : c.plano === "TRIAL" && dias !== null ? (dias > 0 ? `Teste termina em ${dias} dia(s)` : '<span class="tag danger">Teste encerrado</span>') : "Ativo"}</div></div>
          <div class="kpi"><div class="valor">${c.ativos}${c.limite ? `<span class="muted" style="font-size:16px"> / ${c.limite}</span>` : ""}</div><div class="rotulo">Funcionários ativos</div></div>
          ${c.plano !== "TRIAL" ? `<div class="kpi"><div class="valor" style="font-size:22px">${reais(c.valorMensal)}</div><div class="rotulo">Valor estimado do mês (${reais(c.precoPorFuncionario)} por funcionário)</div></div>` : ""}
        </div>
        <h3 style="margin-top:16px">Planos</h3>
        <div class="tabela-wrap"><table><thead><tr><th>Plano</th><th>Funcionários</th><th>Preço por funcionário/mês</th></tr></thead>
          <tbody>${c.planos.map((p) => `<tr><td><strong>${esc(p.nome)}</strong></td><td>${p.limiteFuncionarios ?? "Sem limite"}</td><td>${reais(p.precoPorFuncionario)}</td></tr>`).join("")}</tbody></table></div>
        ${c.contato ? `<p class="small" style="margin-bottom:0">Para contratar ou mudar de plano: <strong>${esc(c.contato)}</strong></p>` : ""}
      </div>
      <form class="card" id="form-privacidade">
        <h2>Privacidade (LGPD)</h2>
        <p class="muted small">Fotos das marcações (selfies e reconhecimento facial) são dado pessoal; a foto do rosto é dado biométrico, sensível.
          Defina por quanto tempo guardar: depois do prazo, a foto é apagada e a marcação continua registrada.
          Cada funcionário aceita o termo de uso dos dados no primeiro acesso ao app.</p>
        <label>Guardar fotos por (dias)<input type="number" name="dias" min="30" max="1825" value="${c.retencaoFotosDias}" style="max-width:140px"></label>
        <div class="acoes"><button class="primary">Salvar</button></div>
      </form>
    </div>`;
  const form = document.getElementById("form-privacidade");
  aoEnviar(form, async (fd) => {
    await api("PUT", "/api/admin/conta/privacidade", { retencaoFotosDias: Number(fd.get("dias")) });
    erroNo(form, new Error("Prazo salvo."));
    form.querySelector(".alerta").className = "alerta ok";
  });
}
