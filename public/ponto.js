// App do funcionário: Home, bater ponto, espelho, histórico com fotos, arquivos, suporte e menu.
import { api, blobAutenticado, dataBr, DIAS, esc, hhmm, mesAtual, NOME_AFASTAMENTO, saldo, sair, tagsOcorrencias, tabelaEspelho, token } from "/app.js";
import { carregarModelos, desafioLocal, executarDesafio } from "/face-cliente.js";
import { estadoInstalacao, instalarApp, quandoMudar } from "/instalar.js";
import { ativarPush, estadoPush } from "/push.js";

if (!token.get()) location.href = "/";
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

const $ = (id) => document.getElementById(id);
const tela = $("tela");
const modal = $("modal");
const origem = matchMedia("(pointer: coarse)").matches ? "MOBILE" : "WEB";
const FILA = "ponto-fila-offline";
let config = { exigeSelfie: true, exigeGps: true, exigeFacial: false, rostoCadastrado: false };
let modelosProntos = false;
const precisaCamera = () => config.exigeSelfie || config.exigeFacial;
let posicao = null;
let stream = null;
let dia = null; // /api/ponto/hoje: configuração, marcações de hoje, consentimento
let inicio = null; // /api/ponto/inicio: dados da Home

const hm = (min) => (hhmm(min) === "—" ? "00:00" : hhmm(min));
const horasTexto = (min) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}min`;
const mesCurto = (mes) => `${["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"][Number(mes.slice(5)) - 1]}/${mes.slice(2, 4)}`;
const iniciais = (nome) => nome.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();

// Ícones em traço (mesmo estilo da barra inferior)
const I = {
  entrada: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/>',
  saida: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  pausa: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>',
  retorno: '<circle cx="12" cy="12" r="9"/><path d="M10 8l6 4-6 4z"/>',
  descendo: '<path d="M3 7l6 6 4-4 8 8"/><path d="M21 11v6h-6"/>',
  subindo: '<path d="M3 17l6-6 4 4 8-8"/><path d="M21 13V7h-6"/>',
  espelho: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9zM9 11h6M9 15h6"/>',
  historico: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  pasta: '<path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  suporte: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><path d="M4 14h3v5H5a1 1 0 0 1-1-1zM20 14h-3v5h2a1 1 0 0 0 1-1z"/>',
  pedido: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  sino: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  cadeado: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  escudo: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  sair: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  calendario: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  documento: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
  local: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  whatsapp: '<path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 1c-1-.5-2-1.5-2.5-2.5l1-1-1-2z"/>',
  telefone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  instalar: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M12 7v7M9 11l3 3 3-3M10 18h4"/>',
  painel: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
};
const icone = (nome) => `<svg viewBox="0 0 24 24" aria-hidden="true">${I[nome]}</svg>`;
const iconeBatida = (tipo) => (tipo.startsWith("Saída pausa") ? "pausa" : tipo.startsWith("Retorno") ? "retorno" : tipo.startsWith("Saída") ? "saida" : "entrada");
const classeBatida = (tipo) => (tipo.startsWith("Saída pausa") || tipo.startsWith("Retorno") ? "pausa" : tipo.startsWith("Saída") ? "saida" : "entrada");

$("marca-icone").innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="#fff" stroke-width="2.5"><circle cx="24" cy="24" r="21"/><path d="M24 13v11l7 4" stroke-linecap="round"/></svg>`;

// ---------- Navegação ----------
const TELAS = {
  inicio: [null, null, telaInicio],
  bater: ["Bater ponto", "Registre sua entrada ou saída", telaBater],
  espelho: ["Espelho de Ponto", "Visualize seu espelho detalhado", telaEspelho],
  historico: ["Histórico e Justificativas", "Veja seu histórico de ponto e envie justificativas", telaHistorico],
  arquivos: ["Arquivos Recebidos", "Contracheques, folhas de ponto e documentos", telaArquivos],
  suporte: ["Suporte", "Fale com o RH da sua empresa", telaSuporte],
  menu: ["Menu", null, telaMenu],
  pedidos: ["Pedidos e Justificativas", "Esqueceu de marcar ou teve atestado?", telaPedidos],
  notificacoes: ["Notificações", null, telaNotificacoes],
};
const APELIDOS = { ajuste: "pedidos", assinar: "arquivos", "": "inicio" };

async function navegar() {
  let nome = location.hash.slice(1);
  nome = APELIDOS[nome] ?? nome;
  if (!TELAS[nome]) nome = "inicio";
  const [titulo, subtitulo, fn] = TELAS[nome];
  const naHome = nome === "inicio";
  $("perfil").classList.toggle("oculto", !naHome);
  $("cabeca").classList.toggle("compacto", !naHome);
  $("cabeca-titulo").classList.toggle("oculto", naHome);
  $("titulo").textContent = titulo ?? "";
  $("subtitulo").textContent = subtitulo ?? "";
  $("subtitulo").classList.toggle("oculto", !subtitulo);
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("ativo", a.dataset.nav === nome));
  const bater = nome === "bater";
  $("tela-bater").classList.toggle("oculto", !bater);
  tela.classList.toggle("oculto", bater);
  tela.classList.toggle("subir", !naHome);
  $("tela-bater").classList.toggle("subir", bater);
  if (!bater) pararCamera();
  window.scrollTo(0, 0);
  if (!bater) tela.innerHTML = `<p class="muted" style="text-align:center">Carregando…</p>`;
  try {
    await fn();
  } catch (err) {
    tela.innerHTML = `<p class="alerta">${esc(err.message)}</p>`;
  }
}
addEventListener("hashchange", navegar);

