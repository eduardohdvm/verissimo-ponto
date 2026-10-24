import { api, dataBr, esc } from "/app.js";
import { aoClicar, conteudo, topo, verFoto } from "./ui.js";
import { NOME_AFASTAMENTO } from "./afastamentos.js";

const NOME_TIPO = { INCLUSAO: "Incluir marcação", DESCONSIDERAR: "Desconsiderar marcação", ABONO: "Abono" };

export async function telaSolicitacoes() {
  const [ajustes, afastamentos] = await Promise.all([
    api("GET", "/api/admin/tratamentos"),
    api("GET", "/api/admin/afastamentos?status=PENDENTE"),
  ]);
  const pendentes = ajustes.filter((t) => t.status === "PENDENTE");
  const historico = ajustes.filter((t) => t.status !== "PENDENTE").slice(0, 50);
  const botoes = (tipo, id) => `<div class="acoes"><button class="sm primary" data-aprovar="${tipo}:${id}">Aprovar</button><button class="sm danger" data-rejeitar="${tipo}:${id}">Rejeitar</button></div>`;
  const linhaAjuste = (t, comAcao) => `<tr>
    <td>${esc(t.funcionario.nome)}</td><td class="tnum">${dataBr(t.data)}</td>
    <td>${NOME_TIPO[t.tipo]}${t.hora ? ` <strong>${t.hora}</strong>` : ""}${t.horaMarcacao ? ` <strong>${t.horaMarcacao}</strong>` : ""}</td>
    <td>${esc(t.motivo)}</td>
    <td>${comAcao ? botoes("ajuste", t.id)
      : `<span class="tag ${t.status === "APROVADO" ? "ok" : "danger"}">${t.status === "APROVADO" ? "Aprovado" : "Rejeitado"}</span>`}</td></tr>`;
  const tabelaAjustes = (itens, comAcao) => `<div class="tabela-wrap"><table>
    <thead><tr><th>Funcionário</th><th>Dia</th><th>Pedido</th><th>Motivo</th><th></th></tr></thead>
    <tbody>${itens.map((t) => linhaAjuste(t, comAcao)).join("")}</tbody></table></div>`;

  conteudo().innerHTML = `${topo("Solicitações")}
    <div class="stack">
      <div class="card"><h2>Ajustes de ponto pendentes</h2>${pendentes.length ? tabelaAjustes(pendentes, true) : '<p class="muted">Nenhum ajuste pendente.</p>'}</div>
      <div class="card"><h2>Atestados e afastamentos pendentes</h2>
        ${afastamentos.length ? `<div class="tabela-wrap"><table>
          <thead><tr><th>Funcionário</th><th>Tipo</th><th>Período</th><th>Observação</th><th>Anexo</th><th></th></tr></thead>
          <tbody>${afastamentos.map((a) => `<tr><td>${esc(a.funcionario.nome)}</td><td>${NOME_AFASTAMENTO[a.tipo]}</td>
            <td class="tnum">${dataBr(a.inicio)}${a.fim !== a.inicio ? ` a ${dataBr(a.fim)}` : ""}</td><td>${esc(a.observacao ?? "")}</td>
            <td>${a.temAnexo ? `<button class="sm" data-anexo="${a.id}">Ver</button>` : "—"}</td>
            <td>${botoes("afastamento", a.id)}</td></tr>`).join("")}</tbody></table></div>` : '<p class="muted">Nenhum atestado pendente.</p>'}
      </div>
      <div class="card"><h2>Histórico de ajustes</h2>${historico.length ? tabelaAjustes(historico, false) : '<p class="muted">Sem histórico.</p>'}</div>
    </div>`;

  const decidir = async (chave, aprovar) => {
    const [tipo, id] = chave.split(":");
    const url = tipo === "ajuste" ? `/api/admin/tratamentos/${id}/decisao` : `/api/admin/afastamentos/${id}/decisao`;
    try {
      await api("POST", url, { aprovar });
      telaSolicitacoes();
    } catch (e) {
      alert(e.message);
    }
  };
  aoClicar(conteudo(), "aprovar", (c) => decidir(c, true));
  aoClicar(conteudo(), "rejeitar", (c) => decidir(c, false));
  aoClicar(conteudo(), "anexo", (id) => verFoto(`/api/admin/afastamentos/${id}/anexo`, "Anexo"));
}
