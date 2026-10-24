import { api, dataBr, esc, hhmm, mesAtual, NOME_AFASTAMENTO, saldo, sair, tabelaEspelho, token } from "/app.js";
import { carregarModelos, desafioLocal, executarDesafio } from "/face-cliente.js";
import { ativarPush, estadoPush } from "/push.js";

if (!token.get()) location.href = "/";
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

const $ = (id) => document.getElementById(id);
const origem = matchMedia("(pointer: coarse)").matches ? "MOBILE" : "WEB";
const FILA = "ponto-fila-offline";
let config = { exigeSelfie: true, exigeGps: true, exigeFacial: false, rostoCadastrado: false };
let modelosProntos = false;
const precisaCamera = () => config.exigeSelfie || config.exigeFacial;
let posicao = null;
let stream = null;
let dia = null; // resposta de /api/ponto/hoje

$("sair").onclick = sair;

// ---------- Relógio ----------
function tique() {
  const agora = new Date();
  $("hora").textContent = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  $("data").textContent = agora.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
}
tique();
setInterval(tique, 1000);

// ---------- Estado: câmera, GPS, conexão ----------
function atualizarStatus() {
  const itens = [];
  if (config.exigeGps) {
    itens.push(posicao
      ? `<span class="tag ok">Localização ok (±${Math.round(posicao.precisao)} m)</span>`
      : `<span class="tag warn">Aguardando localização…</span>`);
  }
  if (precisaCamera()) itens.push(stream ? `<span class="tag ok">Câmera ok</span>` : `<span class="tag warn">Câmera desligada</span>`);
  if (config.exigeFacial) {
    itens.push(modelosProntos
      ? `<span class="tag ok">Reconhecimento facial pronto</span>`
      : `<span class="tag warn">Preparando reconhecimento facial…</span>`);
  }
  itens.push(navigator.onLine ? `<span class="tag ok">Online</span>` : `<span class="tag warn">Offline: a marcação será enviada depois</span>`);
  const pendentes = lerFila().length;
  if (pendentes) itens.push(`<span class="tag info">${pendentes} marcação(ões) aguardando envio</span>`);
  $("status").innerHTML = itens.join("");
  const proxima = (dia?.marcacoes.length ?? 0) % 2 === 0 ? "entrada" : "saída";
  $("registrar").textContent = `Registrar ${proxima}`;
  $("registrar").disabled =
    dia?.consentimentoPendente ||
    (config.exigeGps && !posicao) ||
    (precisaCamera() && !stream) ||
    (config.exigeFacial && (!modelosProntos || !config.rostoCadastrado));
}

async function ligarCamera() {
  if (!precisaCamera()) {
    $("camera").classList.add("oculto");
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 } }, audio: false });
    const video = document.createElement("video");
    Object.assign(video, { autoplay: true, playsInline: true, muted: true, srcObject: stream });
    $("camera").replaceChildren(video, $("guia"));
  } catch {
    $("camera").innerHTML = `<span class="muted small" style="padding:16px;text-align:center">Permita o acesso à câmera para bater o ponto.</span>`;
  }
  atualizarStatus();
}

function ligarGps() {
  if (!config.exigeGps || !navigator.geolocation) return atualizarStatus();
  navigator.geolocation.watchPosition(
    (p) => {
      posicao = { latitude: p.coords.latitude, longitude: p.coords.longitude, precisao: p.coords.accuracy };
      atualizarStatus();
    },
    () => mostrarMsg("Permita o acesso à localização para bater o ponto.", "warn"),
    { enableHighAccuracy: true, maximumAge: 30_000 },
  );
}

function tirarFoto() {
  const video = $("camera").querySelector("video");
  if (!video) return undefined;
  const canvas = $("canvas");
  const largura = 480;
  canvas.width = largura;
  canvas.height = Math.round((video.videoHeight / video.videoWidth) * largura) || 360;
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.75);
}

function guia(texto, progresso) {
  const g = $("guia");
  g.classList.toggle("oculto", texto == null);
  if (texto == null) return;
  g.querySelector("span").textContent = texto;
  g.querySelector("i").style.width = `${Math.round(progresso * 100)}%`;
}

