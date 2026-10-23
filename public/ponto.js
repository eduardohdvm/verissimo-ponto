import { api, dataBr, esc, mesAtual, sair, tabelaEspelho, token } from "/app.js";
import { carregarModelos, desafioLocal, executarDesafio } from "/face-cliente.js";

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
  $("registrar").disabled =
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
    config = h.funcionario;
    $("nome").textContent = h.funcionario.nome;
    $("empresa").textContent = h.empresa;
    $("marcas").innerHTML = h.marcacoes.length
      ? h.marcacoes.map((m, i) => `<span class="tag ${i % 2 ? "" : "info"}" title="NSR ${m.nsr}">${i % 2 ? "Saída" : "Entrada"} ${m.hora}</span>`).join("")
      : `<span class="muted">Nenhuma ainda</span>`;
  } catch (err) {
    if (err.status) mostrarMsg(err.message);
  }
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
    carregarHoje();
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
    <div class="acoes" style="margin-top:16px"><button class="primary" id="fechar-comp">Ok</button></div>`;
  d.showModal();
  $("fechar-comp").onclick = () => d.close();
}

// ---------- Abas ----------
document.querySelectorAll("[data-aba]").forEach((b) => (b.onclick = () => {
  document.querySelectorAll("[data-aba]").forEach((x) => x.classList.toggle("ativo", x === b));
  for (const aba of ["bater", "espelho", "ajuste"]) $(`aba-${aba}`).classList.toggle("oculto", aba !== b.dataset.aba);
  if (b.dataset.aba === "espelho") carregarEspelho();
  if (b.dataset.aba === "ajuste") carregarSolicitacoes();
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
formAjuste.tipo.onchange = () => $("campo-hora").classList.toggle("oculto", formAjuste.tipo.value !== "INCLUSAO");
formAjuste.onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(formAjuste);
  try {
    await api("POST", "/api/ponto/tratamentos", {
      tipo: fd.get("tipo"), data: fd.get("data"), hora: fd.get("hora") || undefined, motivo: fd.get("motivo"),
    });
    formAjuste.reset();
    carregarSolicitacoes();
  } catch (err) {
    alert(err.message);
  }
};

const STATUS = { PENDENTE: ["Pendente", "warn"], APROVADO: ["Aprovado", "ok"], REJEITADO: ["Rejeitado", "danger"] };
async function carregarSolicitacoes() {
  const lista = await api("GET", "/api/ponto/tratamentos");
  $("minhas").innerHTML = lista.length
    ? `<table class="small"><tbody>${lista.map((t) => `<tr><td class="tnum">${dataBr(t.data)}</td><td>${esc(t.motivo)}</td>
        <td><span class="tag ${STATUS[t.status][1]}">${STATUS[t.status][0]}</span></td></tr>`).join("")}</tbody></table>`
    : `<p class="muted">Nenhuma solicitação.</p>`;
}

// ---------- Início ----------
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
