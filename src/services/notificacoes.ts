// Notificações: ficam salvas (sininho do painel / app) e vão por Web Push para o celular e o navegador.
// As chaves VAPID do Web Push são geradas na primeira vez e guardadas no banco (ConfigSistema).
import webpush from "web-push";
import { prisma } from "../db.js";
import { urlApp } from "./email.js";

let chaves: Promise<{ publica: string; privada: string }> | null = null;

export function chavesPush() {
  chaves ??= (async () => {
    const salva = await prisma.configSistema.findUnique({ where: { chave: "vapid" } });
    if (salva) return JSON.parse(salva.valor);
    const nova = webpush.generateVAPIDKeys();
    const valor = { publica: nova.publicKey, privada: nova.privateKey };
    // upsert: se dois processos gerarem ao mesmo tempo, vale a primeira gravada
    const gravada = await prisma.configSistema.upsert({
      where: { chave: "vapid" },
      create: { chave: "vapid", valor: JSON.stringify(valor) },
      update: {},
    });
    return JSON.parse(gravada.valor);
  })();
  return chaves;
}

async function enviarPush(usuarioId: string, titulo: string, texto: string, link?: string | null) {
  const inscricoes = await prisma.pushInscricao.findMany({ where: { usuarioId } });
  if (!inscricoes.length) return;
  const { publica, privada } = await chavesPush();
  const contato = process.env.EMAIL_REMETENTE?.match(/[\w.+-]+@[\w.-]+/)?.[0] ?? "suporte@example.com";
  const corpo = JSON.stringify({ titulo, texto, link: link ? urlApp() + link : urlApp() });
  for (const i of inscricoes) {
    try {
      await webpush.sendNotification({ endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth } }, corpo, {
        vapidDetails: { subject: `mailto:${contato}`, publicKey: publica, privateKey: privada },
        TTL: 3600,
      });
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      // 404/410: o aparelho cancelou a inscrição
      if (status === 404 || status === 410) await prisma.pushInscricao.delete({ where: { id: i.id } }).catch(() => {});
      else console.warn("Falha no push:", (e as Error).message);
    }
  }
}

/**
 * Cria a notificação e manda o push. Com `chave`, a mesma notificação nunca é enviada duas vezes
 * (usado pelos alertas automáticos, que rodam a cada minuto).
 */
export async function notificar(
  empresaId: string,
  usuarioId: string,
  titulo: string,
  texto: string,
  link?: string | null,
  chave?: string,
): Promise<boolean> {
  try {
    await prisma.notificacao.create({ data: { empresaId, usuarioId, titulo, texto, link, chave } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return false; // já enviada
    throw e;
  }
  enviarPush(usuarioId, titulo, texto, link).catch((e) => console.warn("Falha no push:", e));
  return true;
}

export function notificarFuncionarios(empresaId: string, funcionarioIds: string[], titulo: string, texto: string, link?: string) {
  void (async () => {
    const usuarios = await prisma.usuario.findMany({ where: { funcionarioId: { in: funcionarioIds }, ativo: true } });
    for (const u of usuarios) await notificar(empresaId, u.id, titulo, texto, link);
  })().catch((e) => console.error("Erro ao notificar funcionários:", e));
}

/** Administradores e os gestores do departamento do funcionário. */
export async function responsaveisPor(empresaId: string, departamentoId: string | null) {
  return prisma.usuario.findMany({
    where: {
      empresaId,
      ativo: true,
      OR: [
        { papel: "ADMIN" },
        ...(departamentoId ? [{ papel: "GESTOR", departamentosGeridos: { some: { departamentoId } } }] : []),
      ],
    },
  });
}
