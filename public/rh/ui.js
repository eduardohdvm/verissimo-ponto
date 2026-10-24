// Ferramentas compartilhadas pelas telas do painel do RH.
import { blobAutenticado, esc } from "/app.js";

export const estado = { eu: null };
export const ehAdmin = () => estado.eu?.papel === "ADMIN";

export const conteudo = () => document.getElementById("conteudo");
export const modal = () => document.getElementById("modal");

export function abrirModal(html, aoAbrir) {
  const m = modal();
  m.innerHTML = html;
  m.showModal();
  m.querySelectorAll("[data-fechar]").forEach((b) => (b.onclick = () => m.close()));
  aoAbrir?.(m);
}

export function erroNo(el, err) {
  let alvo = el.querySelector(".alerta");
  if (!alvo) {
    alvo = document.createElement("p");
    const acoes = el.querySelector(".acoes");
    if (acoes) acoes.before(alvo);
    else el.append(alvo);
  }
  alvo.className = "alerta";
  alvo.textContent = err.message;
}

/** Liga um <form> a uma ação async, mostrando erros dentro do próprio form. */
export function aoEnviar(form, acao) {
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

export const topo = (titulo, acoes = "") => `<div class="topo"><h1>${titulo}</h1><div class="acoes">${acoes}</div></div>`;

/** <option>s a partir de uma lista {id, nome}. */
export const opcoes = (lista, selecionado, vazio) =>
  (vazio ? `<option value="">${esc(vazio)}</option>` : "") +
  lista.map((i) => `<option value="${i.id}" ${i.id === selecionado ? "selected" : ""}>${esc(i.nome)}</option>`).join("");

/** Liga os botões [data-x] dentro de um elemento a uma função que recebe o valor do atributo. */
export function aoClicar(raiz, atributo, fn) {
  raiz.querySelectorAll(`[data-${atributo}]`).forEach((b) => {
    b.onclick = (e) => {
      e.preventDefault();
      fn(b.dataset[atributo.replace(/-(\w)/g, (_, l) => l.toUpperCase())], b);
    };
  });
}

/** Caixa com um link de convite para copiar ou mandar pelo WhatsApp. */
export function caixaLink(link, nome) {
  const msg = encodeURIComponent(`Olá${nome ? ", " + nome : ""}! Crie sua senha do ponto eletrônico por este link: ${link}`);
  return `<div class="alerta ok" style="margin-top:12px">
    <div>Convite criado. Se o e-mail não chegar, envie o link direto:</div>
    <div class="mono" style="margin:6px 0">${esc(link)}</div>
    <div class="acoes">
      <button type="button" class="sm" onclick="navigator.clipboard.writeText('${esc(link)}');this.textContent='Copiado'">Copiar link</button>
      <a class="btn sm" href="https://wa.me/?text=${msg}" target="_blank" rel="noopener">Enviar pelo WhatsApp</a>
    </div></div>`;
}

export async function verFoto(url, titulo = "Foto") {
  abrirModal(`<h2>${esc(titulo)}</h2><p class="muted">Carregando…</p><div class="acoes"><button data-fechar>Fechar</button></div>`);
  const m = modal();
  try {
    const local = await blobAutenticado(url);
    m.querySelector("p").outerHTML = `<img src="${local}" alt="" style="width:100%;border-radius:8px;margin-bottom:12px">`;
  } catch (err) {
    m.querySelector("p").textContent = err.message;
  }
}

/** Baixa um arquivo de uma rota autenticada. */
export async function baixar(url, nome) {
  const local = await blobAutenticado(url);
  Object.assign(document.createElement("a"), { href: local, download: nome }).click();
}
