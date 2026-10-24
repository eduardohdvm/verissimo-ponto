import { api, esc } from "/app.js";
import { abrirModal, aoClicar, aoEnviar, conteudo, estado, modal, opcoes, topo } from "./ui.js";

export async function telaQuiosques() {
  const [lista, locais] = await Promise.all([api("GET", "/api/admin/quiosques"), api("GET", "/api/admin/locais")]);
  const facial = estado.eu?.recursos?.facial !== false;
  conteudo().innerHTML = `${topo("Quiosques (tablet)", `<button class="primary" id="novo">Novo quiosque</button>`)}
    <div class="stack">
      <div class="card">
        <p class="small" style="margin-top:0">Um tablet na entrada da empresa onde vários funcionários batem ponto.
          ${facial ? "O funcionário olha para a câmera e o sistema reconhece quem é (o rosto precisa estar cadastrado)." : "O funcionário digita a matrícula e o PIN; o tablet tira uma foto como prova."}</p>
        <ol class="small muted" style="margin:0;padding-left:20px">
          <li>Crie o quiosque aqui e anote o código de 6 números (vale 30 minutos).</li>
          <li>No tablet, abra <strong>${location.origin}/quiosque</strong> e digite o código.</li>
          <li>Defina o PIN de cada funcionário em Funcionários → Editar${facial ? " (para quem não usar o rosto)" : ""}.</li>
        </ol>
      </div>
      <div class="card">
        ${lista.length ? `<div class="tabela-wrap"><table>
          <thead><tr><th>Quiosque</th><th>Local</th><th>Situação</th><th>Último uso</th><th></th></tr></thead>
          <tbody>${lista.map((q) => `<tr><td><strong>${esc(q.nome)}</strong>${q.permitePin ? '<br><span class="muted small">Aceita PIN</span>' : ""}</td>
            <td>${esc(locais.find((l) => l.id === q.localId)?.nome ?? "—")}</td>
            <td>${!q.ativo ? '<span class="tag">Desativado</span>' : q.pareado ? '<span class="tag ok">Pareado</span>'
              : q.codigo ? `<span class="tag warn">Código ${q.codigo}</span>` : '<span class="tag">Aguardando código</span>'}</td>
            <td class="small">${q.ultimoUso ? new Date(q.ultimoUso).toLocaleString("pt-BR") : "—"}</td>
            <td class="num"><button class="sm" data-codigo="${q.id}">Novo código</button> <button class="sm" data-editar="${q.id}">Editar</button></td></tr>`).join("")}
          </tbody></table></div>` : '<p class="muted">Nenhum quiosque cadastrado.</p>'}
      </div>
    </div>`;
  document.getElementById("novo").onclick = () => formQuiosque(null, locais);
  aoClicar(conteudo(), "editar", (id) => formQuiosque(lista.find((q) => q.id === id), locais));
  aoClicar(conteudo(), "codigo", async (id) => {
    if (!confirm("Gerar um novo código? O tablet pareado agora será desconectado.")) return;
    const r = await api("POST", `/api/admin/quiosques/${id}/codigo`);
    mostrarCodigo(r.codigo);
  });
}

function mostrarCodigo(codigo) {
  abrirModal(`<h2>Código de pareamento</h2>
    <p style="font-size:44px;font-weight:700;letter-spacing:10px;text-align:center;margin:16px 0" class="tnum">${codigo}</p>
    <p class="muted small">No tablet, abra <strong>${location.origin}/quiosque</strong> e digite este código. Ele vale por 30 minutos.</p>
    <div class="acoes"><button class="primary" data-fechar>Ok</button></div>`);
  modal().addEventListener("close", () => telaQuiosques(), { once: true });
}

function formQuiosque(q, locais) {
  abrirModal(`<form>
    <h2>${q ? "Editar quiosque" : "Novo quiosque"}</h2>
    <label>Nome<input name="nome" value="${esc(q?.nome ?? "")}" required placeholder="Ex.: Entrada da loja"></label>
    <label>Local (onde o tablet fica)<select name="localId">${opcoes(locais, q?.localId, "— não informar —")}</select></label>
    <label class="check"><input type="checkbox" name="permitePin" ${q?.permitePin === false ? "" : "checked"}> Aceitar matrícula + PIN ${estado.eu?.recursos?.facial !== false ? "(além do rosto)" : ""}</label>
    ${q ? `<label class="check"><input type="checkbox" name="ativo" ${q.ativo ? "checked" : ""}> Ativo</label>` : ""}
    <div class="acoes"><button class="primary">Salvar</button>${q ? '<button type="button" class="danger" id="remover">Remover</button>' : ""}<button type="button" data-fechar>Cancelar</button></div>
  </form>`, (m) => {
    aoEnviar(m.querySelector("form"), async (fd) => {
      const corpo = { nome: fd.get("nome"), localId: fd.get("localId") || null, permitePin: fd.has("permitePin"), ativo: q ? fd.has("ativo") : true };
      if (q) {
        await api("PUT", `/api/admin/quiosques/${q.id}`, corpo);
        modal().close();
        telaQuiosques();
      } else {
        const r = await api("POST", "/api/admin/quiosques", corpo);
        mostrarCodigo(r.codigo);
      }
    });
    m.querySelector("#remover")?.addEventListener("click", async () => {
      if (!confirm("Remover este quiosque? O tablet deixa de funcionar.")) return;
      await api("DELETE", `/api/admin/quiosques/${q.id}`);
      modal().close();
      telaQuiosques();
    });
  });
}
