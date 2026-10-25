// Instalação do app na tela inicial do celular, sem loja.
// Android (Chrome, Edge, Samsung): o navegador oferece a instalação e o botão abre esse convite.
// iPhone: o Safari não tem esse convite, então mostramos o passo a passo pelo botão Compartilhar.
let convite = null;
addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  convite = e;
  aoMudar?.();
});
addEventListener("appinstalled", () => {
  convite = null;
  aoMudar?.();
});
let aoMudar = null;
/** Chamado quando o convite de instalação aparece ou o app é instalado (para redesenhar a tela). */
export const quandoMudar = (fn) => (aoMudar = fn);

const ua = navigator.userAgent;
// iPad com iPadOS se apresenta como Mac, mas tem tela de toque
const ehIos = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const ehAndroid = /Android/.test(ua);

export const instalado = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

/** INSTALADO | CONVITE (dá para instalar com um toque) | IOS | ANDROID (pelo menu do navegador) | INDISPONIVEL */
export function estadoInstalacao() {
  if (instalado()) return "INSTALADO";
  if (convite) return "CONVITE";
  if (ehIos) return "IOS";
  if (ehAndroid) return "ANDROID";
  return "INDISPONIVEL";
}

const ICONE_COMPARTILHAR = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" style="vertical-align:-3px"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>`;
const ICONE_MAIS = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" style="vertical-align:-3px"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/></svg>`;

/** Instala com um toque quando o navegador permite; senão abre o passo a passo no modal. */
export async function instalarApp(modal) {
  if (convite) {
    const c = convite;
    convite = null;
    await c.prompt();
    const { outcome } = await c.userChoice;
    aoMudar?.();
    return outcome === "accepted";
  }
  const passos = ehIos
    ? `<ol class="passos-instalar">
        <li>Abra esta página no <strong>Safari</strong>.</li>
        <li>Toque em <strong>Compartilhar</strong> ${ICONE_COMPARTILHAR} (na barra de baixo ou no topo).</li>
        <li>Role e toque em <strong>Adicionar à Tela de Início</strong> ${ICONE_MAIS}.</li>
        <li>Toque em <strong>Adicionar</strong>. O ícone do Ponto aparece junto dos seus apps.</li>
      </ol>
      <p class="muted small">No iPhone, os avisos no celular só funcionam pelo app instalado (iOS 16.4 ou mais novo).</p>`
    : `<ol class="passos-instalar">
        <li>Abra esta página no <strong>Chrome</strong>.</li>
        <li>Toque no menu <strong>⋮</strong> no canto de cima.</li>
        <li>Toque em <strong>Instalar app</strong> ou <strong>Adicionar à tela inicial</strong>.</li>
        <li>Confirme. O ícone do Ponto aparece junto dos seus apps.</li>
      </ol>`;
  modal.innerHTML = `<h2>Instalar o app</h2>${passos}<div class="acoes"><button class="primary" id="fechar-instalar">Entendi</button></div>`;
  modal.showModal();
  modal.querySelector("#fechar-instalar").onclick = () => modal.close();
  return false;
}
