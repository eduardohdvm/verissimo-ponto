// Sininho de notificações no menu do painel.
import { api, esc } from "/app.js";
import { ativarPush, estadoPush } from "/push.js";

export async function iniciarNotificacoes() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  const marca = document.querySelector("#menu .marca");
  if (!marca) return;
  const botao = document.createElement("button");
  botao.className = "sininho";
  botao.title = "Notificações";
  botao.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg><span class="contador oculto"></span>`;
  marca.append(botao);
  const painel = document.createElement("div");
  painel.className = "painel-notificacoes oculto";
  document.body.append(painel);

  const atualizar = async () => {
    const r = await api("GET", "/api/notificacoes").catch(() => null);
    if (!r) return null;
    const c = botao.querySelector(".contador");
    c.textContent = r.naoLidas > 9 ? "9+" : r.naoLidas;
    c.classList.toggle("oculto", !r.naoLidas);
    return r;
  };

  botao.onclick = async (e) => {
    e.stopPropagation();
    if (!painel.classList.contains("oculto")) return painel.classList.add("oculto");
    const r = await atualizar();
    const push = await estadoPush();
    painel.innerHTML = `<div class="topo" style="margin:0 0 8px"><strong>Notificações</strong>
        ${push === "INATIVO" ? '<button class="sm" id="ativar-push">Avisar neste aparelho</button>' : push === "ATIVO" ? '<span class="tag ok">Avisos ligados</span>' : ""}</div>
      ${r?.lista.length ? r.lista.map((n) => `<a class="notificacao ${n.lidaEm ? "" : "nova"}" href="${esc(n.link ?? "#")}">
          <strong>${esc(n.titulo)}</strong><span>${esc(n.texto)}</span>
          <span class="muted small">${new Date(n.criadoEm).toLocaleString("pt-BR")}</span></a>`).join("")
        : '<p class="muted small">Nenhuma notificação.</p>'}`;
    painel.classList.remove("oculto");
    painel.querySelector("#ativar-push")?.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      try {
        await ativarPush();
        ev.target.outerHTML = '<span class="tag ok">Avisos ligados</span>';
      } catch (err) {
        alert(err.message);
      }
    });
    if (r?.naoLidas) api("POST", "/api/notificacoes/lidas").then(atualizar);
  };
  document.addEventListener("click", (e) => {
    if (!painel.contains(e.target)) painel.classList.add("oculto");
  });
  atualizar();
  setInterval(atualizar, 60_000);
}
