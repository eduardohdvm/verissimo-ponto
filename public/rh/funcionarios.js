import { api, blobAutenticado, esc } from "/app.js";
import { abrirModal, aoClicar, aoEnviar, caixaLink, conteudo, ehAdmin, estado, modal, opcoes, topo } from "./ui.js";

const filtro = { busca: "", departamentoId: "", inativos: false };
const cpfFormatado = (c) => c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");

export async function telaFuncionarios() {
  const [lista, jornadas, departamentos, filiais] = await Promise.all([
    api("GET", "/api/admin/funcionarios"),
    api("GET", "/api/admin/jornadas"),
    api("GET", "/api/admin/departamentos"),
    api("GET", "/api/admin/filiais"),
  ]);
  const ctx = { jornadas, departamentos, filiais };
  const termo = filtro.busca.toLowerCase();
  const visiveis = lista.filter(
    (f) =>
      (filtro.inativos || f.ativo) &&
      (!filtro.departamentoId || f.departamentoId === filtro.departamentoId) &&
      (!termo || `${f.nome} ${f.cpf} ${f.matricula ?? ""}`.toLowerCase().includes(termo)),
  );
  conteudo().innerHTML = `${topo("Funcionários", ehAdmin() ? `<a class="btn" href="#importar">Importar planilha</a><button class="primary" id="novo">Novo funcionário</button>` : "")}
    <div class="card stack">
      <div class="acoes">
        <input id="busca" placeholder="Buscar por nome, CPF ou matrícula" value="${esc(filtro.busca)}" style="flex:1;min-width:200px">
        ${departamentos.length ? `<select id="dep" style="width:auto">${opcoes(departamentos, filtro.departamentoId, "Todos os departamentos")}</select>` : ""}
        <label class="check" style="margin:0"><input type="checkbox" id="inativos" ${filtro.inativos ? "checked" : ""}> Mostrar inativos</label>
      </div>
      ${visiveis.length ? `<div class="tabela-wrap"><table>
      <thead><tr><th>Nome</th><th>CPF</th><th>Departamento</th><th>Jornada</th><th>Acesso</th><th>Facial</th><th>Situação</th><th></th></tr></thead>
      <tbody>${visiveis.map((f) => `<tr>
        <td><strong>${esc(f.nome)}</strong><br><span class="muted small">${esc([f.matricula, f.cargo].filter(Boolean).join(" · "))}</span></td>
        <td class="tnum">${cpfFormatado(f.cpf)}</td>
        <td>${esc(f.departamento?.nome ?? "—")}${f.filial ? `<br><span class="muted small">${esc(f.filial.nome)}</span>` : ""}</td>
        <td>${esc(f.jornada?.nome ?? "—")}</td>
        <td class="small">${esc(f.usuario?.email ?? "—")}</td>
        <td>${!f.exigeFacial ? '<span class="muted">—</span>' : f.rostoCadastrado ? '<span class="tag ok">Ativo</span>' : '<span class="tag warn">Falta foto</span>'}</td>
        <td>${f.ativo ? '<span class="tag ok">Ativo</span>' : '<span class="tag">Inativo</span>'}</td>
        <td>${ehAdmin() ? `<button class="sm" data-editar="${f.id}">Editar</button>` : `<a class="btn sm" href="#espelho" data-espelho="${f.id}">Espelho</a>`}</td></tr>`).join("")}
      </tbody></table></div>` : `<p class="muted">${lista.length ? "Nenhum funcionário com esses filtros." : ehAdmin() ? "Cadastre seus funcionários para que eles possam bater ponto." : "Nenhum funcionário nos seus departamentos."}</p>`}
    </div>`;
  const recarregar = () => telaFuncionarios();
  document.getElementById("busca").onchange = (e) => { filtro.busca = e.target.value; recarregar(); };
  document.getElementById("dep")?.addEventListener("change", (e) => { filtro.departamentoId = e.target.value; recarregar(); });
  document.getElementById("inativos").onchange = (e) => { filtro.inativos = e.target.checked; recarregar(); };
  document.getElementById("novo")?.addEventListener("click", () => formFuncionario(null, ctx));
  aoClicar(conteudo(), "editar", (id) => formFuncionario(lista.find((f) => f.id === id), ctx));
  conteudo().querySelectorAll("[data-espelho]").forEach((a) => a.addEventListener("click", () => sessionStorage.setItem("espelho-funcionario", a.dataset.espelho)));
}

