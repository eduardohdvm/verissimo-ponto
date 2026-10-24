// Inscrição nas notificações do navegador/celular (Web Push). Usado pelo app e pelo painel.
import { api } from "/app.js";

export const pushSuportado = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export async function estadoPush() {
  if (!pushSuportado()) return "INDISPONIVEL";
  if (Notification.permission === "denied") return "BLOQUEADO";
  const reg = await navigator.serviceWorker.getRegistration();
  const inscricao = await reg?.pushManager.getSubscription();
  return inscricao && Notification.permission === "granted" ? "ATIVO" : "INATIVO";
}

const paraBytes = (base64) => {
  const b = atob((base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

/** Pede permissão e inscreve este aparelho. No iPhone, só funciona com o app instalado na tela inicial. */
export async function ativarPush() {
  if (!pushSuportado()) throw new Error("Este navegador não aceita notificações. No iPhone, adicione o app à tela de início primeiro.");
  const permissao = await Notification.requestPermission();
  if (permissao !== "granted") throw new Error("As notificações foram bloqueadas. Libere nas configurações do navegador.");
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;
  const { chave } = await api("GET", "/api/push/chave");
  const inscricao =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: paraBytes(chave) }));
  await api("POST", "/api/push/inscrever", inscricao.toJSON());
}
