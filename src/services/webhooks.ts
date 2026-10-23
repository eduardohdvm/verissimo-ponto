import { createHmac } from "node:crypto";
import { prisma } from "../db.js";

export type EventoWebhook = "marcacao.criada" | "tratamento.decidido" | "funcionario.alterado";

/**
 * Envia o evento para os webhooks da empresa. Não bloqueia a requisição de origem.
 * O ERP valida a origem recalculando: HMAC-SHA256(segredo, corpo) == header X-Ponto-Assinatura.
 */
export function dispararWebhook(empresaId: string, evento: EventoWebhook, dados: unknown) {
  void (async () => {
    const hooks = await prisma.webhook.findMany({ where: { empresaId, ativo: true } });
    const corpo = JSON.stringify({ evento, enviadoEm: new Date().toISOString(), dados });
    for (const h of hooks) {
      if (!h.eventos.split(",").map((s) => s.trim()).includes(evento)) continue;
      const assinatura = createHmac("sha256", h.segredo).update(corpo).digest("hex");
      try {
        const resp = await fetch(h.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Ponto-Evento": evento,
            "X-Ponto-Assinatura": `sha256=${assinatura}`,
          },
          body: corpo,
          signal: AbortSignal.timeout(10_000),
        });
        if (!resp.ok) console.warn(`Webhook ${h.url} respondeu ${resp.status}`);
      } catch (e) {
        console.warn(`Falha ao enviar webhook ${h.url}:`, (e as Error).message);
      }
    }
  })().catch((e) => console.error("Erro nos webhooks:", e));
}
