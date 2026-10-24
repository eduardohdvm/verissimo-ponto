// Links de uso único por e-mail: redefinição de senha e convite de primeiro acesso.
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../db.js";
import { ErroHttp } from "../lib/erros.js";
import { enviarEmail, urlApp } from "./email.js";

const VALIDADE = { REDEFINIR: 60 * 60_000, CONVITE: 7 * 86400_000 };
type Tipo = keyof typeof VALIDADE;

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/** Cria um link novo; os anteriores do mesmo tipo deixam de valer. */
export async function criarLink(usuarioId: string, tipo: Tipo): Promise<string> {
  await prisma.tokenAcesso.updateMany({ where: { usuarioId, tipo, usadoEm: null }, data: { usadoEm: new Date() } });
  const token = randomBytes(32).toString("hex");
  await prisma.tokenAcesso.create({
    data: { usuarioId, tipo, hash: hashToken(token), expiraEm: new Date(Date.now() + VALIDADE[tipo]) },
  });
  return `${urlApp()}/redefinir?token=${token}`;
}

async function buscarValido(token: string) {
  const t = await prisma.tokenAcesso.findUnique({
    where: { hash: hashToken(token) },
    include: { usuario: { include: { empresa: true } } },
  });
  if (!t || t.usadoEm || t.expiraEm < new Date() || !t.usuario.ativo) {
    throw new ErroHttp(400, "Este link expirou ou já foi usado. Peça um novo.");
  }
  return t;
}

export async function consultarLink(token: string) {
  const t = await buscarValido(token);
  return { tipo: t.tipo, nome: t.usuario.nome, email: t.usuario.email, empresa: t.usuario.empresa.razaoSocial };
}

export async function usarLink(token: string, senha: string) {
  const t = await buscarValido(token);
  await prisma.$transaction([
    prisma.usuario.update({ where: { id: t.usuarioId }, data: { senhaHash: await bcrypt.hash(senha, 10) } }),
    prisma.tokenAcesso.updateMany({ where: { usuarioId: t.usuarioId, usadoEm: null }, data: { usadoEm: new Date() } }),
  ]);
  return t.usuario;
}

// Limite simples contra abuso do "esqueci minha senha": 5 pedidos por hora por e-mail
const pedidos = new Map<string, number[]>();
function dentroDoLimite(chave: string) {
  const agora = Date.now();
  const lista = (pedidos.get(chave) ?? []).filter((t) => agora - t < 3600_000);
  if (lista.length >= 5) return false;
  lista.push(agora);
  pedidos.set(chave, lista);
  return true;
}

/** Sempre responde igual, exista ou não o e-mail (não revela quem tem conta). */
export async function pedirRedefinicao(email: string) {
  if (!dentroDoLimite(email)) return;
  const u = await prisma.usuario.findUnique({ where: { email } });
  if (!u || !u.ativo) return;
  const link = await criarLink(u.id, "REDEFINIR");
  await enviarEmail({
    para: u.email,
    assunto: "Redefinir sua senha do ponto",
    titulo: "Redefinir senha",
    paragrafos: [`Olá, ${u.nome}.`, "Recebemos um pedido para trocar a sua senha. O link vale por 1 hora.", "Se não foi você, ignore este e-mail."],
    botao: { texto: "Criar nova senha", url: link },
  });
}

export async function enviarConvite(usuarioId: string) {
  const u = await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId }, include: { empresa: true } });
  const link = await criarLink(u.id, "CONVITE");
  await enviarEmail({
    para: u.email,
    assunto: `Seu acesso ao ponto da ${u.empresa.razaoSocial}`,
    titulo: "Bem-vindo ao ponto eletrônico",
    paragrafos: [
      `Olá, ${u.nome}.`,
      `A ${u.empresa.razaoSocial} criou o seu acesso para bater ponto pelo celular ou computador.`,
      "Crie a sua senha pelo botão abaixo. O link vale por 7 dias.",
    ],
    botao: { texto: "Criar minha senha", url: link },
  });
  return link;
}