// ---------- Topo: logo, foto, sininho ----------
async function carregarTopo() {
  const i = inicio;
  $("nome").textContent = i.funcionario.nome;
  $("cargo").textContent = i.funcionario.cargo ?? i.funcionario.lotacao ?? i.empresa.nome;
  $("logo-empresa").textContent = iniciais(i.empresa.nome);
  $("logo-empresa").title = i.empresa.nome;
  $("avatar").textContent = iniciais(i.funcionario.nome);
  if (i.empresa.temLogo) blobAutenticado("/api/ponto/logo").then((u) => ($("logo-empresa").innerHTML = `<img src="${u}" alt="${esc(i.empresa.nome)}">`), () => {});
  if (i.funcionario.temFoto) blobAutenticado("/api/ponto/foto").then((u) => ($("avatar").innerHTML = `<img src="${u}" alt="">`), () => {});
}

const INSTALAR_DISPENSADO = "ponto-instalar-dispensado";
quandoMudar(() => {
  const nome = location.hash.slice(1) || "inicio";
  if (nome === "inicio" || nome === "menu") navegar();
});
function ligarInstalar() {
  $("btn-instalar")?.addEventListener("click", () => instalarApp(modal));
  $("dispensar-instalar")?.addEventListener("click", () => {
    try { localStorage.setItem(INSTALAR_DISPENSADO, "1"); } catch {}
    document.querySelector(".convite-instalar")?.remove();
  });
}

async function atualizarSino() {
  const r = await api("GET", "/api/notificacoes").catch(() => null);
  if (!r) return;
  $("sino-contador").textContent = r.naoLidas > 9 ? "9+" : r.naoLidas;
  $("sino-contador").classList.toggle("oculto", !r.naoLidas);
}
$("btn-sino").onclick = () => (location.hash = "notificacoes");

// ---------- Home ----------
async function carregarInicio() {
  inicio = await api("GET", "/api/ponto/inicio");
  return inicio;
}

async function telaInicio() {
  const i = await carregarInicio();
  carregarTopo();
  const p = i.proximo;
  const ultimos = i.ultimosRegistros.length
    ? i.ultimosRegistros.map((r) => `<div class="cartao registro">
        <div class="registro-icone ${classeBatida(r.tipo)}">${icone(iconeBatida(r.tipo))}</div>
        <div><small>${esc(r.tipo)}</small><strong>${r.hora}</strong><span>${dataBr(r.data)}</span></div></div>`).join("")
    : `<div class="cartao" style="grid-column:1/-1"><span class="muted">Você ainda não tem registros.</span></div>`;
  const progresso = Array.from({ length: Math.max(p.total, p.feitas) }, (_, k) =>
    (k ? `<b class="${k < p.feitas ? "feito" : ""}"></b>` : "") + `<i class="${k < p.feitas ? "feito" : ""}"></i>`).join("");
  const concluido = p.feitas >= p.total && p.feitas % 2 === 0;

  // Informativos: comunicados + atalhos automáticos (documentos para assinar, justificativas)
  const pend = i.pendentes.documentos + i.pendentes.assinaturas;
  const cards = [
    ...(pend ? [`<a class="informativo inf-roxo" href="#arquivos"><span>${pend} pendente(s)</span><strong>Documentos para assinar</strong></a>`] : []),
    ...i.comunicados.map((c) => `<button class="informativo inf-${c.cor} ${c.lido ? "" : "nao-lido"} ${c.temImagem ? "com-imagem" : ""}" data-comunicado="${c.id}">
        <span>${new Date(c.criadoEm).toLocaleDateString("pt-BR")}</span><strong>${esc(c.titulo)}</strong></button>`),
    `<a class="informativo inf-laranja" href="#pedidos"><span>Esqueceu de marcar? Teve atestado?</span><strong>Justificativas</strong></a>`,
  ];

  // Convite para instalar o app (some depois de instalado ou se a pessoa dispensar)
  let dispensado = false;
  try { dispensado = localStorage.getItem(INSTALAR_DISPENSADO) === "1"; } catch {}
  const podeInstalar = ["CONVITE", "IOS", "ANDROID"].includes(estadoInstalacao()) && !dispensado;

  const b = i.banco;
  const maxBarra = Math.max(60, ...i.semana.dias.map((d) => Math.max(d.previstoMin, d.trabalhadoMin)));
  tela.innerHTML = `
    ${podeInstalar ? `<div class="cartao convite-instalar">
      <div class="convite-icone"><img src="/icon-192.png" alt=""></div>
      <div><strong>Instale o app no celular</strong><span>Abra o ponto com um toque, direto da tela inicial.</span></div>
      <button class="primary" id="btn-instalar">Instalar</button>
      <button class="convite-fechar" id="dispensar-instalar" aria-label="Agora não">×</button>
    </div>` : ""}
    <div class="secao-titulo"><h2>Últimos registros</h2><a href="#historico">ver todos</a></div>
    <div class="ultimos">${ultimos}</div>

    <div class="proximo">
      <div class="proximo-topo"><span class="selo">PRÓXIMO REGISTRO</span><span class="proximo-relogio" id="relogio-home"></span></div>
      <div class="proximo-tipo"><div class="circulo">${icone(concluido ? "relogio" : iconeBatida(p.tipo))}</div>
        <div><strong>${concluido ? "JORNADA CONCLUÍDA" : esc(p.tipo.toUpperCase())}</strong>
          <span>${concluido ? "Bom descanso!" : `${icone("relogio").replace("<svg", '<svg style="width:16px;height:16px;vertical-align:-3px"')} às ${p.previsto ?? "--:--"}`}</span></div></div>
      <div class="progresso">${progresso}</div>
      <div style="opacity:.85">${concluido ? `${p.feitas} batidas hoje` : p.semJornadaHoje && !p.feitas ? "Hoje não há jornada prevista" : `Aguardando ${p.feitas + 1}ª batida`}</div>
      <button class="acao" onclick="location.hash='bater'">☝ Bater ponto agora</button>
    </div>

    <div class="secao-titulo"><h2>Informativos</h2></div>
    <div class="carrossel">${cards.join("")}</div>

    ${b ? `<div class="cartao">
      <div class="banco-topo"><div class="banco-icone ${b.mesMin < 0 ? "negativo" : "positivo"}" style="background:${b.mesMin < 0 ? "#fde8e8" : "#e3f5ec"}">${icone(b.mesMin < 0 ? "descendo" : "subindo")}</div>
        <div><strong style="font-size:18px">${b.ativo ? "Banco de horas" : "Horas do mês"}</strong><div class="muted small">Competência: ${mesCurto(b.competencia)}</div></div></div>
      <div class="banco-valor ${b.mesMin < 0 ? "negativo" : "positivo"}">${saldo(b.mesMin)}<small>horas no mês</small></div>
      ${b.ativo ? `<span class="pilula">↪ Acumulado: ${saldo(b.acumuladoMin)}</span>` : ""}
      <div class="legenda"><span class="c">Crédito: <b>${hm(b.creditoMin)}</b></span><span class="d">Débito: <b>${hm(b.debitoMin)}</b></span></div>
    </div>` : ""}

    <div class="cartao">
      <div class="semana-topo"><div><strong style="font-size:18px">Sua semana</strong><div class="muted">${horasTexto(i.semana.totalMin)} trabalhadas</div></div>
        ${i.semana.metaMin ? `<div class="meta">META<b>${Math.round(i.semana.metaMin / 60)}h</b></div>` : ""}</div>
      <div class="barras">${i.semana.dias.map((d) => `<div class="barra-dia ${d.hoje ? "hoje" : ""}" title="${DIAS[new Date(d.dia + "T12:00:00Z").getUTCDay()]}: ${hm(d.trabalhadoMin)} trabalhadas${d.previstoMin ? ` de ${hm(d.previstoMin)}` : ""}">
          <i style="height:${(d.trabalhadoMin / maxBarra) * 100}%"></i></div>`).join("")}</div>
      <div class="rotulos-dias">${i.semana.dias.map((d) => `<span class="${d.hoje ? "hoje" : ""}">${DIAS[new Date(d.dia + "T12:00:00Z").getUTCDay()].toUpperCase()}</span>`).join("")}</div>
    </div>

    <div class="secao-titulo"><h2>Atalhos rápidos</h2></div>
    <div class="atalhos">
      <a class="atalho" href="#espelho"><span class="at-azul">${icone("espelho")}</span>Espelho</a>
      <a class="atalho" href="#historico"><span class="at-roxo">${icone("historico")}</span>Histórico</a>
      <a class="atalho" href="#arquivos"><span class="at-verde">${icone("pasta")}</span>Arquivos</a>
      <a class="atalho" href="#suporte"><span class="at-laranja">${icone("suporte")}</span>Suporte</a>
    </div>`;

  // Imagem de fundo dos comunicados que têm imagem
  for (const c of i.comunicados.filter((x) => x.temImagem)) {
    blobAutenticado(`/api/ponto/comunicados/${c.id}/imagem`).then((u) => {
      const el = tela.querySelector(`[data-comunicado="${c.id}"]`);
      if (el) el.style.backgroundImage = `linear-gradient(transparent 30%, rgb(0 0 0 / 55%)), url("${u}")`;
    }, () => {});
  }
  tela.querySelectorAll("[data-comunicado]").forEach((el) => (el.onclick = () => abrirComunicado(i.comunicados.find((c) => c.id === el.dataset.comunicado))));
  ligarInstalar();
  relogioHome();

  // Comunicado importante ainda não lido abre sozinho
  const popup = i.comunicados.find((c) => c.popup && !c.lido);
  if (popup && !modal.open && !dia?.consentimentoPendente) abrirComunicado(popup);
}

