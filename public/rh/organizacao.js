import { api, esc } from "/app.js";
import { abrirModal, aoClicar, aoEnviar, caixaLink, conteudo, estado, modal, opcoes, topo } from "./ui.js";

const NOME_PAPEL = { ADMIN: "Administrador", GESTOR: "Gestor" };

export async function telaOrganizacao() {
  const [filiais, departamentos, usuarios] = await Promise.all([
    api("GET", "/api/admin/filiais"),
    api("GET", "/api/admin/departamentos"),
    api("GET", "/api/admin/usuarios"),
  ]);
  const ctx = { filiais, departamentos };
  conteudo().innerHTML = `${topo("Organização")}
    <div class="stack">
      <div class="card">
        <div class="topo" style="margin-bottom:8px"><h2 style="margin:0">Equipe do RH</h2><button class="primary sm" id="novo-usuario">Adicionar pessoa</button></div>
        <p class="muted small">Administradores veem e configuram tudo. Gestores veem e aprovam só os funcionários dos departamentos deles.</p>
        <div class="tabela-wrap"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Departamentos</th><th>Situação</th><th></th></tr></thead>
        <tbody>${usuarios.map((u) => `<tr><td><strong>${esc(u.nome)}</strong></td><td class="small">${esc(u.email)}</td>
          <td>${NOME_PAPEL[u.papel]}</td>
          <td class="small">${u.papel === "ADMIN" ? "Todos" : esc(departamentos.filter((d) => u.departamentoIds.includes(d.id)).map((d) => d.nome).join(", ") || "Nenhum")}</td>
          <td>${u.ativo ? '<span class="tag ok">Ativo</span>' : '<span class="tag">Inativo</span>'}</td>
          <td><button class="sm" data-usuario="${u.id}">Editar</button></td></tr>`).join("")}</tbody></table></div>
      </div>
      <div class="card">
        <div class="topo" style="margin-bottom:8px"><h2 style="margin:0">Departamentos</h2><button class="primary sm" id="novo-dep">Novo departamento</button></div>
        ${departamentos.length ? `<div class="tabela-wrap"><table><thead><tr><th>Departamento</th><th>Filial</th><th>Gestores</th><th>Funcionários</th><th></th></tr></thead>
        <tbody>${departamentos.map((d) => `<tr><td><strong>${esc(d.nome)}</strong></td><td>${esc(d.filial?.nome ?? "—")}</td>
          <td class="small">${esc(d.gestores.map((g) => g.nome).join(", ") || "—")}</td><td class="tnum">${d._count.funcionarios}</td>
          <td class="num"><button class="sm" data-dep="${d.id}">Editar</button> <button class="sm danger" data-del-dep="${d.id}">Remover</button></td></tr>`).join("")}</tbody></table></div>`
          : '<p class="muted">Crie departamentos (ex.: Loja Centro, Produção, Administrativo) para separar as equipes e definir os gestores de cada uma.</p>'}
      </div>
      <div class="card">
        <div class="topo" style="margin-bottom:8px"><h2 style="margin:0">Filiais</h2><button class="primary sm" id="nova-filial">Nova filial</button></div>
        <p class="muted small">Use filiais quando a empresa tem unidades em cidades diferentes: cada uma pode ter os feriados municipais dela.</p>
        ${filiais.length ? `<div class="tabela-wrap"><table><thead><tr><th>Filial</th><th>CNPJ</th><th>Cidade</th><th>Funcionários</th><th></th></tr></thead>
        <tbody>${filiais.map((f) => `<tr><td><strong>${esc(f.nome)}</strong></td><td class="tnum">${esc(f.cnpj ?? "—")}</td>
          <td>${esc([f.cidade, f.uf].filter(Boolean).join(" / ") || "—")}</td><td class="tnum">${f._count.funcionarios}</td>
          <td class="num"><button class="sm" data-filial="${f.id}">Editar</button> <button class="sm danger" data-del-filial="${f.id}">Remover</button></td></tr>`).join("")}</tbody></table></div>`
          : '<p class="muted">Nenhuma filial cadastrada.</p>'}
      </div>
    </div>`;
  document.getElementById("novo-usuario").onclick = () => formUsuario(null, ctx);
  document.getElementById("novo-dep").onclick = () => formDepartamento(null, ctx);
  document.getElementById("nova-filial").onclick = () => formFilial(null);
  aoClicar(conteudo(), "usuario", (id) => formUsuario(usuarios.find((u) => u.id === id), ctx));
  aoClicar(conteudo(), "dep", (id) => formDepartamento(departamentos.find((d) => d.id === id), ctx));
  aoClicar(conteudo(), "filial", (id) => formFilial(filiais.find((f) => f.id === id)));
  const remover = (url, pergunta) => confirm(pergunta) && api("DELETE", url).then(telaOrganizacao, (e) => alert(e.message));
  aoClicar(conteudo(), "del-dep", (id) => remover(`/api/admin/departamentos/${id}`, "Remover este departamento?"));
  aoClicar(conteudo(), "del-filial", (id) => remover(`/api/admin/filiais/${id}`, "Remover esta filial?"));
}

