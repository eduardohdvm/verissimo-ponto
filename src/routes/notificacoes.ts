// Notificações do usuário logado (qualquer papel) e inscrição no Web Push.
import { Router } from "express";
import { z } from "zod";
import { autenticar, exigirPapel } from "../auth.js";
import { prisma } from "../db.js";
import { esquemaPreferencias, lerPreferencias } from "../lib/preferencias.js";
import { emailConfigurado, enviarEmail } from "../services/email.js";
import { chavesPush, notificar } from "../services/notificacoes.js";
import { rota, sessao } from "./util.js";

export const rotasNotificacoes = Router();

rotasNotificacoes.get("/push/chave", rota(async (_req, res) => res.json({ chave: (await chavesPush()).publica })));

rotasNotificacoes.post(
  "/push/inscrever",
  autenticar,
  rota(async (req, res) => {
    const d = z
      .object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) })
      .parse(req.body);
    await prisma.pushInscricao.upsert({
      where: { endpoint: d.endpoint },
      create: { usuarioId: sessao(req).usuarioId, endpoint: d.endpoint, p256dh: d.keys.p256dh, auth: d.keys.auth },
      update: { usuarioId: sessao(req).usuarioId, p256dh: d.keys.p256dh, auth: d.keys.auth },
    });
    res.json({ ok: true });
  }),
);

rotasNotificacoes.get(
  "/notificacoes",
  autenticar,
  rota(async (req, res) => {
    const usuarioId = sessao(req).usuarioId;
    const [lista, naoLidas] = await Promise.all([
      prisma.notificacao.findMany({ where: { usuarioId }, orderBy: { criadoEm: "desc" }, take: 30 }),
      prisma.notificacao.count({ where: { usuarioId, lidaEm: null } }),
    ]);
    res.json({ naoLidas, lista: lista.map(({ chave, empresaId, usuarioId: _u, ...n }) => n) });
  }),
);

rotasNotificacoes.post(
  "/notificacoes/lidas",
  autenticar,
  rota(async (req, res) => {
    await prisma.notificacao.updateMany({ where: { usuarioId: sessao(req).usuarioId, lidaEm: null }, data: { lidaEm: new Date() } });
    res.json({ ok: true });
  }),
);

// ---------- Preferências de quem acompanha equipes (ADMIN e GESTOR) ----------

const soRh = exigirPapel("ADMIN", "GESTOR");

rotasNotificacoes.get(
  "/admin/minhas-notificacoes",
  autenticar,
  soRh,
  rota(async (req, res) => {
    const u = await prisma.usuario.findUniqueOrThrow({ where: { id: sessao(req).usuarioId } });
    res.json({ preferencias: lerPreferencias(u.preferenciasNotificacao), email: u.email, emailConfigurado: emailConfigurado() });
  }),
);

rotasNotificacoes.put(
  "/admin/minhas-notificacoes",
  autenticar,
  soRh,
  rota(async (req, res) => {
    const p = esquemaPreferencias.parse(req.body);
    await prisma.usuario.update({ where: { id: sessao(req).usuarioId }, data: { preferenciasNotificacao: JSON.stringify(p) } });
    res.json(p);
  }),
);

rotasNotificacoes.post(
  "/admin/minhas-notificacoes/teste",
  autenticar,
  soRh,
  rota(async (req, res) => {
    const s = sessao(req);
    const u = await prisma.usuario.findUniqueOrThrow({ where: { id: s.usuarioId } });
    await notificar(s.empresaId, u.id, "Teste de notificação", "Se você está vendo isto, os avisos estão funcionando neste aparelho.", "/admin#notificacoes");
    const { email } = z.object({ email: z.boolean().default(false) }).parse(req.body ?? {});
    if (email) {
      await enviarEmail({ para: u.email, assunto: "Teste de notificação do ponto", titulo: "Teste de notificação",
        paragrafos: ["Os avisos por e-mail estão funcionando."] });
    }
    res.json({ ok: true });
  }),
);