/** Prova de vida: pede o desafio ao servidor (ou sorteia no aparelho, se estiver sem internet). */
async function provaDeVida() {
  let desafioId;
  let passos;
  try {
    const d = await api("POST", "/api/ponto/desafio");
    desafioId = d.id;
    passos = d.passos;
  } catch (err) {
    if (err.status) throw err;
    passos = desafioLocal();
  }
  try {
    const quadros = await executarDesafio($("camera").querySelector("video"), passos, guia);
    return { desafioId, quadros };
  } finally {
    guia(null);
  }
}

function mostrarMsg(texto, tipo = "") {
  const el = $("msg");
  el.className = `alerta ${tipo}`;
  el.textContent = texto;
}

// ---------- Marcações do dia ----------
async function carregarHoje() {
  try {
    const h = await api("GET", "/api/ponto/hoje");
    dia = h;
    config = h.funcionario;
    $("nome").textContent = h.funcionario.nome;
    $("empresa").textContent = h.empresa;
    $("marcas").innerHTML = h.marcacoes.length
      ? h.marcacoes.map((m, i) => `<button class="tag ${i % 2 ? "" : "info"}" data-comp="${m.id}">${i % 2 ? "Saída" : "Entrada"} ${m.hora}</button>`).join("")
      : `<span class="muted">Nenhuma ainda</span>`;
    $("marcas").querySelectorAll("[data-comp]").forEach((b) => (b.onclick = async () => mostrarComprovante(await api("GET", `/api/ponto/comprovante/${b.dataset.comp}`))));
    $("pendentes").textContent = h.assinaturasPendentes;
    $("pendentes").classList.toggle("oculto", !h.assinaturasPendentes);
    atualizarResumo();
    if (h.consentimentoPendente) mostrarTermo();
  } catch (err) {
    if (err.status) mostrarMsg(err.message);
  }
}

/** Horas trabalhadas hoje (contando o turno em aberto até agora) e saldo do banco. */
function atualizarResumo() {
  if (!dia) return;
  const t = dia.marcacoes.map((m) => new Date(m.dataHora).getTime());
  let ms = 0;
  for (let i = 0; i < t.length; i += 2) ms += (t[i + 1] ?? Date.now()) - t[i];
  const min = Math.floor(ms / 60000);
  $("resumo").innerHTML = `<span>Hoje: <strong>${hhmm(min) === "—" ? "00:00" : hhmm(min)}</strong>${dia.previstoHojeMin ? ` de ${hhmm(dia.previstoHojeMin)}` : ""}</span>
    ${dia.bancoMin !== null ? `<span>Banco de horas: <strong>${saldo(dia.bancoMin)}</strong></span>` : ""}`;
}
setInterval(atualizarResumo, 30_000);

async function mostrarTermo() {
  const t = await api("GET", "/api/ponto/termo");
  const d = $("comprovante");
  d.innerHTML = `<h2>Uso dos seus dados</h2>
    ${t.paragrafos.map((p) => `<p class="small" style="margin:0 0 8px">${esc(p)}</p>`).join("")}
    <div class="acoes" style="margin-top:16px"><button class="primary" id="aceitar">Li e estou ciente</button></div>`;
  d.showModal();
  d.oncancel = (e) => e.preventDefault(); // não fecha sem aceitar
  $("aceitar").onclick = async () => {
    await api("POST", "/api/ponto/consentimento", { versao: t.versao });
    dia.consentimentoPendente = false;
    d.oncancel = null;
    d.close();
    atualizarStatus();
  };
}

// ---------- Fila offline ----------
function lerFila() {
  try { return JSON.parse(localStorage.getItem(FILA) ?? "[]"); } catch { return []; }
}
function salvarFila(f) {
  localStorage.setItem(FILA, JSON.stringify(f));
}