function relogioHome() {
  const el = $("relogio-home");
  if (el) el.textContent = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
setInterval(relogioHome, 15_000);

async function abrirComunicado(c) {
  modal.innerHTML = `${c.temImagem ? `<img class="comunicado-img oculto" id="img-comunicado" alt="">` : ""}
    <h2>${esc(c.titulo)}</h2>
    <div class="comunicado-texto">${esc(c.texto)}</div>
    <div class="acoes" style="margin-top:16px"><button class="primary" id="fechar-modal">Entendi</button></div>`;
  modal.showModal();
  $("fechar-modal").onclick = () => modal.close();
  if (c.temImagem) {
    blobAutenticado(`/api/ponto/comunicados/${c.id}/imagem`).then((u) => {
      const img = $("img-comunicado");
      if (img) { img.src = u; img.classList.remove("oculto"); }
    }, () => {});
  }
  if (!c.lido) {
    c.lido = true;
    api("POST", `/api/ponto/comunicados/${c.id}/lido`).catch(() => {});
    tela.querySelector(`[data-comunicado="${c.id}"]`)?.classList.remove("nao-lido");
  }
}

// ---------- Bater ponto ----------
function tique() {
  const agora = new Date();
  $("hora").textContent = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  $("data").textContent = agora.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
}
tique();
setInterval(tique, 1000);

async function telaBater() {
  await carregarHoje();
  $("camera").classList.toggle("oculto", !precisaCamera());
  if (precisaCamera() && !stream) ligarCamera();
  atualizarStatus();
}

function atualizarStatus() {
  const itens = [];
  if (config.exigeGps) {
    itens.push(posicao
      ? `<span class="tag ok">Localização ok (±${Math.round(posicao.precisao)} m)</span>`
      : `<span class="tag warn">Aguardando localização…</span>`);
  }
  if (precisaCamera()) itens.push(stream ? `<span class="tag ok">Câmera ok</span>` : `<span class="tag warn">Câmera desligada</span>`);
  if (config.exigeFacial) {
    itens.push(modelosProntos ? `<span class="tag ok">Reconhecimento facial pronto</span>` : `<span class="tag warn">Preparando reconhecimento facial…</span>`);
  }
  itens.push(navigator.onLine ? `<span class="tag ok">Online</span>` : `<span class="tag warn">Offline: a marcação será enviada depois</span>`);
  const pendentes = lerFila().length;
  if (pendentes) itens.push(`<span class="tag info">${pendentes} marcação(ões) aguardando envio</span>`);
  $("status").innerHTML = itens.join("");
  const proxima = inicio?.proximo?.tipo ?? ((dia?.marcacoes.length ?? 0) % 2 === 0 ? "Entrada" : "Saída");
  $("registrar").textContent = `Registrar ${proxima.toLowerCase()}`;
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
  $("camera").classList.remove("oculto");
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

// Desliga a câmera fora da tela de ponto (bateria e privacidade)
function pararCamera() {
  if (!stream) return;
  stream.getTracks().forEach((t) => t.stop());
  stream = null;
  const guiaEl = $("guia");
  $("camera").replaceChildren(Object.assign(document.createElement("span"), { className: "muted small", textContent: "Câmera desligada" }), guiaEl);
}

function ligarGps() {
  if (!config.exigeGps || !navigator.geolocation) return;
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
  canvas.width = 480;
  canvas.height = Math.round((video.videoHeight / video.videoWidth) * 480) || 360;
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
    return { desafioId, quadros: await executarDesafio($("camera").querySelector("video"), passos, guia) };
  } finally {
    guia(null);
  }
}

function mostrarMsg(texto, tipo = "") {
  const el = $("msg");
  el.className = `alerta ${tipo}`;
  el.textContent = texto;
}

async function carregarHoje() {
  try {
    dia = await api("GET", "/api/ponto/hoje");
    config = dia.funcionario;
    $("marcas").innerHTML = dia.marcacoes.length
      ? dia.marcacoes.map((m, i) => `<button class="tag ${i % 2 ? "" : "info"}" data-comp="${m.id}">${i % 2 ? "Saída" : "Entrada"} ${m.hora}</button>`).join("")
      : `<span class="muted">Nenhuma ainda</span>`;
    $("marcas").querySelectorAll("[data-comp]").forEach((b) => (b.onclick = () => verComprovante(b.dataset.comp)));
    if (dia.consentimentoPendente) mostrarTermo();
  } catch (err) {
    if (err.status) mostrarMsg(err.message);
  }
}

async function mostrarTermo() {
  const t = await api("GET", "/api/ponto/termo");
  modal.innerHTML = `<h2>Uso dos seus dados</h2>
    ${t.paragrafos.map((p) => `<p class="small" style="margin:0 0 8px">${esc(p)}</p>`).join("")}
    <div class="acoes" style="margin-top:16px"><button class="primary" id="aceitar">Li e estou ciente</button></div>`;
  if (!modal.open) modal.showModal();
  modal.oncancel = (e) => e.preventDefault(); // não fecha sem aceitar
  $("aceitar").onclick = async () => {
    await api("POST", "/api/ponto/consentimento", { versao: t.versao });
    dia.consentimentoPendente = false;
    modal.oncancel = null;
    modal.close();
    atualizarStatus();
  };
}

// Fila de marcações feitas sem internet
function lerFila() {
  try { return JSON.parse(localStorage.getItem(FILA) ?? "[]"); } catch { return []; }
}
function salvarFila(f) {
  try { localStorage.setItem(FILA, JSON.stringify(f)); } catch {}
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
    await Promise.all([carregarHoje(), carregarInicio().catch(() => null)]);
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

async function verComprovante(id) {
  mostrarComprovante(await api("GET", `/api/ponto/comprovante/${id}`), false);
}

function mostrarComprovante(c, recemRegistrado = true) {
  modal.innerHTML = `<h2>${recemRegistrado ? "Ponto registrado" : "Comprovante"}</h2>
    <p class="alerta ok" style="font-size:22px;text-align:center"><strong>${c.dataHora.slice(11, 16)}</strong></p>
    <table class="small"><tbody>
      <tr><td class="muted">Empregador</td><td>${esc(c.empregador)}<br>CNPJ ${c.cnpj}</td></tr>
      <tr><td class="muted">Trabalhador</td><td>${esc(c.trabalhador)}<br>CPF ${c.cpf}</td></tr>
      <tr><td class="muted">Data e hora</td><td class="tnum">${dataBr(c.dataHora.slice(0, 10))} ${c.dataHora.slice(11, 19)}</td></tr>
      <tr><td class="muted">NSR</td><td class="tnum">${c.nsr}</td></tr>
      <tr><td class="muted">Código</td><td class="mono">${c.hash}</td></tr>
    </tbody></table>
    <div class="acoes" style="margin-top:16px"><button class="primary" id="fechar-modal">Ok</button><button id="pdf-comp">Baixar PDF</button></div>`;
  modal.showModal();
  $("fechar-modal").onclick = () => modal.close();
  $("pdf-comp").onclick = async () => {
    try {
      const url = await blobAutenticado(`/api/ponto/comprovante/${c.id}/pdf`);
      Object.assign(document.createElement("a"), { href: url, download: `comprovante-ponto-${c.nsr}.pdf` }).click();
    } catch {
      alert("Não foi possível gerar o PDF");
    }
  };
}

// ---------- Espelho ----------
let mesEspelho = mesAtual();
const ultimosMeses = (n) => Array.from({ length: n }, (_, k) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - k);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
});