function formFuncionario(f, { jornadas, departamentos, filiais }) {
  const v = (campo) => esc(f?.[campo] ?? "");
  abrirModal(`<form>
    <h2>${f ? "Editar funcionário" : "Novo funcionário"}</h2>
    <label>Nome completo<input name="nome" value="${v("nome")}" required></label>
    <div class="grid2">
      <label>CPF<input name="cpf" value="${v("cpf")}" inputmode="numeric" required></label>
      <label>PIS<input name="pis" value="${v("pis")}" inputmode="numeric"></label>
      <label>Matrícula<input name="matricula" value="${v("matricula")}"></label>
      <label>Cargo<input name="cargo" value="${v("cargo")}"></label>
      <label>Admissão<input name="admissao" type="date" value="${f?.admissao?.slice(0, 10) ?? ""}"></label>
      <label>Jornada<select name="jornadaId">${opcoes(jornadas, f?.jornadaId, "— sem jornada —")}</select></label>
      <label>Departamento<select name="departamentoId">${opcoes(departamentos, f?.departamentoId, "— nenhum —")}</select></label>
      <label>Filial<select name="filialId">${opcoes(filiais, f?.filialId, departamentos.length ? "— a do departamento —" : "— nenhuma —")}</select></label>
      <label>Código no ERP<input name="codigoExterno" value="${v("codigoExterno")}" placeholder="opcional"></label>
    </div>
    <label class="check"><input type="checkbox" name="exigeSelfie" ${f?.exigeSelfie === false ? "" : "checked"}> Exigir foto ao bater ponto</label>
    <label class="check"><input type="checkbox" name="exigeGps" ${f?.exigeGps === false ? "" : "checked"}> Exigir localização (GPS)</label>
    <label class="check"><input type="checkbox" name="exigeFacial" ${f?.exigeFacial ? "checked" : ""}> Exigir reconhecimento facial com prova de vida</label>
    ${estado.eu?.recursos?.facial === false ? '<p class="alerta warn small" style="margin:0 0 8px">O reconhecimento facial está desligado neste servidor. Quem tiver essa opção marcada bate ponto com foto simples, sem verificação do rosto.</p>' : ""}
    ${f ? `<div class="acoes" style="margin:4px 0 8px 26px"><span class="small ${f.rostoCadastrado ? "" : "muted"}">${f.rostoCadastrado ? "Rosto cadastrado" : "Rosto não cadastrado"}</span>
      <button type="button" class="sm" id="btn-rosto">${f.rostoCadastrado ? "Ver / trocar foto" : "Cadastrar rosto"}</button></div>` : ""}
    ${f ? `<label class="check"><input type="checkbox" name="ativo" ${f.ativo ? "checked" : ""}> Ativo</label>` : ""}

    <h3 style="margin-top:16px">Acesso ao app</h3>
    <label>E-mail de login<input name="email" type="email" value="${esc(f?.usuario?.email ?? "")}" placeholder="opcional: sem e-mail, só bate ponto no quiosque"></label>
    <div id="modo-acesso">
      <label class="check"><input type="radio" name="modo" value="convite" checked> ${f?.usuario ? "Manter a senha atual" : "Enviar convite: o funcionário cria a própria senha"}</label>
      <label class="check"><input type="radio" name="modo" value="senha"> Definir a senha agora</label>
      <label id="campo-senha" class="oculto">Senha (mínimo 8 caracteres)<input name="senha" type="password" minlength="8"></label>
    </div>
    ${f?.usuario ? `<button type="button" class="sm" id="reenviar">Reenviar convite</button>` : ""}
    <label style="margin-top:12px">PIN do quiosque <span class="muted">(4 a 6 números, ${f?.temPin ? "já definido; preencha só para trocar" : "opcional"})</span>
      <input name="pin" inputmode="numeric" pattern="\\d{4,6}" maxlength="6" autocomplete="off"></label>
    <div id="convite"></div>
    <div class="acoes"><button class="primary">Salvar</button><button type="button" data-fechar>Cancelar</button></div>
  </form>`, (m) => {
    const form = m.querySelector("form");
    form.querySelectorAll("[name=modo]").forEach((r) => (r.onchange = () => m.querySelector("#campo-senha").classList.toggle("oculto", form.modo.value !== "senha")));
    m.querySelector("#reenviar")?.addEventListener("click", async () => {
      const r = await api("POST", `/api/admin/funcionarios/${f.id}/convite`);
      m.querySelector("#convite").innerHTML = caixaLink(r.link, f.nome);
    });
    aoEnviar(form, async (fd) => {
      const vazio = (k) => (fd.get(k) || null);
      const corpo = {
        nome: fd.get("nome"), cpf: fd.get("cpf"), pis: vazio("pis"), matricula: vazio("matricula"),
        cargo: vazio("cargo"), admissao: vazio("admissao"), jornadaId: vazio("jornadaId"),
        departamentoId: vazio("departamentoId"), filialId: vazio("filialId"), codigoExterno: vazio("codigoExterno"),
        exigeSelfie: fd.has("exigeSelfie"), exigeGps: fd.has("exigeGps"), exigeFacial: fd.has("exigeFacial"),
        ...(f ? { ativo: fd.has("ativo") } : {}),
      };
      const email = fd.get("email");
      if (email) {
        if (fd.get("modo") === "senha") {
          if (!fd.get("senha")) throw new Error("Informe a senha ou escolha enviar o convite");
          corpo.acesso = { email, senha: fd.get("senha") };
        } else if (!f?.usuario || f.usuario.email !== email) {
          corpo.acesso = { email, convite: !f?.usuario ? true : false };
        }
      }
      const salvo = await api(f ? "PUT" : "POST", f ? `/api/admin/funcionarios/${f.id}` : "/api/admin/funcionarios", corpo);
      if (fd.get("pin")) await api("PUT", `/api/admin/funcionarios/${salvo.id}/pin`, { pin: fd.get("pin") });
      telaFuncionarios();
      if (salvo.linkConvite) {
        m.querySelector("#convite").innerHTML = caixaLink(salvo.linkConvite, salvo.nome) +
          `<div class="acoes" style="margin-top:8px"><button type="button" data-fechar>Fechar</button></div>`;
        m.querySelectorAll("[data-fechar]").forEach((b) => (b.onclick = () => modal().close()));
        form.querySelector("button.primary").classList.add("oculto");
        return;
      }
      modal().close();
      // Funcionário novo com facial: já abre o cadastro do rosto
      if (!f && corpo.exigeFacial) modalRosto({ ...salvo, rostoCadastrado: false });
    });
    m.querySelector("#btn-rosto")?.addEventListener("click", () => modalRosto(f));
  });
}