async function sincronizarFila() {
  const fila = lerFila();
  if (!fila.length || !navigator.onLine) return;
  const restantes = [];
  for (const item of fila) {
    try {
      await api("POST", "/api/ponto/registrar", item);
    } catch (err) {
      // Erro de rede: tenta de novo depois. Erro de regra (4xx): descarta e avisa.
      if (!err.status) restantes.push(item);
      else mostrarMsg(`Marcação offline de ${new Date(item.dataHoraOffline).toLocaleString("pt-BR")} recusada: ${err.message}`);
    }
  }
  salvarFila(restantes);
  atualizarStatus();
  carregarHoje();
}

// ---------- Registrar ----------
$("registrar").onclick = async () => {
  const botao = $("registrar");
  botao.disabled = true;
  $("msg").className = "alerta oculto";
  let corpo;
  try {
    corpo = {
      origem,
      ...(posicao ?? {}),
      ...(config.exigeFacial ? await provaDeVida() : { selfie: config.exigeSelfie ? tirarFoto() : undefined }),
    };
  } catch (err) {
    mostrarMsg(err.message);
    atualizarStatus();
    return;
  }
  try {
    const c = await api("POST", "/api/ponto/registrar", corpo);
    mostrarComprovante(c);
    await carregarHoje();
  } catch (err) {
    if (!err.status) {
      salvarFila([...lerFila(), { ...corpo, dataHoraOffline: new Date().toISOString() }]);
      mostrarMsg("Sem conexão: a marcação foi guardada no aparelho e será enviada automaticamente.", "warn");
    } else {
      mostrarMsg(err.message);
    }
  } finally {
    atualizarStatus();
  }
};

function mostrarComprovante(c) {
  const d = $("comprovante");
  d.innerHTML = `<h2>Ponto registrado</h2>
    <p class="alerta ok" style="font-size:22px;text-align:center"><strong>${c.dataHora.slice(11, 16)}</strong></p>
    <h3>Comprovante de registro de ponto</h3>
    <table class="small"><tbody>
      <tr><td class="muted">Empregador</td><td>${esc(c.empregador)}<br>CNPJ ${c.cnpj}</td></tr>
      <tr><td class="muted">Trabalhador</td><td>${esc(c.trabalhador)}<br>CPF ${c.cpf}</td></tr>
      <tr><td class="muted">Data e hora</td><td class="tnum">${dataBr(c.dataHora.slice(0, 10))} ${c.dataHora.slice(11, 19)}</td></tr>
      <tr><td class="muted">NSR</td><td class="tnum">${c.nsr}</td></tr>
      <tr><td class="muted">Código</td><td class="mono">${c.hash}</td></tr>
    </tbody></table>
    <div class="acoes" style="margin-top:16px"><button class="primary" id="fechar-comp">Ok</button>
      <button id="pdf-comp">Baixar PDF</button></div>`;
  d.showModal();
  $("fechar-comp").onclick = () => d.close();
  $("pdf-comp").onclick = async () => {
    const r = await fetch(`/api/ponto/comprovante/${c.id}/pdf`, { headers: { Authorization: `Bearer ${token.get()}` } });
    if (!r.ok) return alert("Não foi possível gerar o PDF");
    const url = URL.createObjectURL(await r.blob());
    Object.assign(document.createElement("a"), { href: url, download: `comprovante-ponto-${c.nsr}.pdf` }).click();
  };
}

// ---------- Abas ----------
document.querySelectorAll("[data-aba]").forEach((b) => (b.onclick = () => {
  document.querySelectorAll("[data-aba]").forEach((x) => x.classList.toggle("ativo", x === b));
  for (const aba of ["bater", "espelho", "ajuste", "assinar"]) $(`aba-${aba}`).classList.toggle("oculto", aba !== b.dataset.aba);
  if (b.dataset.aba === "espelho") carregarEspelho();
  if (b.dataset.aba === "ajuste") carregarSolicitacoes();
  if (b.dataset.aba === "assinar") carregarAssinaturas();
}));

$("mes").value = mesAtual();
$("mes").onchange = carregarEspelho;
async function carregarEspelho() {
  $("espelho").innerHTML = `<p class="muted">Carregando…</p>`;
  try {
    const e = await api("GET", `/api/ponto/espelho?mes=${$("mes").value}`);
    $("espelho").innerHTML = tabelaEspelho(e);
  } catch (err) {
    $("espelho").innerHTML = `<p class="alerta">${esc(err.message)}</p>`;
  }
}