async function telaEspelho() {
  const e = await api("GET", `/api/ponto/espelho?mes=${mesEspelho}`);
  const percentuais = (e.regras?.percentuais ?? Object.keys(e.totais.extras ?? {})).slice(0, 3);
  const corSaldo = (v) => (v < 0 ? "negativo" : v > 0 ? "positivo" : "");
  const dias = [...e.dias].reverse().filter((d) => d.marcacoes.length || d.previstoMin || d.afastamento || d.feriado);
  tela.innerHTML = `
    <div class="resumo-espelho">
      <div><small>Período</small><select id="mes-espelho">${ultimosMeses(12).map((m) => `<option value="${m}" ${m === mesEspelho ? "selected" : ""}>${mesCurto(m)}</option>`).join("")}</select></div>
      <div><small>Acumulado</small><strong class="${corSaldo(e.totais.bancoAcumuladoMin)}">${e.regras?.bancoHoras === false ? "—" : saldo(e.totais.bancoAcumuladoMin)}</strong></div>
      <div><small>Mês total</small><strong class="${corSaldo(e.totais.saldoBancoMin)}">${saldo(e.totais.saldoBancoMin)}</strong></div>
    </div>
    ${e.fechamento ? `<p class="alerta ${e.fechamento.assinatura === "ASSINADO" ? "ok" : "warn"} small" style="margin:0">Mês fechado pelo RH. ${e.fechamento.assinatura === "PENDENTE" ? '<a href="#arquivos">Assinar a folha de ponto</a>' : ""}</p>` : ""}
    ${dias.length ? dias.map((d) => {
      const linhas = [];
      for (let k = 0; k < Math.max(4, d.marcacoes.length); k += 4) linhas.push(d.marcacoes.slice(k, k + 4));
      const banco = d.extraMin - d.debitoMin;
      const semMarcacao = !d.marcacoes.length;
      const motivo = d.afastamento ? NOME_AFASTAMENTO[d.afastamento] : d.feriado ? d.feriado : d.ocorrencias.includes("FALTA") ? "Falta" : "Sem marcações";
      return `<div class="cartao">
        <div class="dia-topo"><span class="tag">${DIAS[new Date(d.data + "T12:00:00Z").getUTCDay()].toUpperCase()}</span><strong>${dataBr(d.data)}</strong>
          <span style="margin-left:auto">${tagsOcorrencias(d.ocorrencias.filter((o) => o !== "FALTA"))}</span></div>
        ${semMarcacao ? `<p class="${d.ocorrencias.includes("FALTA") ? "negativo" : "muted"}" style="margin:0">${esc(motivo)}</p>` : linhas.map((l, k) => `<div class="grade-batidas" ${k ? 'style="margin-top:8px"' : ""}>
          ${[0, 1, 2, 3].map((j) => `<div><small>${j % 2 ? "SAÍDA" : "ENTRADA"} ${k / 2 + Math.floor(j / 2) + 1}</small><b>${l[j] ? `${l[j].hora}${l[j].incluida ? "*" : ""}` : "—"}</b></div>`).join("")}
        </div>`).join("")}
        <div class="grade-totais">
          <div><small>Banco</small><b class="${corSaldo(banco)}">${banco ? saldo(banco) : "00:00"}</b></div>
          ${[0, 1, 2].map((k) => `<div><small>${percentuais[k] ? `Extra ${percentuais[k]}%` : `Extras ${k + 1}`}</small><b>${percentuais[k] && d.extras[percentuais[k]] ? hm(d.extras[percentuais[k]]) : percentuais[k] ? "00:00" : "—"}</b></div>`).join("")}
        </div>
      </div>`;
    }).join("") : '<div class="cartao"><p class="muted" style="margin:0">Nenhum dia com jornada neste mês.</p></div>'}
    <p class="muted small" style="text-align:center">* marcação incluída por ajuste do RH</p>`;
  $("mes-espelho").onchange = (ev) => { mesEspelho = ev.target.value; telaEspelho(); };
}