// ---------- Cadastro do rosto de referência ----------

/** Converte imagem ou vídeo em JPEG de no máximo 800px (o servidor lê JPEG). */
export function paraJpeg(fonte, largura, altura, maximo = 800) {
  const escala = Math.min(1, maximo / Math.max(largura, altura));
  const c = document.createElement("canvas");
  c.width = Math.round(largura * escala);
  c.height = Math.round(altura * escala);
  c.getContext("2d").drawImage(fonte, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.9);
}

function modalRosto(f) {
  let stream = null;
  const parar = () => stream?.getTracks().forEach((t) => t.stop());
  abrirModal(`<h2>Rosto de ${esc(f.nome)}</h2>
    <p class="muted small">Foto de frente, bem iluminada, sem óculos escuros nem boné, só com a pessoa. É com ela que cada marcação será comparada.</p>
    <div id="area-foto" style="aspect-ratio:4/3;background:var(--surface-2);border-radius:10px;overflow:hidden;display:grid;place-items:center;margin-bottom:12px">
      <span class="muted small">${f.rostoCadastrado ? "Carregando foto atual…" : "Nenhuma foto cadastrada"}</span></div>
    <p class="alerta oculto" id="erro-rosto"></p>
    <div class="acoes">
      <button type="button" id="usar-camera">Usar câmera</button>
      <button type="button" class="primary oculto" id="tirar">Tirar foto</button>
      <label class="btn" style="margin:0;color:var(--text);font-size:15px">Enviar arquivo<input type="file" accept="image/*" id="arquivo" class="oculto"></label>
      ${f.rostoCadastrado ? '<button type="button" class="danger" id="remover">Remover</button>' : ""}
      <button type="button" data-fechar>Fechar</button>
    </div>`, (m) => {
    const area = m.querySelector("#area-foto");
    const erro = m.querySelector("#erro-rosto");
    m.addEventListener("close", parar, { once: true });

    const enviar = async (jpeg) => {
      erro.className = "alerta warn";
      erro.textContent = "Analisando o rosto…";
      try {
        await api("POST", `/api/admin/funcionarios/${f.id}/rosto`, { imagem: jpeg });
        parar();
        area.innerHTML = `<img src="${jpeg}" alt="" style="width:100%;height:100%;object-fit:cover">`;
        erro.className = "alerta ok";
        erro.textContent = "Rosto cadastrado. O funcionário já pode bater ponto com reconhecimento facial.";
        m.querySelector("#tirar").classList.add("oculto");
        telaFuncionarios();
      } catch (e) {
        erro.className = "alerta";
        erro.textContent = e.message;
      }
    };

    if (f.rostoCadastrado) {
      blobAutenticado(`/api/admin/funcionarios/${f.id}/rosto`).then(
        (url) => (area.innerHTML = `<img src="${url}" alt="" style="width:100%;height:100%;object-fit:cover">`),
        () => (area.innerHTML = '<span class="muted small">Foto indisponível</span>'),
      );
    }
    m.querySelector("#usar-camera").onclick = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 } } });
        const v = Object.assign(document.createElement("video"), { autoplay: true, playsInline: true, muted: true, srcObject: stream });
        v.style.cssText = "width:100%;height:100%;object-fit:cover;transform:scaleX(-1)";
        area.replaceChildren(v);
        m.querySelector("#tirar").classList.remove("oculto");
        m.querySelector("#tirar").onclick = () => enviar(paraJpeg(v, v.videoWidth, v.videoHeight));
      } catch {
        erro.className = "alerta";
        erro.textContent = "Não foi possível abrir a câmera.";
      }
    };
    m.querySelector("#arquivo").onchange = (e) => {
      const arq = e.target.files[0];
      if (!arq) return;
      const img = new Image();
      img.onload = () => enviar(paraJpeg(img, img.naturalWidth, img.naturalHeight));
      img.src = URL.createObjectURL(arq);
    };
    m.querySelector("#remover")?.addEventListener("click", async () => {
      if (!confirm("Remover o rosto cadastrado? O funcionário não conseguirá bater ponto até cadastrar outro.")) return;
      await api("DELETE", `/api/admin/funcionarios/${f.id}/rosto`);
      modal().close();
      telaFuncionarios();
    });
  });
}