const formAjuste = $("form-ajuste");
formAjuste.tipo.onchange = () => {
  const tipo = formAjuste.tipo.value;
  $("campo-hora").classList.toggle("oculto", tipo !== "INCLUSAO");
  $("campo-fim").classList.toggle("oculto", tipo !== "ATESTADO");
  $("campo-anexo").classList.toggle("oculto", tipo !== "ATESTADO");
  $("rotulo-data").textContent = tipo === "ATESTADO" ? "Do dia" : "Dia";
};

/** Foto do atestado: reduz imagens grandes antes de enviar; PDF vai como está. */
async function lerAnexo(arquivo) {
  if (!arquivo) return null;
  if (arquivo.type === "application/pdf") {
    if (arquivo.size > 4 * 1024 * 1024) throw new Error("PDF muito grande (máximo 4 MB)");
    return new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(arquivo); });
  }
  const img = new Image();
  img.src = URL.createObjectURL(arquivo);
  await img.decode();
  const escala = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * escala);
  c.height = Math.round(img.naturalHeight * escala);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}

formAjuste.onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(formAjuste);
  const erro = $("erro-ajuste");
  const botao = formAjuste.querySelector("button");
  botao.disabled = true;
  try {
    if (fd.get("tipo") === "ATESTADO") {
      await api("POST", "/api/ponto/afastamentos", {
        tipo: "ATESTADO", inicio: fd.get("data"), fim: fd.get("fim") || fd.get("data"),
        observacao: fd.get("motivo"), anexo: await lerAnexo(formAjuste.anexo.files[0]),
      });
    } else {
      await api("POST", "/api/ponto/tratamentos", {
        tipo: fd.get("tipo"), data: fd.get("data"), hora: fd.get("hora") || undefined, motivo: fd.get("motivo"),
      });
    }
    formAjuste.reset();
    formAjuste.tipo.onchange();
    erro.className = "alerta ok";
    erro.textContent = "Enviado. Você vê a resposta do seu gestor logo abaixo.";
    carregarSolicitacoes();
  } catch (err) {
    erro.className = "alerta";
    erro.textContent = err.message;
  } finally {
    botao.disabled = false;
  }
};

const STATUS = { PENDENTE: ["Pendente", "warn"], APROVADO: ["Aprovado", "ok"], REJEITADO: ["Rejeitado", "danger"] };
async function carregarSolicitacoes() {
  const [ajustes, afastamentos] = await Promise.all([api("GET", "/api/ponto/tratamentos"), api("GET", "/api/ponto/afastamentos")]);
  const lista = [
    ...ajustes.map((t) => ({ data: t.data, texto: t.motivo, status: t.status, criadoEm: t.criadoEm })),
    ...afastamentos.map((a) => ({
      data: a.inicio,
      texto: `${NOME_AFASTAMENTO[a.tipo] ?? a.tipo}${a.fim !== a.inicio ? ` até ${dataBr(a.fim)}` : ""}${a.observacao ? ` · ${a.observacao}` : ""}`,
      status: a.status,
      criadoEm: a.criadoEm,
    })),
  ].sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
  $("minhas").innerHTML = lista.length
    ? `<table class="small"><tbody>${lista.map((t) => `<tr><td class="tnum">${dataBr(t.data)}</td><td>${esc(t.texto)}</td>
        <td><span class="tag ${STATUS[t.status][1]}">${STATUS[t.status][0]}</span></td></tr>`).join("")}</tbody></table>`
    : `<p class="muted">Nenhuma solicitação.</p>`;
}

// ---------- Assinatura do espelho ----------
const SITUACAO = { PENDENTE: ["Aguardando você", "warn"], ASSINADO: ["Assinado", "ok"], CONTESTADO: ["Contestado", "danger"] };