function formUsuario(u, { departamentos }) {
  abrirModal(`<form>
    <h2>${u ? "Editar acesso" : "Adicionar pessoa ao RH"}</h2>
    <label>Nome<input name="nome" value="${esc(u?.nome ?? "")}" required></label>
    ${u ? `<p class="muted small">${esc(u.email)}</p>` : `<label>E-mail<input name="email" type="email" required></label>`}
    <label>Papel<select name="papel">
      <option value="GESTOR" ${u?.papel === "GESTOR" ? "selected" : ""}>Gestor: vê e aprova só a equipe dele</option>
      <option value="ADMIN" ${u?.papel === "ADMIN" ? "selected" : ""}>Administrador: acesso total</option>
    </select></label>
    <div id="deps">
      <p class="small" style="margin:0 0 6px">Departamentos que esta pessoa gere</p>
      ${departamentos.length ? departamentos.map((d) => `<label class="check"><input type="checkbox" name="dep" value="${d.id}" ${u?.departamentoIds.includes(d.id) ? "checked" : ""}> ${esc(d.nome)}</label>`).join("")
        : '<p class="muted small">Cadastre departamentos primeiro.</p>'}
    </div>
    ${u ? `<label class="check"><input type="checkbox" name="ativo" ${u.ativo ? "checked" : ""} ${u.id === estado.eu?.id ? "disabled" : ""}> Ativo</label>
      <button type="button" class="sm" id="reenviar">Reenviar convite</button>` : `<p class="muted small">A pessoa recebe um e-mail para criar a própria senha.</p>`}
    <div id="convite"></div>
    <div class="acoes"><button class="primary">Salvar</button><button type="button" data-fechar>Fechar</button></div>
  </form>`, (m) => {
    const form = m.querySelector("form");
    const alternar = () => m.querySelector("#deps").classList.toggle("oculto", form.papel.value !== "GESTOR");
    form.papel.onchange = alternar;
    alternar();
    m.querySelector("#reenviar")?.addEventListener("click", async () => {
      const r = await api("POST", `/api/admin/usuarios/${u.id}/convite`);
      m.querySelector("#convite").innerHTML = caixaLink(r.link, u.nome);
    });
    aoEnviar(form, async (fd) => {
      const corpo = { nome: fd.get("nome"), papel: fd.get("papel"), departamentoIds: fd.getAll("dep") };
      if (u) {
        await api("PUT", `/api/admin/usuarios/${u.id}`, { ...corpo, ativo: u.id === estado.eu?.id ? true : fd.has("ativo") });
        modal().close();
      } else {
        const r = await api("POST", "/api/admin/usuarios", { ...corpo, email: fd.get("email") });
        m.querySelector("#convite").innerHTML = caixaLink(r.link, corpo.nome);
        form.querySelector("button.primary").classList.add("oculto");
      }
      telaOrganizacao();
    });
  });
}

function formDepartamento(d, { filiais }) {
  abrirModal(`<form>
    <h2>${d ? "Editar departamento" : "Novo departamento"}</h2>
    <label>Nome<input name="nome" value="${esc(d?.nome ?? "")}" required></label>
    ${filiais.length ? `<label>Filial<select name="filialId">${opcoes(filiais, d?.filialId, "— nenhuma —")}</select></label>` : ""}
    <p class="muted small">Os gestores do departamento são escolhidos em Equipe do RH.</p>
    <div class="acoes"><button class="primary">Salvar</button><button type="button" data-fechar>Cancelar</button></div>
  </form>`, (m) => {
    aoEnviar(m.querySelector("form"), async (fd) => {
      const corpo = { nome: fd.get("nome"), filialId: fd.get("filialId") || null };
      await api(d ? "PUT" : "POST", d ? `/api/admin/departamentos/${d.id}` : "/api/admin/departamentos", corpo);
      modal().close();
      telaOrganizacao();
    });
  });
}

function formFilial(f) {
  const v = (c) => esc(f?.[c] ?? "");
  abrirModal(`<form>
    <h2>${f ? "Editar filial" : "Nova filial"}</h2>
    <label>Nome<input name="nome" value="${v("nome")}" required placeholder="Ex.: Loja Shopping"></label>
    <div class="grid2">
      <label>CNPJ<input name="cnpj" value="${v("cnpj")}" inputmode="numeric"></label>
      <label>Cidade<input name="cidade" value="${v("cidade")}"></label>
      <label>UF<input name="uf" value="${v("uf")}" maxlength="2" style="text-transform:uppercase"></label>
    </div>
    <div class="acoes"><button class="primary">Salvar</button><button type="button" data-fechar>Cancelar</button></div>
  </form>`, (m) => {
    aoEnviar(m.querySelector("form"), async (fd) => {
      await api(f ? "PUT" : "POST", f ? `/api/admin/filiais/${f.id}` : "/api/admin/filiais", Object.fromEntries(fd));
      modal().close();
      telaOrganizacao();
    });
  });
}
