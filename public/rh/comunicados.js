import { api, esc } from "/app.js";
import { abrirModal, aoClicar, aoEnviar, conteudo, modal, opcoes, topo, verFoto } from "./ui.js";
import { paraJpeg } from "./funcionarios.js";

const CORES = { azul: "Azul", roxo: "Roxo", laranja: "Laranja", verde: "Verde", vermelho: "Vermelho" };

export async function telaComunicados() {
  const [lista, departamentos] = await Promise.all([api("GET", "/api/admin/comunicados"), api("GET", "/api/admin/departamentos")]);
  conteudo().innerHTML = `${topo("Comunicados", `<button class="primary" id="novo">Novo comunicado</button>`)}
    <div class="card">
      <p class="muted small" style="margin-top:0">Aparecem nos "Informativos" do app do funcionário. Marcando "abrir sozinho", o comunicado aparece em destaque na próxima vez que a pessoa abrir o app.</p>
      ${lista.length ? `<div class="tabela-wrap"><table><thead><tr><th>Comunicado</th><th>Para</th><th>Leituras</th><th>Publicado</th><th></th></tr></thead>
        <tbody>${lista.map((c) => `<tr><td><span class="bolinha cor-${c.cor}"></span><strong>${esc(c.titulo)}</strong>${c.popup ? ' <span class="tag info">Abre sozinho</span>' : ""}
          <br><span class="muted small">${esc(c.texto.slice(0, 90))}${c.texto.length > 90 ? "…" : ""}</span></td>
          <td class="small">${esc(departamentos.find((d) => d.id === c.departamentoId)?.nome ?? "Todos")}</td>
          <td class="tnum">${c.leituras} de ${c.totalUsuarios}</td>
          <td class="small">${new Date(c.criadoEm).toLocaleDateString("pt-BR")}${c.expiraEm ? `<br><span class="muted">até ${new Date(c.expiraEm).toLocaleDateString("pt-BR")}</span>` : ""}</td>
          <td class="num">${c.temImagem ? `<button class="sm" data-imagem="${c.id}">Imagem</button> ` : ""}<button class="sm danger" data-remover="${c.id}">Remover</button></td></tr>`).join("")}</tbody></table></div>`
        : '<p class="muted">Nenhum comunicado ainda.</p>'}
    </div>`;
  document.getElementById("novo").onclick = () => formComunicado(departamentos);
  aoClicar(conteudo(), "imagem", (id) => verFoto(`/api/admin/comunicados/${id}/imagem`, "Imagem do comunicado"));
  aoClicar(conteudo(), "remover", (id) => confirm("Remover este comunicado do app?") && api("DELETE", `/api/admin/comunicados/${id}`).then(telaComunicados));
}

function formComunicado(departamentos) {
  abrirModal(`<form>
    <h2>Novo comunicado</h2>
    <label>Título<input name="titulo" required maxlength="80" placeholder="Ex.: Atualização do banco de horas"></label>
    <label>Texto<textarea name="texto" rows="6" required></textarea></label>
    <div class="grid2">
      <label>Cor do cartão<select name="cor">${Object.entries(CORES).map(([v, n]) => `<option value="${v}">${n}</option>`).join("")}</select></label>
      <label>Para<select name="departamentoId">${opcoes(departamentos, "", "Todos os funcionários")}</select></label>
      <label>Mostrar até (opcional)<input type="date" name="expiraEm"></label>
      <label>Imagem (opcional)<input type="file" name="imagem" accept="image/*"></label>
    </div>
    <label class="check"><input type="checkbox" name="popup"> Abrir sozinho no app (comunicado importante)</label>
    <label class="check"><input type="checkbox" name="notificar" checked> Avisar no celular</label>
    <div class="acoes"><button class="primary">Publicar</button><button type="button" data-fechar>Cancelar</button></div>
  </form>`, (m) => {
    const form = m.querySelector("form");
    aoEnviar(form, async (fd) => {
      let imagem = null;
      const arq = form.imagem.files[0];
      if (arq) {
        const img = new Image();
        img.src = URL.createObjectURL(arq);
        await img.decode();
        imagem = paraJpeg(img, img.naturalWidth, img.naturalHeight, 1400);
      }
      await api("POST", "/api/admin/comunicados", {
        titulo: fd.get("titulo"), texto: fd.get("texto"), cor: fd.get("cor"), departamentoId: fd.get("departamentoId") || null,
        expiraEm: fd.get("expiraEm") || null, popup: fd.has("popup"), notificar: fd.has("notificar"), imagem,
      });
      modal().close();
      telaComunicados();
    });
  });
}
