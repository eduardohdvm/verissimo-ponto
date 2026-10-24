import { api, dataBr, esc } from "/app.js";
import { abrirModal, aoClicar, aoEnviar, conteudo, modal, opcoes, topo, verFoto } from "./ui.js";

export const NOME_AFASTAMENTO = {
  FERIAS: "Férias", ATESTADO: "Atestado médico", LICENCA: "Licença", FOLGA: "Folga / compensação", OUTRO: "Outro",
};
const STATUS = { PENDENTE: ["Pendente", "warn"], APROVADO: ["Aprovado", "ok"], REJEITADO: ["Rejeitado", "danger"] };
const filtro = { ano: String(new Date().getFullYear()), funcionarioId: "" };

const diasCorridos = (a) => Math.round((Date.parse(a.fim) - Date.parse(a.inicio)) / 86400_000) + 1;

/** Lê um arquivo do input como data URL (foto do atestado ou PDF). */
export const lerArquivo = (arquivo) =>
  new Promise((ok, erro) => {
    if (!arquivo) return ok(null);
    if (arquivo.size > 4 * 1024 * 1024) return erro(new Error("Arquivo muito grande (máximo 4 MB)"));
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = () => erro(new Error("Não foi possível ler o arquivo"));
    r.readAsDataURL(arquivo);
  });

export async function telaAfastamentos() {
  const [lista, funcionarios] = await Promise.all([
    api("GET", `/api/admin/afastamentos?ano=${filtro.ano}${filtro.funcionarioId ? `&funcionarioId=${filtro.funcionarioId}` : ""}`),
    api("GET", "/api/admin/funcionarios"),
  ]);
  const ativos = funcionarios.filter((f) => f.ativo);
  const ano = new Date().getFullYear();
  conteudo().innerHTML = `${topo("Férias e afastamentos", `<button class="primary" id="novo">Registrar afastamento</button>`)}
    <div class="card stack">
      <div class="acoes">
        <select id="ano" style="width:auto">${[ano - 1, ano, ano + 1].map((a) => `<option ${String(a) === filtro.ano ? "selected" : ""}>${a}</option>`).join("")}</select>
        <select id="func" style="width:auto">${opcoes(ativos, filtro.funcionarioId, "Todos os funcionários")}</select>
      </div>
      <p class="muted small">Dias de férias, atestado, licença e folga não contam como falta nem geram débito no banco de horas.</p>
      ${lista.length ? `<div class="tabela-wrap"><table>
        <thead><tr><th>Funcionário</th><th>Tipo</th><th>Período</th><th>Dias</th><th>Observação</th><th>Situação</th><th></th></tr></thead>
        <tbody>${lista.map((a) => `<tr><td>${esc(a.funcionario.nome)}</td><td>${NOME_AFASTAMENTO[a.tipo]}</td>
          <td class="tnum">${dataBr(a.inicio)}${a.fim !== a.inicio ? ` a ${dataBr(a.fim)}` : ""}</td><td class="tnum">${diasCorridos(a)}</td>
          <td class="small">${esc(a.observacao ?? "")}</td>
          <td><span class="tag ${STATUS[a.status][1]}">${STATUS[a.status][0]}</span></td>
          <td class="num">${a.temAnexo ? `<button class="sm" data-anexo="${a.id}">Anexo</button> ` : ""}<button class="sm danger" data-remover="${a.id}">Remover</button></td></tr>`).join("")}
        </tbody></table></div>` : '<p class="muted">Nenhum afastamento neste ano.</p>'}
    </div>`;
  document.getElementById("ano").onchange = (e) => { filtro.ano = e.target.value; telaAfastamentos(); };
  document.getElementById("func").onchange = (e) => { filtro.funcionarioId = e.target.value; telaAfastamentos(); };
  document.getElementById("novo").onclick = () => formAfastamento(ativos);
  aoClicar(conteudo(), "anexo", (id) => verFoto(`/api/admin/afastamentos/${id}/anexo`, "Anexo"));
  aoClicar(conteudo(), "remover", (id) =>
    confirm("Remover este afastamento? Os dias voltam a contar normalmente no espelho.") &&
    api("DELETE", `/api/admin/afastamentos/${id}`).then(telaAfastamentos, (e) => alert(e.message)));
}

function formAfastamento(funcionarios) {
  abrirModal(`<form>
    <h2>Registrar afastamento</h2>
    <label>Funcionário<select name="funcionarioId" required>${opcoes(funcionarios, filtro.funcionarioId, "Escolha…")}</select></label>
    <label>Tipo<select name="tipo">${Object.entries(NOME_AFASTAMENTO).map(([v, n]) => `<option value="${v}">${n}</option>`).join("")}</select></label>
    <div class="grid2">
      <label>Início<input name="inicio" type="date" required></label>
      <label>Fim<input name="fim" type="date" required></label>
    </div>
    <label>Observação<input name="observacao" placeholder="Ex.: CID, número do atestado, período aquisitivo"></label>
    <label>Anexo (foto ou PDF, opcional)<input name="anexo" type="file" accept="image/*,application/pdf"></label>
    <div class="acoes"><button class="primary">Salvar</button><button type="button" data-fechar>Cancelar</button></div>
  </form>`, (m) => {
    const form = m.querySelector("form");
    form.inicio.onchange = () => { if (!form.fim.value || form.fim.value < form.inicio.value) form.fim.value = form.inicio.value; };
    aoEnviar(form, async (fd) => {
      if (!fd.get("funcionarioId")) throw new Error("Escolha o funcionário");
      await api("POST", `/api/admin/funcionarios/${fd.get("funcionarioId")}/afastamentos`, {
        tipo: fd.get("tipo"), inicio: fd.get("inicio"), fim: fd.get("fim"),
        observacao: fd.get("observacao") || null, anexo: await lerArquivo(form.anexo.files[0]),
      });
      modal().close();
      telaAfastamentos();
    });
  });
}