// ---------- Histórico com fotos ----------
let mesHistorico = mesAtual();
function mudarMes(mes, delta) {
  const d = new Date(mes + "-15T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 7);
}

async function telaHistorico() {
  const lista = await api("GET", `/api/ponto/historico?mes=${mesHistorico}`);
  const { inicio: ini, fim } = { inicio: `${mesHistorico}-01`, fim: new Date(Date.UTC(+mesHistorico.slice(0, 4), +mesHistorico.slice(5), 0)).toISOString().slice(0, 10) };
  tela.innerHTML = `
    <div class="cartao navegador-mes"><button id="mes-ant" aria-label="Mês anterior">‹</button>
      <div><small>Período</small><strong>${dataBr(ini)} à ${dataBr(fim)}</strong></div>
      <button id="mes-prox" aria-label="Próximo mês" ${mesHistorico >= mesAtual() ? "disabled" : ""}>›</button></div>
    ${lista.length ? lista.map((d) => `<div class="cartao linha-historico">
        <div class="quando"><small>${DIAS[new Date(d.dia + "T12:00:00Z").getUTCDay()].toUpperCase()}</small><b>${dataBr(d.dia).slice(0, 5)}</b></div>
        <div class="fotos">${d.marcacoes.map((m) => `<button class="foto-batida" data-comp="${m.id}" title="${esc(m.tipo)}">
            <small>${m.rotulo}</small><span class="mini" ${m.temFoto ? `data-selfie="${m.id}"` : ""}>${m.temFoto ? "" : icone(iconeBatida(m.tipo)).replace("<svg", '<svg style="width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2"')}</span><b>${m.hora}</b></button>`).join("")}</div>
        <button class="mais" data-dia="${d.dia}" aria-label="Opções do dia">⋮</button></div>`).join("")
      : '<div class="cartao"><p class="muted" style="margin:0">Nenhuma marcação neste mês.</p></div>'}`;
  $("mes-ant").onclick = () => { mesHistorico = mudarMes(mesHistorico, -1); telaHistorico(); };
  $("mes-prox").onclick = () => { mesHistorico = mudarMes(mesHistorico, 1); telaHistorico(); };
  tela.querySelectorAll("[data-comp]").forEach((b) => (b.onclick = () => verComprovante(b.dataset.comp)));
  tela.querySelectorAll("[data-dia]").forEach((b) => (b.onclick = () => opcoesDia(b.dataset.dia)));
  // Fotos carregam só quando aparecem na tela
  const obs = new IntersectionObserver((itens) => {
    for (const it of itens) {
      if (!it.isIntersecting) continue;
      obs.unobserve(it.target);
      blobAutenticado(`/api/ponto/marcacoes/${it.target.dataset.selfie}/selfie`).then((u) => (it.target.innerHTML = `<img src="${u}" alt="">`), () => {});
    }
  });
  tela.querySelectorAll("[data-selfie]").forEach((el) => obs.observe(el));
}

function opcoesDia(dataDia) {
  modal.innerHTML = `<h2>${dataBr(dataDia)}</h2>
    <div class="menu-lista" style="padding:0">
      <button id="op-justificar">${icone("pedido")}Justificar ou pedir ajuste deste dia</button>
      <button id="op-atestado">${icone("documento")}Enviar atestado deste dia</button>
    </div>
    <div class="acoes" style="margin-top:12px"><button id="fechar-modal">Fechar</button></div>`;
  modal.showModal();
  $("fechar-modal").onclick = () => modal.close();
  const ir = (tipo) => {
    try { sessionStorage.setItem("pedido-prefill", JSON.stringify({ data: dataDia, tipo })); } catch {}
    modal.close();
    location.hash = "pedidos";
  };
  $("op-justificar").onclick = () => ir("INCLUSAO");
  $("op-atestado").onclick = () => ir("ATESTADO");
}

// ---------- Arquivos ----------
const filtroArq = { competencia: "", tipo: "" };
const SITUACAO_ARQ = { ASSINADO: ["ASSINADO", ""], PENDENTE: ["ASSINAR", "pendente"], VISUALIZADO: ["VISUALIZADO", "visto"], CONTESTADO: ["CONTESTADO", "pendente"] };

async function telaArquivos() {
  const lista = await api("GET", "/api/ponto/arquivos");
  $("subtitulo").textContent = `${lista.length} ${lista.length === 1 ? "item" : "itens"}`;
  const competencias = [...new Set(lista.map((a) => a.competencia))];
  const tipos = [...new Map(lista.map((a) => [a.tipo, a.nomeTipo])).entries()];
  const visiveis = lista.filter((a) => (!filtroArq.competencia || a.competencia === filtroArq.competencia) && (!filtroArq.tipo || a.tipo === filtroArq.tipo));
  tela.innerHTML = `
    <div class="filtros">
      <label><span class="muted small">Período</span><select id="f-comp"><option value="">[ TODOS ]</option>${competencias.map((c) => `<option value="${c}" ${c === filtroArq.competencia ? "selected" : ""}>${c.split("-").reverse().join("/")}</option>`).join("")}</select></label>
      <label><span class="muted small">Tipo de arquivo</span><select id="f-tipo"><option value="">[ TODOS ]</option>${tipos.map(([v, n]) => `<option value="${v}" ${v === filtroArq.tipo ? "selected" : ""}>${esc(n.toUpperCase())}</option>`).join("")}</select></label>
    </div>
    ${visiveis.length ? visiveis.map((a) => {
      const [txt, cls] = a.status === "PENDENTE" && !a.exigeAssinatura ? ["NOVO", "visto"] : SITUACAO_ARQ[a.status] ?? [a.status, ""];
      return `<div class="cartao arquivo" data-arquivo="${a.origem}:${a.id}" role="button" tabindex="0">
        <span class="faixa ${cls === "pendente" ? "pendente" : ""}"></span>
        <div>
          <div class="linha"><span class="codigo"># ${a.codigo}</span><span class="situacao ${cls}">${txt}</span></div>
          <div class="linha">${icone("calendario")}<strong>${a.competencia.split("-").reverse().join("/")}</strong></div>
          <div class="linha">${icone("documento")}<span>${esc(a.nomeTipo.toUpperCase())}</span></div>
          ${a.lotacao ? `<div class="linha">${icone("local")}<span>${esc(a.lotacao.toUpperCase())}</span></div>` : ""}
        </div>
        <span class="mais">⋮</span></div>`;
    }).join("") : '<div class="cartao"><p class="muted" style="margin:0">Nenhum arquivo por aqui ainda.</p></div>'}`;
  $("f-comp").onchange = (e) => { filtroArq.competencia = e.target.value; telaArquivos(); };
  $("f-tipo").onchange = (e) => { filtroArq.tipo = e.target.value; telaArquivos(); };
  tela.querySelectorAll("[data-arquivo]").forEach((el) => (el.onclick = () => {
    const [origemArq, id] = el.dataset.arquivo.split(":");
    const a = lista.find((x) => x.id === id);
    if (origemArq === "FOLHA_PONTO") abrirAssinatura(id);
    else abrirDocumento(a);
  }));
}

async function abrirDocumento(a) {
  const precisaAssinar = a.exigeAssinatura && a.status !== "ASSINADO";
  modal.innerHTML = `<h2>${esc(a.nomeTipo)}</h2>
    <p class="muted">Referência ${a.competencia.split("-").reverse().join("/")}${a.status === "ASSINADO" ? ` · assinado em ${new Date(a.data).toLocaleString("pt-BR")}` : ""}</p>
    <button id="abrir-doc" style="width:100%;margin-bottom:12px">${icone("documento").replace("<svg", '<svg style="width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2"')} Abrir o documento</button>
    ${precisaAssinar ? `<form id="form-assinar-doc">
      <p class="small">Depois de conferir, confirme com a sua senha para assinar eletronicamente.</p>
      <label>Sua senha<input name="senha" type="password" autocomplete="current-password" required></label>
      <p class="alerta oculto" id="erro-doc"></p>
      <div class="acoes"><button class="primary">Assinar</button><button type="button" id="fechar-modal">Fechar</button></div></form>`
      : `<div class="acoes"><button id="fechar-modal">Fechar</button></div>`}`;
  modal.showModal();
  $("fechar-modal").onclick = () => modal.close();
  $("abrir-doc").onclick = async () => {
    try {
      const url = await blobAutenticado(`/api/ponto/documentos/${a.id}/arquivo`);
      window.open(url, "_blank") ?? (location.href = url);
    } catch (e) {
      alert(e.message);
    }
  };
  const form = $("form-assinar-doc");
  if (form) {
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      try {
        await api("POST", `/api/ponto/documentos/${a.id}/assinar`, { senha: form.senha.value });
        modal.close();
        telaArquivos();
      } catch (err) {
        $("erro-doc").textContent = err.message;
        $("erro-doc").classList.remove("oculto");
      }
    };
  }
}