async function carregarAssinaturas() {
  const lista = await api("GET", "/api/ponto/assinaturas");
  $("assinaturas").innerHTML = lista.length
    ? `<table class="small"><tbody>${lista.map((a) => `<tr><td class="tnum">${dataBr(a.inicio)} a ${dataBr(a.fim)}</td>
        <td><span class="tag ${SITUACAO[a.status][1]}">${SITUACAO[a.status][0]}</span></td>
        <td class="num"><button class="sm ${a.status === "PENDENTE" ? "primary" : ""}" data-assinatura="${a.id}">${a.status === "PENDENTE" ? "Conferir" : "Ver"}</button></td></tr>`).join("")}</tbody></table>`
    : `<p class="muted">Nenhum espelho fechado ainda.</p>`;
  $("assinaturas").querySelectorAll("[data-assinatura]").forEach((b) => (b.onclick = () => abrirAssinatura(b.dataset.assinatura)));
}

async function abrirAssinatura(id) {
  const e = await api("GET", `/api/ponto/assinaturas/${id}`);
  const a = e.assinatura;
  const d = $("comprovante");
  d.innerHTML = `<h2>Espelho ${dataBr(e.periodo.inicio)} a ${dataBr(e.periodo.fim)}</h2>
    <div style="max-height:50vh;overflow:auto">${tabelaEspelho(e)}</div>
    ${a.status === "PENDENTE" ? `<form id="form-assinar" style="margin-top:12px">
        <label id="campo-senha-ass">Confirme com a sua senha para assinar<input name="senha" type="password" autocomplete="current-password"></label>
        <label id="campo-contestar" class="oculto">O que está errado?<input name="observacao"></label>
        <p class="alerta oculto" id="erro-assinar"></p>
        <div class="acoes"><button class="primary">Assinar</button>
          <button type="button" id="contestar">Contestar</button><button type="button" id="fechar-ass">Fechar</button></div>
      </form>`
      : `<p class="alerta ${a.status === "ASSINADO" ? "ok" : "warn"} small" style="margin-top:12px">${a.status === "ASSINADO" ? "Assinado" : "Contestado"} em ${new Date(a.assinadoEm).toLocaleString("pt-BR")}.</p>
        <div class="acoes"><a class="btn" href="/espelho-assinado?id=${a.id}" target="_blank">Imprimir</a><button type="button" id="fechar-ass">Fechar</button></div>`}`;
  d.showModal();
  $("fechar-ass").onclick = () => d.close();
  const form = $("form-assinar");
  if (!form) return;
  let modo = "ASSINAR";
  $("contestar").onclick = () => {
    modo = "CONTESTAR";
    $("campo-contestar").classList.remove("oculto");
    $("campo-senha-ass").classList.add("oculto");
    form.querySelector("button.primary").textContent = "Enviar contestação";
  };
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    try {
      await api("POST", `/api/ponto/assinaturas/${id}`, { acao: modo, senha: form.senha.value, observacao: form.observacao.value });
      d.close();
      carregarAssinaturas();
      carregarHoje();
    } catch (err) {
      const el = $("erro-assinar");
      el.textContent = err.message;
      el.classList.remove("oculto");
    }
  };
}

// ---------- Avisos (Web Push) ----------
async function prepararAvisos() {
  if ((await estadoPush()) !== "INATIVO") return;
  $("avisos").classList.remove("oculto");
  $("ativar-push").onclick = async () => {
    try {
      await ativarPush();
      $("avisos").classList.add("oculto");
    } catch (err) {
      alert(err.message);
    }
  };
}

// ---------- Início ----------
const abaInicial = location.hash.slice(1);
if (["espelho", "ajuste", "assinar"].includes(abaInicial)) document.querySelector(`[data-aba="${abaInicial}"]`).click();
prepararAvisos();
addEventListener("online", () => { atualizarStatus(); sincronizarFila(); });
addEventListener("offline", atualizarStatus);
await carregarHoje();
if (config.exigeFacial) {
  if (!config.rostoCadastrado) mostrarMsg("Seu rosto ainda não foi cadastrado. Procure o RH para liberar o ponto.", "warn");
  carregarModelos().then(
    () => { modelosProntos = true; atualizarStatus(); },
    () => mostrarMsg("Não foi possível carregar o reconhecimento facial. Verifique a conexão e recarregue a página."),
  );
}
atualizarStatus();
ligarCamera();
ligarGps();
sincronizarFila();
