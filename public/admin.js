import {
  api, blobAutenticado, dataBr, DIAS, esc, LOGO, mesAtual, periodoDoMes, sair, tabelaEspelho, token,
} from "/app.js";

if (!token.get()) location.href = "/";

const conteudo = document.getElementById("conteudo");
const modal = document.getElementById("modal");
document.getElementById("marca").innerHTML = `${LOGO}<span>Ponto</span>`;
document.getElementById("sair").onclick = (e) => { e.preventDefault(); sair(); };

let eu;
api("GET", "/api/auth/eu").then((u) => {
  eu = u;
  if (u.papel === "FUNCIONARIO") location.href = "/ponto";
  document.getElementById("usuario").innerHTML = `<strong>${esc(u.nome)}</strong><br>${esc(u.empresa.razaoSocial)}`;
});

// ---------- utilitários de tela ----------

function abrirModal(html, aoAbrir) {
  modal.innerHTML = html;
  modal.showModal();
  modal.querySelectorAll("[data-fechar]").forEach((b) => (b.onclick = () => modal.close()));
  aoAbrir?.(modal);
}

function erroNo(el, err) {
  let alvo = el.querySelector(".alerta");
  if (!alvo) {
    alvo = document.createElement("p");
    alvo.className = "alerta";
    const acoes = el.querySelector(".acoes");
    if (acoes) acoes.before(alvo);
    else el.append(alvo);
  }
  alvo.textContent = err.message;
}

/** Liga um <form> a uma ação async, mostrando erros dentro do próprio form. */
function aoEnviar(form, acao) {
  form.onsubmit = async (e) => {
    e.preventDefault();
    const botao = form.querySelector("button.primary");
    if (botao) botao.disabled = true;
    try {
      await acao(new FormData(form));
    } catch (err) {
      erroNo(form, err);
    } finally {
      if (botao) botao.disabled = false;
    }
  };
}

const topo = (titulo, acoes = "") => `<div class="topo"><h1>${titulo}</h1><div class="acoes">${acoes}</div></div>`;

// ---------- Painel ----------

async function telaPainel() {
  const p = await api("GET", "/api/admin/painel");
  conteudo.innerHTML = `${topo("Painel", `<span class="muted">${dataBr(p.hoje)}</span>`)}
    <div class="stack">
      <div class="kpis">
        <div class="card kpi"><div class="valor">${p.presentesHoje}<span class="muted" style="font-size:16px"> / ${p.funcionariosAtivos}</span></div><div class="rotulo">Bateram ponto hoje</div></div>
        <div class="card kpi"><div class="valor">${p.funcionariosAtivos - p.presentesHoje}</div><div class="rotulo">Ainda sem marcação</div></div>
        <div class="card kpi"><div class="valor">${p.tratamentosPendentes}</div><div class="rotulo"><a href="#ajustes">Solicitações pendentes</a></div></div>
        <div class="card kpi"><div class="valor" style="${p.tentativasRecusadasHoje ? "color:var(--danger)" : ""}">${p.tentativasRecusadasHoje}</div><div class="rotulo">Rostos recusados hoje</div></div>
      </div>
      <div class="card oculto" id="tentativas"></div>
      <div class="card">
        <h2>Marcações de hoje</h2>
        ${p.ultimasMarcacoes.length ? `<div class="tabela-wrap"><table>
          <thead><tr><th>Hora</th><th>Funcionário</th><th>Origem</th><th>NSR</th><th></th></tr></thead>
          <tbody>${p.ultimasMarcacoes.map((m) => `<tr>
            <td class="tnum"><strong>${m.hora}</strong></td><td>${esc(m.funcionario)}</td>
            <td><span class="tag">${m.origem === "MOBILE" ? "Celular" : "Computador"}</span>
              ${m.provaVida ? `<span class="tag ${m.provaVida === "OFFLINE" ? "warn" : "ok"}" title="Distância ${m.distanciaFacial?.toFixed(2)}">${m.provaVida === "OFFLINE" ? "Rosto ok (offline)" : "Rosto ok"}</span>` : ""}</td>
            <td class="tnum muted">${m.nsr}</td>
            <td>${m.temSelfie ? `<button class="sm" data-selfie="${m.id}">Ver foto</button>` : ""}</td></tr>`).join("")}
          </tbody></table></div>` : `<p class="muted">Nenhuma marcação hoje ainda.</p>`}
      </div>
    </div>`;
  conteudo.querySelectorAll("[data-selfie]").forEach((b) => (b.onclick = () => verSelfie(b.dataset.selfie)));
  carregarTentativas();
}