async function abrirAssinatura(id) {
  const e = await api("GET", `/api/ponto/assinaturas/${id}`);
  const a = e.assinatura;
  modal.innerHTML = `<h2>Folha de ponto ${dataBr(e.periodo.inicio)} a ${dataBr(e.periodo.fim)}</h2>
    <div style="max-height:50vh;overflow:auto">${tabelaEspelho(e)}</div>
    ${a.status === "PENDENTE" ? `<form id="form-assinar" style="margin-top:12px">
        <label id="campo-senha-ass">Confirme com a sua senha para assinar<input name="senha" type="password" autocomplete="current-password"></label>
        <label id="campo-contestar" class="oculto">O que está errado?<input name="observacao"></label>
        <p class="alerta oculto" id="erro-assinar"></p>
        <div class="acoes"><button class="primary">Assinar</button>
          <button type="button" id="contestar">Contestar</button><button type="button" id="fechar-modal">Fechar</button></div>
      </form>`
      : `<p class="alerta ${a.status === "ASSINADO" ? "ok" : "warn"} small" style="margin-top:12px">${a.status === "ASSINADO" ? "Assinado" : "Contestado"} em ${new Date(a.assinadoEm).toLocaleString("pt-BR")}.</p>
        <div class="acoes"><a class="btn" href="/espelho-assinado?id=${a.id}" target="_blank">Imprimir</a><button type="button" id="fechar-modal">Fechar</button></div>`}`;
  modal.showModal();
  $("fechar-modal").onclick = () => modal.close();
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
      modal.close();
      telaArquivos();
    } catch (err) {
      $("erro-assinar").textContent = err.message;
      $("erro-assinar").classList.remove("oculto");
    }
  };
}

