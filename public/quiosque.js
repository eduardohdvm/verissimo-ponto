// Tablet compartilhado: ponto por rosto (o servidor identifica quem é) ou por matrícula + PIN.
import { esc, LOGO } from "/app.js";
import { capturar, carregarModelos, executarDesafio } from "/face-cliente.js";

const CHAVE = "quiosque-token";
const tela = document.getElementById("tela");
let info = null;
let stream = null;
let ocupado = false;

async function chamar(metodo, url, corpo) {
  const r = await fetch(url, {
    method: metodo,
    headers: { "Content-Type": "application/json", "X-Quiosque": localStorage.getItem(CHAVE) ?? "" },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = await r.json().catch(() => ({}));
  if (r.status === 401 && url !== "/api/quiosque/parear") {
    localStorage.removeItem(CHAVE);
    telaPareamento(dados.erro);
    throw new Error(dados.erro);
  }
  if (!r.ok) throw Object.assign(new Error(dados.erro ?? "Erro inesperado"), { status: r.status });
  return dados;
}

// ---------- Pareamento (uma vez por tablet) ----------

function telaPareamento(aviso) {
  tela.innerHTML = `<div class="centro" style="min-height:auto;padding-top:10vh"><form class="card caixa" id="form">
    <div class="marca" style="padding:0 0 16px">${LOGO}<span>Quiosque de ponto</span></div>
    <h1>Parear este tablet</h1>
    <p class="muted">No painel do RH, abra <strong>Quiosques</strong>, crie um quiosque e digite aqui o código de 6 números.</p>
    <label>Código<input name="codigo" inputmode="numeric" maxlength="6" autocomplete="off" required style="font-size:28px;letter-spacing:8px;text-align:center"></label>
    <p class="alerta ${aviso ? "" : "oculto"}" id="erro">${esc(aviso ?? "")}</p>
    <button class="primary grande">Parear</button>
  </form></div>`;
  const form = document.getElementById("form");
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await chamar("POST", "/api/quiosque/parear", { codigo: form.codigo.value.trim() });
      localStorage.setItem(CHAVE, r.token);
      iniciar();
    } catch (err) {
      const el = document.getElementById("erro");
      el.textContent = err.message;
      el.classList.remove("oculto");
    }
  };
}

// ---------- Tela principal ----------

function telaPrincipal() {
  tela.innerHTML = `
    <div class="cab"><div class="marca" style="padding:0">${LOGO}<span>${esc(info.empresa)}</span></div><span class="muted small">${esc(info.nome)}</span></div>
    <div class="relogio"><div class="hora" id="hora">--:--</div><div class="muted" id="data"></div></div>
    <div class="camera" id="camera"><span class="muted">Ligando a câmera…</span>
      <div class="guia oculto" id="guia"><span></span><div class="barra"><i></i></div></div></div>
    <p class="alerta oculto" id="msg"></p>
    <div id="acoes" class="stack">
      ${info.facial ? `<button class="primary grande" id="rosto">Bater ponto com o rosto</button>` : ""}
      ${info.permitePin ? `<button class="grande ${info.facial ? "" : "primary"}" id="pin">Bater ponto com matrícula e PIN</button>` : ""}
    </div>`;
  ligarCamera();
  document.getElementById("rosto")?.addEventListener("click", baterComRosto);
  document.getElementById("pin")?.addEventListener("click", telaPin);
  tique();
}

function tique() {
  const h = document.getElementById("hora");
  if (!h) return;
  const agora = new Date();
  h.textContent = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  document.getElementById("data").textContent = agora.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
}
setInterval(tique, 1000);

async function ligarCamera() {
  try {
    stream ??= await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 } }, audio: false });
    const video = Object.assign(document.createElement("video"), { autoplay: true, playsInline: true, muted: true, srcObject: stream });
    document.getElementById("camera").replaceChildren(video, document.getElementById("guia"));
  } catch {
    document.getElementById("camera").innerHTML = `<span class="muted" style="padding:16px;text-align:center">Câmera indisponível. ${info.facial ? "O ponto por rosto não vai funcionar." : ""}</span>`;
  }
}

const video = () => document.querySelector("#camera video");

function mensagem(texto, tipo = "") {
  const el = document.getElementById("msg");
  if (!el) return;
  el.className = `alerta ${tipo}`;
  el.textContent = texto;
  clearTimeout(mensagem.t);
  mensagem.t = setTimeout(() => el.classList.add("oculto"), 6000);
}

