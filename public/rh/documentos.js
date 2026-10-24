// Documentos enviados aos funcionários (contracheque, informe de rendimentos…), com assinatura no app.
import { api, esc, mesAtual } from "/app.js";
import { abrirModal, aoClicar, aoEnviar, baixar, conteudo, modal, opcoes, topo } from "./ui.js";

const TIPOS = {
  CONTRACHEQUE: "Contracheque",
  INFORME_RENDIMENTOS: "Informe de rendimentos",
  FERIAS: "Aviso e recibo de férias",
  CONTRATO: "Contrato / aditivo",
  OUTRO: "Outro documento",
};
const STATUS = { PENDENTE: ["Pendente", "warn"], VISUALIZADO: ["Visualizado", "info"], ASSINADO: ["Assinado", "ok"] };
const filtro = { competencia: "" };

const lerArquivo = (arq) => new Promise((ok, erro) => {
  if (arq.size > 4 * 1024 * 1024) return erro(new Error(`${arq.name}: maior que 4 MB`));
  const r = new FileReader();
  r.onload = () => ok(r.result);
  r.onerror = () => erro(new Error(`Não foi possível ler ${arq.name}`));
  r.readAsDataURL(arq);
});

const camposComuns = () => `<div class="grid2">
    <label>Tipo<select name="tipo">${Object.entries(TIPOS).map(([v, n]) => `<option value="${v}">${n}</option>`).join("")}</select></label>
    <label>Mês de referência<input type="month" name="competencia" value="${mesAtual()}" required></label>
  </div>
  <label>Título (opcional)<input name="titulo" placeholder="Ex.: 13º salário - 1ª parcela"></label>
  <label class="check"><input type="checkbox" name="exigeAssinatura" checked> Pedir a assinatura do funcionário</label>`;

export async function telaDocumentos() {
  const [lista, funcionarios] = await Promise.all([
    api("GET", `/api/admin/documentos${filtro.competencia ? `?competencia=${filtro.competencia}` : ""}`),
    api("GET", "/api/admin/funcionarios"),
  ]);
  conteudo().innerHTML = `${topo("Documentos", `<button id="lote">Enviar vários</button><button class="primary" id="novo">Enviar documento</button>`)}
    <div class="card stack">
      <p class="muted small" style="margin:0">Contracheques e outros documentos aparecem em "Arquivos" no app. O funcionário abre e assina com a senha; o registro guarda data, IP e o código (hash) do arquivo.</p>
      <div class="acoes"><input type="month" id="mes" value="${filtro.competencia}" style="width:auto"><span class="muted small">${filtro.competencia ? "" : "todos os meses"}</span></div>
      ${lista.length ? `<div class="tabela-wrap"><table><thead><tr><th>Funcionário</th><th>Documento</th><th>Referência</th><th>Situação</th><th></th></tr></thead>
        <tbody>${lista.map((d) => `<tr><td>${esc(d.funcionario.nome)}<br><span class="muted small">${esc(d.funcionario.matricula ?? "")}</span></td>
          <td>${esc(d.titulo ?? TIPOS[d.tipo])}</td><td class="tnum">${d.competencia.split("-").reverse().join("/")}</td>
          <td><span class="tag ${STATUS[d.status][1]}">${d.exigeAssinatura || d.status !== "PENDENTE" ? STATUS[d.status][0] : "Não aberto"}</span>
            ${d.assinadoEm ? `<br><span class="muted small">${new Date(d.assinadoEm).toLocaleString("pt-BR")}</span>` : ""}</td>
          <td class="num"><button class="sm" data-abrir="${d.id}">Abrir</button>${d.status !== "ASSINADO" ? ` <button class="sm danger" data-remover="${d.id}">Remover</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`
        : '<p class="muted">Nenhum documento enviado.</p>'}
    </div>`;
  document.getElementById("mes").onchange = (e) => { filtro.competencia = e.target.value; telaDocumentos(); };
  document.getElementById("novo").onclick = () => formUnico(funcionarios.filter((f) => f.ativo));
  document.getElementById("lote").onclick = formLote;
  aoClicar(conteudo(), "abrir", (id) => baixar(`/api/admin/documentos/${id}/arquivo`, `documento-${id}`));
  aoClicar(conteudo(), "remover", (id) => confirm("Remover este documento?") && api("DELETE", `/api/admin/documentos/${id}`).then(telaDocumentos, (e) => alert(e.message)));
}

function formUnico(funcionarios) {
  abrirModal(`<form>
    <h2>Enviar documento</h2>
    <label>Funcionário<select name="funcionarioId" required>${opcoes(funcionarios, "", "Escolha…")}</select></label>
    ${camposComuns()}
    <label>Arquivo (PDF ou imagem, até 4 MB)<input type="file" name="arquivo" accept="application/pdf,image/*" required></label>
    <div class="acoes"><button class="primary">Enviar</button><button type="button" data-fechar>Cancelar</button></div>
  </form>`, (m) => {
    const form = m.querySelector("form");
    aoEnviar(form, async (fd) => {
      if (!fd.get("funcionarioId")) throw new Error("Escolha o funcionário");
      await api("POST", "/api/admin/documentos", {
        funcionarioId: fd.get("funcionarioId"), tipo: fd.get("tipo"), competencia: fd.get("competencia"),
        titulo: fd.get("titulo") || null, exigeAssinatura: fd.has("exigeAssinatura"), arquivo: await lerArquivo(form.arquivo.files[0]),
      });
      modal().close();
      telaDocumentos();
    });
  });
}

function formLote() {
  abrirModal(`<form>
    <h2>Enviar vários documentos</h2>
    <p class="muted small">Selecione vários arquivos de uma vez. O nome de cada arquivo precisa ter o <strong>CPF</strong> (só números)
      ou a <strong>matrícula</strong> do funcionário. Ex.: <code>52998224725.pdf</code> ou <code>contracheque_001.pdf</code>.</p>
    ${camposComuns()}
    <label>Arquivos<input type="file" name="arquivos" accept="application/pdf,image/*" multiple required></label>
    <div id="progresso" class="small"></div>
    <div class="acoes"><button class="primary">Enviar</button><button type="button" data-fechar>Fechar</button></div>
  </form>`, (m) => {
    const form = m.querySelector("form");
    aoEnviar(form, async (fd) => {
      const arquivos = [...form.arquivos.files];
      const prog = m.querySelector("#progresso");
      const linhas = [];
      let ok = 0;
      for (const [i, arq] of arquivos.entries()) {
        prog.innerHTML = `Enviando ${i + 1} de ${arquivos.length}…`;
        try {
          const r = await api("POST", "/api/admin/documentos/lote", {
            nomeArquivo: arq.name, tipo: fd.get("tipo"), competencia: fd.get("competencia"),
            titulo: fd.get("titulo") || null, exigeAssinatura: fd.has("exigeAssinatura"), arquivo: await lerArquivo(arq),
          });
          ok++;
          linhas.push(`<tr><td>${esc(arq.name)}</td><td>${esc(r.funcionario)}</td></tr>`);
        } catch (e) {
          linhas.push(`<tr><td>${esc(arq.name)}</td><td style="color:var(--danger)">${esc(e.message)}</td></tr>`);
        }
      }
      prog.innerHTML = `<p class="alerta ${ok === arquivos.length ? "ok" : "warn"}">${ok} de ${arquivos.length} enviado(s).</p>
        <div class="tabela-wrap" style="max-height:200px"><table><tbody>${linhas.join("")}</tbody></table></div>`;
      form.querySelector("button.primary").classList.add("oculto");
      telaDocumentos();
    });
  });
}