// ---------- Suporte ----------
async function telaSuporte() {
  const s = await api("GET", "/api/ponto/suporte");
  const digitos = (s.whatsapp ?? "").replace(/\D/g, "");
  const wa = digitos ? `https://wa.me/${digitos.length <= 11 ? "55" + digitos : digitos}` : null;
  const contato = (href, cor, ic, titulo, texto) => `<a class="cartao contato" href="${href}" ${href.startsWith("http") ? 'target="_blank" rel="noopener"' : ""}>
      <span class="${cor}">${icone(ic)}</span><div><strong>${titulo}</strong><div class="muted">${esc(texto)}</div></div></a>`;
  const algum = wa || s.telefone || s.email;
  tela.innerHTML = `
    ${wa ? contato(wa, "at-verde", "whatsapp", "WhatsApp do RH", s.whatsapp) : ""}
    ${s.telefone ? contato(`tel:${s.telefone.replace(/[^\d+]/g, "")}`, "at-azul", "telefone", "Telefone", s.telefone) : ""}
    ${s.email ? contato(`mailto:${s.email}`, "at-roxo", "email", "E-mail", s.email) : ""}
    ${s.horario ? `<p class="muted small" style="text-align:center;margin:0">Atendimento: ${esc(s.horario)}</p>` : ""}
    ${algum ? "" : `<div class="cartao"><p class="muted" style="margin:0">A ${esc(s.empresa)} ainda não cadastrou os contatos do RH. Use a mensagem abaixo.</p></div>`}
    <form class="cartao" id="form-mensagem">
      <h3>Mensagem para o RH</h3>
      <label>Escreva sua dúvida ou pedido<textarea name="texto" rows="4" required></textarea></label>
      <p class="alerta oculto" id="msg-suporte"></p>
      <button class="primary botao-grande">Enviar</button>
    </form>`;
  const form = $("form-mensagem");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const el = $("msg-suporte");
    try {
      await api("POST", "/api/ponto/mensagem", { texto: form.texto.value });
      form.reset();
      el.className = "alerta ok";
      el.textContent = "Mensagem enviada ao RH.";
    } catch (err) {
      el.className = "alerta";
      el.textContent = err.message;
    }
  };
}

// ---------- Menu ----------
async function telaMenu() {
  const [push, eu] = await Promise.all([estadoPush(), api("GET", "/api/auth/eu")]);
  tela.innerHTML = `<div class="cartao menu-lista">
      ${eu.papel !== "FUNCIONARIO" ? `<a href="/admin">${icone("painel")}<strong>Painel do ${eu.papel === "ADMIN" ? "RH" : "gestor"}</strong></a>` : ""}
      <a href="#espelho">${icone("espelho")}Espelho de ponto</a>
      <a href="#historico">${icone("historico")}Histórico e justificativas</a>
      <a href="#pedidos">${icone("pedido")}Meus pedidos e atestados</a>
      <a href="#arquivos">${icone("pasta")}Arquivos</a>
      <a href="#notificacoes">${icone("sino")}Notificações</a>
      ${estadoInstalacao() !== "INSTALADO" && estadoInstalacao() !== "INDISPONIVEL" ? `<button id="m-instalar">${icone("instalar")}Instalar o app no celular</button>` : ""}
      ${push === "INATIVO" ? `<button id="m-push">${icone("sino")}Ativar avisos no celular</button>` : ""}
      <button id="m-senha">${icone("cadeado")}Trocar senha</button>
      <button id="m-termo">${icone("escudo")}Privacidade e uso dos dados</button>
      <button id="m-sair">${icone("sair")}Sair</button>
    </div>
    <p class="muted small" style="text-align:center">${esc(inicio?.empresa?.nome ?? "")}</p>`;
  $("m-sair").onclick = sair;
  $("m-instalar")?.addEventListener("click", () => instalarApp(modal));
  $("m-termo").onclick = async () => {
    const t = await api("GET", "/api/ponto/termo");
    modal.innerHTML = `<h2>Uso dos seus dados</h2>${t.paragrafos.map((p) => `<p class="small" style="margin:0 0 8px">${esc(p)}</p>`).join("")}
      <div class="acoes"><button id="fechar-modal">Fechar</button></div>`;
    modal.showModal();
    $("fechar-modal").onclick = () => modal.close();
  };
  $("m-push")?.addEventListener("click", async () => {
    try {
      await ativarPush();
      telaMenu();
    } catch (err) {
      alert(err.message);
    }
  });
  $("m-senha").onclick = () => {
    modal.innerHTML = `<form><h2>Trocar senha</h2>
      <label>Senha atual<input name="atual" type="password" autocomplete="current-password" required></label>
      <label>Nova senha (mínimo 8 caracteres)<input name="nova" type="password" minlength="8" autocomplete="new-password" required></label>
      <p class="alerta oculto" id="erro-senha"></p>
      <div class="acoes"><button class="primary">Salvar</button><button type="button" id="fechar-modal">Cancelar</button></div></form>`;
    modal.showModal();
    $("fechar-modal").onclick = () => modal.close();
    const f = modal.querySelector("form");
    f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api("POST", "/api/auth/senha", { atual: f.atual.value, nova: f.nova.value });
        modal.close();
        alert("Senha alterada.");
      } catch (err) {
        $("erro-senha").textContent = err.message;
        $("erro-senha").classList.remove("oculto");
      }
    };
  };
}