function guia(texto, progresso) {
  const g = document.getElementById("guia");
  if (!g) return;
  g.classList.toggle("oculto", texto == null);
  if (texto == null) return;
  g.querySelector("span").textContent = texto;
  g.querySelector("i").style.width = `${Math.round(progresso * 100)}%`;
}

async function baterComRosto() {
  if (ocupado || !video()) return;
  ocupado = true;
  document.getElementById("acoes").classList.add("oculto");
  try {
    const d = await chamar("POST", "/api/quiosque/desafio");
    const quadros = await executarDesafio(video(), d.passos, guia, { tempoLimiteMs: 20_000 });
    guia("Identificando…", 1);
    const r = await chamar("POST", "/api/quiosque/registrar-rosto", { desafioId: d.id, quadros });
    sucesso(r);
  } catch (err) {
    mensagem(err.message);
  } finally {
    guia(null);
    ocupado = false;
    document.getElementById("acoes")?.classList.remove("oculto");
  }
}

function telaPin() {
  let campo = "identificador";
  const valores = { identificador: "", pin: "" };
  const acoes = document.getElementById("acoes");
  const render = () => {
    acoes.innerHTML = `<div class="card">
      <p class="small muted" style="margin:0 0 6px">${campo === "identificador" ? "Digite a sua matrícula (ou CPF)" : "Agora o seu PIN"}</p>
      <div class="pin-visor">${campo === "identificador" ? esc(valores.identificador) || "&nbsp;" : "•".repeat(valores.pin.length) || "&nbsp;"}</div>
      <div class="teclado">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-n="${n}">${n}</button>`).join("")}
        <button data-n="apagar" aria-label="Apagar">⌫</button><button data-n="0">0</button><button data-n="ok" class="primary">OK</button></div>
      <button class="sm" id="cancelar" style="margin-top:12px">Cancelar</button></div>`;
    acoes.querySelectorAll("[data-n]").forEach((b) => (b.onclick = () => tecla(b.dataset.n)));
    document.getElementById("cancelar").onclick = telaPrincipal;
  };
  const tecla = async (n) => {
    if (n === "apagar") valores[campo] = valores[campo].slice(0, -1);
    else if (n !== "ok") valores[campo] = (valores[campo] + n).slice(0, campo === "pin" ? 6 : 14);
    else if (campo === "identificador" && valores.identificador) campo = "pin";
    else if (campo === "pin" && valores.pin.length >= 4) return enviarPin(valores);
    render();
  };
  render();
}

async function enviarPin(valores) {
  if (ocupado) return;
  ocupado = true;
  try {
    const foto = video() ? capturar(video()) : undefined;
    const r = await chamar("POST", "/api/quiosque/registrar-pin", { ...valores, foto });
    sucesso(r);
  } catch (err) {
    telaPrincipal();
    mensagem(err.message);
  } finally {
    ocupado = false;
  }
}

function sucesso(r) {
  const tipo = r.sequenciaHoje % 2 === 1 ? "Entrada" : "Saída";
  const hora = r.dataHora.slice(11, 16);
  tela.innerHTML = `<div class="resultado card" style="margin-top:12vh">
    <div style="font-size:64px">✓</div>
    <div class="nome">${esc(r.nome.split(" ")[0])}</div>
    <div class="tipo">${tipo} registrada às <strong>${hora}</strong></div>
    <p class="muted small" style="margin-top:20px">Comprovante NSR ${r.nsr} · código ${esc(r.hash.slice(0, 16))}…<br>
      O comprovante completo fica no app do ponto, em "Marcações de hoje".</p>
  </div>`;
  setTimeout(telaPrincipal, 5000);
}

// Mantém a tela do tablet ligada
async function manterTelaLigada() {
  try {
    await navigator.wakeLock?.request("screen");
  } catch {}
}
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && manterTelaLigada());

async function iniciar() {
  if (!localStorage.getItem(CHAVE)) return telaPareamento();
  try {
    info = await chamar("GET", "/api/quiosque/info");
  } catch (err) {
    if (localStorage.getItem(CHAVE)) tela.innerHTML = `<p class="alerta">${esc(err.message)}</p>`;
    return;
  }
  telaPrincipal();
  manterTelaLigada();
  if (info.facial) carregarModelos().catch(() => mensagem("Não foi possível carregar o reconhecimento facial."));
}
iniciar();