async function carregarTentativas() {
  const lista = await api("GET", "/api/admin/tentativas");
  const el = document.getElementById("tentativas");
  if (!el || !lista.length) return;
  el.classList.remove("oculto");
  el.innerHTML = `<h2>Reconhecimento facial recusado (últimos 7 dias)</h2>
    <p class="muted small">Tentativas de bater ponto em que o rosto não conferiu ou a prova de vida falhou. Vale conferir as fotos.</p>
    <div class="tabela-wrap"><table><thead><tr><th>Quando</th><th>Funcionário</th><th>Motivo</th><th></th></tr></thead>
    <tbody>${lista.map((t) => `<tr><td class="tnum">${dataBr(t.data).slice(0, 5)} ${t.hora}</td><td>${esc(t.funcionario)}</td>
      <td>${esc(t.motivo)}${t.distanciaFacial != null ? ` <span class="muted small">(distância ${t.distanciaFacial.toFixed(2)})</span>` : ""}</td>
      <td>${t.temFoto ? `<button class="sm" data-foto-tentativa="${t.id}">Ver foto</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`;
  el.querySelectorAll("[data-foto-tentativa]").forEach(
    (b) => (b.onclick = () => verSelfie(null, `/api/admin/tentativas/${b.dataset.fotoTentativa}/foto`)),
  );
}

async function verSelfie(id, url = `/api/admin/marcacoes/${id}/selfie`) {
  abrirModal(`<h2>Foto</h2><p class="muted">Carregando…</p><div class="acoes"><button data-fechar>Fechar</button></div>`);
  try {
    url = await blobAutenticado(url);
    modal.querySelector("p").outerHTML = `<img src="${url}" alt="Foto da marcação" style="width:100%;border-radius:8px;margin-bottom:12px">`;
  } catch (err) {
    modal.querySelector("p").textContent = err.message;
  }
}

// ---------- Funcionários ----------

async function telaFuncionarios() {
  const [lista, jornadas] = await Promise.all([api("GET", "/api/admin/funcionarios"), api("GET", "/api/admin/jornadas")]);
  conteudo.innerHTML = `${topo("Funcionários", `<button class="primary" id="novo">Novo funcionário</button>`)}
    <div class="card">${lista.length ? `<div class="tabela-wrap"><table>
      <thead><tr><th>Nome</th><th>CPF</th><th>Matrícula</th><th>Jornada</th><th>Acesso</th><th>Facial</th><th>Situação</th><th></th></tr></thead>
      <tbody>${lista.map((f) => `<tr>
        <td><strong>${esc(f.nome)}</strong><br><span class="muted small">${esc(f.cargo ?? "")}</span></td>
        <td class="tnum">${f.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")}</td>
        <td>${esc(f.matricula ?? "—")}</td>
        <td>${esc(f.jornada?.nome ?? "—")}</td>
        <td class="small">${esc(f.usuario?.email ?? "—")}</td>
        <td>${!f.exigeFacial ? '<span class="muted">—</span>' : f.rostoCadastrado ? '<span class="tag ok">Ativo</span>' : '<span class="tag warn">Falta foto</span>'}</td>
        <td>${f.ativo ? '<span class="tag ok">Ativo</span>' : '<span class="tag">Inativo</span>'}</td>
        <td><button class="sm" data-editar="${f.id}">Editar</button></td></tr>`).join("")}
      </tbody></table></div>` : `<p class="muted">Cadastre seus funcionários para que eles possam bater ponto.</p>`}</div>`;
  document.getElementById("novo").onclick = () => formFuncionario(null, jornadas);
  conteudo.querySelectorAll("[data-editar]").forEach(
    (b) => (b.onclick = () => formFuncionario(lista.find((f) => f.id === b.dataset.editar), jornadas)),
  );
}

function formFuncionario(f, jornadas) {
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
      <label>Jornada<select name="jornadaId"><option value="">— sem jornada —</option>
        ${jornadas.map((j) => `<option value="${j.id}" ${f?.jornadaId === j.id ? "selected" : ""}>${esc(j.nome)}</option>`).join("")}
      </select></label>
      <label>Código no ERP<input name="codigoExterno" value="${v("codigoExterno")}" placeholder="opcional"></label>
    </div>
    <label class="check"><input type="checkbox" name="exigeSelfie" ${f?.exigeSelfie === false ? "" : "checked"}> Exigir foto ao bater ponto</label>
    <label class="check"><input type="checkbox" name="exigeGps" ${f?.exigeGps === false ? "" : "checked"}> Exigir localização (GPS)</label>
    <label class="check"><input type="checkbox" name="exigeFacial" ${f?.exigeFacial ? "checked" : ""}> Exigir reconhecimento facial com prova de vida</label>
    ${eu?.recursos?.facial === false ? '<p class="alerta warn small" style="margin:0 0 8px">O reconhecimento facial está desligado neste servidor. Quem tiver essa opção marcada bate ponto com foto simples, sem verificação do rosto.</p>' : ""}
    ${f ? `<div class="acoes" style="margin:4px 0 8px 26px"><span class="small ${f.rostoCadastrado ? "" : "muted"}">${f.rostoCadastrado ? "Rosto cadastrado" : "Rosto não cadastrado"}</span>
      <button type="button" class="sm" id="btn-rosto">${f.rostoCadastrado ? "Ver / trocar foto" : "Cadastrar rosto"}</button></div>` : ""}
    ${f ? `<label class="check"><input type="checkbox" name="ativo" ${f.ativo ? "checked" : ""}> Ativo</label>` : ""}
    <h3 style="margin-top:16px">Acesso ao app</h3>
    <div class="grid2">
      <label>E-mail de login<input name="email" type="email" value="${esc(f?.usuario?.email ?? "")}"></label>
      <label>${f?.usuario ? "Nova senha" : "Senha inicial"}<input name="senha" type="password" minlength="8" placeholder="mínimo 8 caracteres"></label>
    </div>
    <div class="acoes"><button class="primary">Salvar</button><button type="button" data-fechar>Cancelar</button></div>
  </form>`, (m) => {
    aoEnviar(m.querySelector("form"), async (fd) => {
      const vazio = (k) => (fd.get(k) || null);
      const corpo = {
        nome: fd.get("nome"), cpf: fd.get("cpf"), pis: vazio("pis"), matricula: vazio("matricula"),
        cargo: vazio("cargo"), admissao: vazio("admissao"), jornadaId: vazio("jornadaId"),
        codigoExterno: vazio("codigoExterno"),
        exigeSelfie: fd.has("exigeSelfie"), exigeGps: fd.has("exigeGps"), exigeFacial: fd.has("exigeFacial"),
        ...(f ? { ativo: fd.has("ativo") } : {}),
      };
      if (fd.get("email") && fd.get("senha")) corpo.acesso = { email: fd.get("email"), senha: fd.get("senha") };
      else if (fd.get("email") && !f?.usuario) throw new Error("Informe a senha inicial para criar o acesso");
      const salvo = await api(f ? "PUT" : "POST", f ? `/api/admin/funcionarios/${f.id}` : "/api/admin/funcionarios", corpo);
      modal.close();
      telaFuncionarios();
      // Funcionário novo com facial: já abre o cadastro do rosto
      if (!f && corpo.exigeFacial) modalRosto({ ...salvo, rostoCadastrado: false });
    });
    m.querySelector("#btn-rosto")?.addEventListener("click", () => modalRosto(f));
  });
}

// ---------- Cadastro do rosto de referência ----------

/** Converte imagem ou vídeo em JPEG de no máximo 800px (o servidor lê JPEG). */
function paraJpeg(fonte, largura, altura) {
  const escala = Math.min(1, 800 / Math.max(largura, altura));
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
    modal.addEventListener("close", parar, { once: true });

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
      modal.close();
      telaFuncionarios();
    });
  });
}

// ---------- Espelho de ponto ----------

const estadoEspelho = { funcionarioId: "", mes: mesAtual() };

async function telaEspelho() {
  const funcs = (await api("GET", "/api/admin/funcionarios")).filter((f) => f.ativo);
  if (!estadoEspelho.funcionarioId && funcs[0]) estadoEspelho.funcionarioId = funcs[0].id;
  conteudo.innerHTML = `${topo("Espelho de ponto", `<button id="imprimir">Imprimir</button>`)}
    <div class="card stack">
      <div class="acoes nao-imprimir">
        <select id="func" style="width:auto;min-width:240px">${funcs.map((f) =>
          `<option value="${f.id}" ${f.id === estadoEspelho.funcionarioId ? "selected" : ""}>${esc(f.nome)}</option>`).join("")}</select>
        <input id="mes" type="month" value="${estadoEspelho.mes}" style="width:auto">
      </div>
      <div id="espelho"><p class="muted">${funcs.length ? "Carregando…" : "Nenhum funcionário ativo."}</p></div>
    </div>`;
  document.getElementById("imprimir").onclick = () => print();
  document.getElementById("func").onchange = (e) => { estadoEspelho.funcionarioId = e.target.value; carregarEspelho(); };
  document.getElementById("mes").onchange = (e) => { estadoEspelho.mes = e.target.value; carregarEspelho(); };
  if (funcs.length) carregarEspelho();
}

async function carregarEspelho() {
  const alvo = document.getElementById("espelho");
  const { inicio, fim } = periodoDoMes(estadoEspelho.mes);
  try {
    const e = await api("GET", `/api/admin/espelho/${estadoEspelho.funcionarioId}?inicio=${inicio}&fim=${fim}`);
    alvo.innerHTML = `<div style="margin-bottom:12px"><strong>${esc(e.funcionario.nome)}</strong>
      <span class="muted"> · CPF ${e.funcionario.cpf} · ${esc(e.funcionario.jornada ?? "sem jornada")} · ${dataBr(inicio)} a ${dataBr(fim)}</span>
      <div class="muted small">${esc(e.empresa.razaoSocial)} · CNPJ ${e.empresa.cnpj}</div></div>
      ${tabelaEspelho(e, (d) => `<button class="sm" data-dia="${d.data}">Ajustar</button>`)}`;
    alvo.querySelectorAll("[data-dia]").forEach((b) => (b.onclick = () => ajustarDia(b.dataset.dia)));
  } catch (err) {
    alvo.innerHTML = `<p class="alerta">${esc(err.message)}</p>`;
  }
}

async function ajustarDia(data) {
  const fid = estadoEspelho.funcionarioId;
  const marcacoes = (await api("GET", `/api/admin/marcacoes?funcionarioId=${fid}&data=${data}`)).filter((m) => m.data === data);
  abrirModal(`<h2>Ajustar ${dataBr(data)}</h2>
    <h3>Marcações originais</h3>
    ${marcacoes.length ? `<table><tbody>${marcacoes.map((m) => `<tr>
      <td class="tnum"><strong>${m.hora}</strong> <span class="muted small">NSR ${m.nsr}</span></td>
      <td>${m.desconsiderada ? '<span class="tag">Desconsiderada</span>' : ""}</td>
      <td class="num">${m.temSelfie ? `<button class="sm" type="button" data-selfie="${m.id}">Foto</button> ` : ""}
        ${m.desconsiderada ? "" : `<button class="sm danger" type="button" data-desc="${m.id}">Desconsiderar</button>`}</td>
    </tr>`).join("")}</tbody></table>` : `<p class="muted">Nenhuma marcação neste dia.</p>`}
    <form style="margin-top:16px">
      <h3>Novo ajuste</h3>
      <div class="grid2">
        <label>Tipo<select name="tipo"><option value="INCLUSAO">Incluir marcação</option><option value="ABONO">Abonar o dia</option></select></label>
        <label id="campo-hora">Horário<input name="hora" type="time"></label>
      </div>
      <label>Motivo<input name="motivo" required placeholder="Ex.: esqueceu de marcar, atestado médico"></label>
      <div class="acoes"><button class="primary">Salvar ajuste</button><button type="button" data-fechar>Fechar</button></div>
    </form>
    <p class="muted small">A marcação original nunca é apagada: o ajuste fica registrado à parte, com autor e motivo.</p>`,
  (m) => {
    const form = m.querySelector("form");
    form.tipo.onchange = () => m.querySelector("#campo-hora").classList.toggle("oculto", form.tipo.value !== "INCLUSAO");
    aoEnviar(form, async (fd) => {
      await api("POST", `/api/admin/funcionarios/${fid}/tratamentos`, {
        tipo: fd.get("tipo"), data, hora: fd.get("hora") || undefined, motivo: fd.get("motivo"),
      });
      modal.close();
      carregarEspelho();
    });
    m.querySelectorAll("[data-selfie]").forEach((b) => (b.onclick = () => verSelfie(b.dataset.selfie)));
    m.querySelectorAll("[data-desc]").forEach((b) => (b.onclick = async () => {
      const motivo = prompt("Motivo para desconsiderar esta marcação:");
      if (!motivo) return;
      try {
        await api("POST", `/api/admin/funcionarios/${fid}/tratamentos`, { tipo: "DESCONSIDERAR", data, marcacaoId: b.dataset.desc, motivo });
        modal.close();
        carregarEspelho();
      } catch (err) { alert(err.message); }
    }));
  });
}

// ---------- Solicitações de ajuste ----------

const NOME_TIPO = { INCLUSAO: "Incluir marcação", DESCONSIDERAR: "Desconsiderar marcação", ABONO: "Abono" };

async function telaAjustes() {
  const lista = await api("GET", "/api/admin/tratamentos");
  const pendentes = lista.filter((t) => t.status === "PENDENTE");
  const outros = lista.filter((t) => t.status !== "PENDENTE").slice(0, 50);
  const linha = (t, comAcao) => `<tr>
    <td>${esc(t.funcionario.nome)}</td><td class="tnum">${dataBr(t.data)}</td>
    <td>${NOME_TIPO[t.tipo]}${t.hora ? ` <strong>${t.hora}</strong>` : ""}${t.horaMarcacao ? ` <strong>${t.horaMarcacao}</strong>` : ""}</td>
    <td>${esc(t.motivo)}</td>
    <td>${comAcao ? `<div class="acoes"><button class="sm primary" data-aprovar="${t.id}">Aprovar</button><button class="sm danger" data-rejeitar="${t.id}">Rejeitar</button></div>`
      : `<span class="tag ${t.status === "APROVADO" ? "ok" : "danger"}">${t.status === "APROVADO" ? "Aprovado" : "Rejeitado"}</span>`}</td></tr>`;
  const tabela = (itens, comAcao) => `<div class="tabela-wrap"><table>
    <thead><tr><th>Funcionário</th><th>Dia</th><th>Pedido</th><th>Motivo</th><th></th></tr></thead>
    <tbody>${itens.map((t) => linha(t, comAcao)).join("")}</tbody></table></div>`;
  conteudo.innerHTML = `${topo("Solicitações de ajuste")}
    <div class="stack">
      <div class="card"><h2>Pendentes</h2>${pendentes.length ? tabela(pendentes, true) : '<p class="muted">Nenhuma solicitação pendente.</p>'}</div>
      <div class="card"><h2>Histórico</h2>${outros.length ? tabela(outros, false) : '<p class="muted">Sem histórico.</p>'}</div>
    </div>`;
  const decidir = (id, aprovar) => api("POST", `/api/admin/tratamentos/${id}/decisao`, { aprovar }).then(telaAjustes, (e) => alert(e.message));
  conteudo.querySelectorAll("[data-aprovar]").forEach((b) => (b.onclick = () => decidir(b.dataset.aprovar, true)));
  conteudo.querySelectorAll("[data-rejeitar]").forEach((b) => (b.onclick = () => decidir(b.dataset.rejeitar, false)));
}

// ---------- Jornadas ----------

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

async function telaJornadas() {
  const lista = await api("GET", "/api/admin/jornadas");
  const resumo = (c) => c.tipo === "SEMANAL"
    ? DIAS.map((d, i) => (c.dias[i]?.length ? `${d} ${intervalosTexto(c.dias[i])}` : null)).filter(Boolean).join(" · ")
    : `Ciclo de ${c.ciclo.length} dias a partir de ${dataBr(c.dataBase)}`;
  conteudo.innerHTML = `${topo("Jornadas", `<button class="primary" id="nova">Nova jornada</button>`)}
    <div class="card"><div class="tabela-wrap"><table>
      <thead><tr><th>Nome</th><th>Horários</th><th>Tolerância</th><th></th></tr></thead>
      <tbody>${lista.map((j) => `<tr><td><strong>${esc(j.nome)}</strong></td><td class="small">${esc(resumo(j.config))}</td>
        <td>${j.toleranciaMin} min</td><td><button class="sm" data-editar="${j.id}">Editar</button></td></tr>`).join("")}</tbody>
    </table></div></div>`;
  document.getElementById("nova").onclick = () => formJornada(null);
  conteudo.querySelectorAll("[data-editar]").forEach((b) => (b.onclick = () => formJornada(lista.find((j) => j.id === b.dataset.editar))));
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
      modal.close();
      telaJornadas();
    });
  });
}

// ---------- Locais e feriados ----------

async function telaLocais() {
  const [locais, feriados] = await Promise.all([api("GET", "/api/admin/locais"), api("GET", "/api/admin/feriados")]);
  conteudo.innerHTML = `${topo("Locais e feriados")}
    <div class="stack">
      <div class="card">
        <h2>Locais permitidos</h2>
        <p class="muted small">Funcionários com GPS obrigatório só conseguem bater ponto dentro do raio de um destes locais. Sem locais cadastrados, qualquer lugar é aceito (a localização continua sendo gravada).</p>
        ${locais.length ? `<table><tbody>${locais.map((l) => `<tr><td><strong>${esc(l.nome)}</strong></td>
          <td class="small tnum">${l.latitude.toFixed(5)}, ${l.longitude.toFixed(5)}</td><td>${l.raioMetros} m</td>
          <td class="num"><button class="sm danger" data-del-local="${l.id}">Remover</button></td></tr>`).join("")}</tbody></table>` : ""}
        <form id="form-local" style="margin-top:16px">
          <div class="grid2">
            <label>Nome<input name="nome" required placeholder="Matriz"></label>
            <label>Raio (metros)<input name="raio" type="number" value="150" min="20" max="5000"></label>
            <label>Latitude<input name="lat" required inputmode="decimal"></label>
            <label>Longitude<input name="lng" required inputmode="decimal"></label>
          </div>
          <div class="acoes"><button class="primary">Adicionar local</button><button type="button" id="usar-gps">Usar minha localização</button></div>
        </form>
      </div>
      <div class="card">
        <h2>Feriados</h2>
        ${feriados.length ? `<table><tbody>${feriados.map((f) => `<tr><td class="tnum">${dataBr(f.data)}</td><td>${esc(f.descricao)}</td>
          <td class="num"><button class="sm danger" data-del-feriado="${f.id}">Remover</button></td></tr>`).join("")}</tbody></table>` : ""}
        <form id="form-feriado" style="margin-top:16px">
          <div class="grid2">
            <label>Data<input name="data" type="date" required></label>
            <label>Descrição<input name="descricao" required></label>
          </div>
          <div class="acoes"><button class="primary">Adicionar feriado</button></div>
        </form>
      </div>
    </div>`;
  const fl = document.getElementById("form-local");
  document.getElementById("usar-gps").onclick = () => navigator.geolocation.getCurrentPosition(
    (p) => { fl.lat.value = p.coords.latitude.toFixed(6); fl.lng.value = p.coords.longitude.toFixed(6); },
    () => alert("Não foi possível obter a localização"),
  );
  aoEnviar(fl, async (fd) => {
    await api("POST", "/api/admin/locais", {
      nome: fd.get("nome"), latitude: Number(fd.get("lat").replace(",", ".")),
      longitude: Number(fd.get("lng").replace(",", ".")), raioMetros: Number(fd.get("raio")),
    });
    telaLocais();
  });
  aoEnviar(document.getElementById("form-feriado"), async (fd) => {
    await api("POST", "/api/admin/feriados", Object.fromEntries(fd));
    telaLocais();
  });
  conteudo.querySelectorAll("[data-del-local]").forEach((b) => (b.onclick = () => api("DELETE", `/api/admin/locais/${b.dataset.delLocal}`).then(telaLocais)));
  conteudo.querySelectorAll("[data-del-feriado]").forEach((b) => (b.onclick = () => api("DELETE", `/api/admin/feriados/${b.dataset.delFeriado}`).then(telaLocais)));
}

// ---------- Integrações ----------

async function telaIntegracoes() {
  if (eu?.papel !== "ADMIN") {
    conteudo.innerHTML = `${topo("Integrações")}<p class="alerta warn">Somente administradores.</p>`;
    return;
  }
  const [chaves, hooks] = await Promise.all([api("GET", "/api/admin/api-keys"), api("GET", "/api/admin/webhooks")]);
  const { inicio, fim } = periodoDoMes(mesAtual());
  conteudo.innerHTML = `${topo("Integrações (ERP)")}
    <div class="stack">
      <div class="card">
        <h2>Chaves de API</h2>
        <p class="muted small">Use no ERP com o header <code>Authorization: Bearer pk_…</code>. Endpoints em <code>/api/v1</code>; veja <code>docs/integracao-erp.md</code>.</p>
        ${chaves.length ? `<table><tbody>${chaves.map((k) => `<tr><td><strong>${esc(k.nome)}</strong></td><td class="mono">${k.prefixo}…</td>
          <td class="small muted">${k.ultimoUso ? "Último uso " + new Date(k.ultimoUso).toLocaleString("pt-BR") : "Nunca usada"}</td>
          <td class="num">${k.revogadaEm ? '<span class="tag">Revogada</span>' : `<button class="sm danger" data-revogar="${k.id}">Revogar</button>`}</td></tr>`).join("")}</tbody></table>` : ""}
        <form id="form-chave" style="margin-top:16px"><div class="acoes">
          <input name="nome" required placeholder="Nome da chave (ex.: Verissimo ERP)" style="flex:1;min-width:200px">
          <button class="primary">Gerar chave</button></div></form>
        <div id="chave-nova"></div>
      </div>
      <div class="card">
        <h2>Webhooks</h2>
        <p class="muted small">O sistema avisa o ERP em tempo real. Cada envio leva o header <code>X-Ponto-Assinatura: sha256=HMAC(segredo, corpo)</code>.</p>
        ${hooks.length ? `<table><tbody>${hooks.map((h) => `<tr><td class="small">${esc(h.url)}<br><span class="muted">${esc(h.eventos)}</span></td>
          <td class="mono">${h.segredo}</td><td class="num"><button class="sm danger" data-del-hook="${h.id}">Remover</button></td></tr>`).join("")}</tbody></table>` : ""}
        <form id="form-hook" style="margin-top:16px">
          <label>URL<input name="url" type="url" required placeholder="https://seu-erp.com.br/webhooks/ponto"></label>
          <label class="check"><input type="checkbox" name="ev" value="marcacao.criada" checked> marcacao.criada</label>
          <label class="check"><input type="checkbox" name="ev" value="tratamento.decidido" checked> tratamento.decidido</label>
          <label class="check"><input type="checkbox" name="ev" value="funcionario.alterado"> funcionario.alterado</label>
          <div class="acoes"><button class="primary">Adicionar webhook</button></div>
        </form>
      </div>
      <div class="card">
        <h2>Arquivo AFD (fiscalização)</h2>
        <p class="muted small">Arquivo Fonte de Dados com todas as marcações originais do período, no leiaute da Portaria 671.</p>
        <form id="form-afd"><div class="acoes">
          <input name="inicio" type="date" value="${inicio}" style="width:auto"> até
          <input name="fim" type="date" value="${fim}" style="width:auto">
          <button class="primary">Baixar AFD</button></div></form>
      </div>
    </div>`;
  aoEnviar(document.getElementById("form-chave"), async (fd) => {
    const { chave } = await api("POST", "/api/admin/api-keys", { nome: fd.get("nome") });
    await telaIntegracoes();
    document.getElementById("chave-nova").innerHTML = `<p class="alerta ok">Copie agora, ela não será mostrada de novo:<br><span class="mono">${chave}</span></p>`;
  });
  aoEnviar(document.getElementById("form-hook"), async (fd) => {
    await api("POST", "/api/admin/webhooks", { url: fd.get("url"), eventos: fd.getAll("ev") });
    telaIntegracoes();
  });
  aoEnviar(document.getElementById("form-afd"), async (fd) => {
    const url = await blobAutenticado(`/api/admin/afd?inicio=${fd.get("inicio")}&fim=${fd.get("fim")}`);
    Object.assign(document.createElement("a"), { href: url, download: `AFD_${fd.get("inicio")}_${fd.get("fim")}.txt` }).click();
  });
  conteudo.querySelectorAll("[data-revogar]").forEach((b) => (b.onclick = () => confirm("Revogar esta chave? O ERP perderá o acesso.") && api("DELETE", `/api/admin/api-keys/${b.dataset.revogar}`).then(telaIntegracoes)));
  conteudo.querySelectorAll("[data-del-hook]").forEach((b) => (b.onclick = () => api("DELETE", `/api/admin/webhooks/${b.dataset.delHook}`).then(telaIntegracoes)));
}

// ---------- Navegação ----------

const telas = {
  painel: telaPainel, funcionarios: telaFuncionarios, espelho: telaEspelho, ajustes: telaAjustes,
  jornadas: telaJornadas, locais: telaLocais, integracoes: telaIntegracoes,
};

async function navegar() {
  const nome = location.hash.slice(1) || "painel";
  document.querySelectorAll("#menu a[href^='#']").forEach((a) => a.classList.toggle("ativo", a.getAttribute("href") === `#${nome}`));
  conteudo.innerHTML = `<p class="muted">Carregando…</p>`;
  try {
    await (telas[nome] ?? telaPainel)();
  } catch (err) {
    conteudo.innerHTML = `<p class="alerta">${esc(err.message)}</p>`;
  }
}
addEventListener("hashchange", navegar);
navegar();