// ---------- Pedidos (ajustes e atestados) ----------
async function telaPedidos() {
  let pre = {};
  try { pre = JSON.parse(sessionStorage.getItem("pedido-prefill") ?? "{}"); sessionStorage.removeItem("pedido-prefill"); } catch {}
  tela.innerHTML = `<form class="cartao" id="form-ajuste">
      <label>O que aconteceu?<select name="tipo">
        <option value="INCLUSAO">Esqueci de marcar o ponto</option>
        <option value="ATESTADO">Atestado médico</option>
        <option value="ABONO">Outra ausência justificada</option>
      </select></label>
      <div class="grid2">
        <label><span id="rotulo-data">Dia</span><input name="data" type="date" required value="${esc(pre.data ?? "")}"></label>
        <label id="campo-hora">Horário<input name="hora" type="time"></label>
        <label id="campo-fim" class="oculto">Até o dia<input name="fim" type="date"></label>
      </div>
      <label id="campo-anexo" class="oculto">Foto do atestado<input name="anexo" type="file" accept="image/*,application/pdf" capture="environment"></label>
      <label>Motivo / observação<input name="motivo" required></label>
      <p id="erro-ajuste" class="alerta oculto"></p>
      <button class="primary botao-grande">Enviar</button>
    </form>
    <div class="cartao"><h3>Minhas solicitações</h3><div id="minhas"><p class="muted">Carregando…</p></div></div>`;
  const form = $("form-ajuste");
  form.tipo.onchange = () => {
    const tipo = form.tipo.value;
    $("campo-hora").classList.toggle("oculto", tipo !== "INCLUSAO");
    $("campo-fim").classList.toggle("oculto", tipo !== "ATESTADO");
    $("campo-anexo").classList.toggle("oculto", tipo !== "ATESTADO");
    $("rotulo-data").textContent = tipo === "ATESTADO" ? "Do dia" : "Dia";
  };
  if (pre.tipo) form.tipo.value = pre.tipo;
  form.tipo.onchange();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const erro = $("erro-ajuste");
    const botao = form.querySelector("button");
    botao.disabled = true;
    try {
      if (fd.get("tipo") === "ATESTADO") {
        await api("POST", "/api/ponto/afastamentos", {
          tipo: "ATESTADO", inicio: fd.get("data"), fim: fd.get("fim") || fd.get("data"),
          observacao: fd.get("motivo"), anexo: await lerAnexo(form.anexo.files[0]),
        });
      } else {
        await api("POST", "/api/ponto/tratamentos", { tipo: fd.get("tipo"), data: fd.get("data"), hora: fd.get("hora") || undefined, motivo: fd.get("motivo") });
      }
      form.reset();
      form.tipo.onchange();
      erro.className = "alerta ok";
      erro.textContent = "Enviado. A resposta do seu gestor aparece logo abaixo.";
      carregarSolicitacoes();
    } catch (err) {
      erro.className = "alerta";
      erro.textContent = err.message;
    } finally {
      botao.disabled = false;
    }
  };
  carregarSolicitacoes();
}

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
  const el = $("minhas");
  if (!el) return;
  el.innerHTML = lista.length
    ? `<table class="small"><tbody>${lista.map((t) => `<tr><td class="tnum">${dataBr(t.data)}</td><td>${esc(t.texto)}</td>
        <td><span class="tag ${STATUS[t.status][1]}">${STATUS[t.status][0]}</span></td></tr>`).join("")}</tbody></table>`
    : `<p class="muted">Nenhuma solicitação.</p>`;
}

// ---------- Notificações ----------
async function telaNotificacoes() {
  const r = await api("GET", "/api/notificacoes");
  tela.innerHTML = `<div class="cartao menu-lista">${r.lista.length ? r.lista.map((n) => `<a href="${esc(n.link?.replace(/^\/ponto/, "") || "#inicio")}" style="flex-direction:column;align-items:flex-start;gap:2px;${n.lidaEm ? "" : "background:var(--primary-soft)"}">
      <strong>${esc(n.titulo)}</strong><span>${esc(n.texto)}</span><span class="muted small">${new Date(n.criadoEm).toLocaleString("pt-BR")}</span></a>`).join("")
    : '<p class="muted" style="padding:12px;margin:0">Nenhuma notificação.</p>'}</div>`;
  if (r.naoLidas) api("POST", "/api/notificacoes/lidas").then(atualizarSino);
}

// ---------- Início ----------
addEventListener("online", () => { atualizarStatus(); sincronizarFila(); });
addEventListener("offline", atualizarStatus);
await carregarHoje();
// Logo, foto e nome no topo valem para todas as telas (não só a Home)
carregarInicio().then(carregarTopo, () => {});
await navegar();
atualizarSino();
setInterval(atualizarSino, 60_000);
if (config.exigeFacial) {
  if (!config.rostoCadastrado) mostrarMsg("Seu rosto ainda não foi cadastrado. Procure o RH para liberar o ponto.", "warn");
  carregarModelos().then(
    () => { modelosProntos = true; atualizarStatus(); },
    () => mostrarMsg("Não foi possível carregar o reconhecimento facial. Verifique a conexão e recarregue a página."),
  );
}
ligarGps();
atualizarStatus();
sincronizarFila();
