import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { autenticar, gerarToken, type Papel } from "../auth.js";
import { prisma } from "../db.js";
import { ErroHttp } from "../lib/erros.js";
import { FACIAL_ATIVO } from "../lib/face.js";
import { rota, sessao } from "./util.js";

export const rotasAuth = Router();

const esquemaCadastro = z.object({
  razaoSocial: z.string().min(2),
  cnpj: z
    .string()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v.length === 14, "CNPJ inválido"),
  nome: z.string().min(2),
  email: z.string().email().toLowerCase(),
  senha: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres"),
});

// Cadastro de uma nova empresa cliente (início do teste grátis)
rotasAuth.post(
  "/cadastro",
  rota(async (req, res) => {
    const d = esquemaCadastro.parse(req.body);
    if (await prisma.empresa.findUnique({ where: { cnpj: d.cnpj } })) throw new ErroHttp(409, "CNPJ já cadastrado");
    if (await prisma.usuario.findUnique({ where: { email: d.email } })) throw new ErroHttp(409, "E-mail já cadastrado");

    const empresa = await prisma.empresa.create({
      data: {
        razaoSocial: d.razaoSocial,
        cnpj: d.cnpj,
        jornadas: {
          create: {
            nome: "Comercial 44h (seg-sex 8h48)",
            horarios: JSON.stringify({
              tipo: "SEMANAL",
              dias: Object.fromEntries(
                ["1", "2", "3", "4", "5"].map((dia) => [dia, [["08:00", "12:00"], ["13:00", "17:48"]]]),
              ),
            }),
          },
        },
      },
    });
    const usuario = await prisma.usuario.create({
      data: {
        empresaId: empresa.id,
        nome: d.nome,
        email: d.email,
        senhaHash: await bcrypt.hash(d.senha, 10),
        papel: "ADMIN",
      },
    });
    res.status(201).json({
      token: gerarToken({ usuarioId: usuario.id, empresaId: empresa.id, papel: "ADMIN", funcionarioId: null }),
    });
  }),
);

rotasAuth.post(
  "/login",
  rota(async (req, res) => {
    const { email, senha } = z.object({ email: z.string().toLowerCase(), senha: z.string() }).parse(req.body);
    const u = await prisma.usuario.findUnique({ where: { email }, include: { funcionario: true } });
    if (!u || !(await bcrypt.compare(senha, u.senhaHash))) throw new ErroHttp(401, "E-mail ou senha incorretos");
    if (u.funcionario && !u.funcionario.ativo) throw new ErroHttp(403, "Usuário desativado");
    res.json({
      token: gerarToken({
        usuarioId: u.id,
        empresaId: u.empresaId,
        papel: u.papel as Papel,
        funcionarioId: u.funcionarioId,
      }),
      papel: u.papel,
    });
  }),
);

rotasAuth.get(
  "/eu",
  autenticar,
  rota(async (req, res) => {
    const u = await prisma.usuario.findUnique({
      where: { id: sessao(req).usuarioId },
      select: {
        nome: true,
        email: true,
        papel: true,
        funcionarioId: true,
        empresa: { select: { razaoSocial: true, cnpj: true, plano: true } },
      },
    });
    res.json({ ...u, recursos: { facial: FACIAL_ATIVO } });
  }),
);

rotasAuth.post(
  "/senha",
  autenticar,
  rota(async (req, res) => {
    const { atual, nova } = z.object({ atual: z.string(), nova: z.string().min(8) }).parse(req.body);
    const u = await prisma.usuario.findUnique({ where: { id: sessao(req).usuarioId } });
    if (!u || !(await bcrypt.compare(atual, u.senhaHash))) throw new ErroHttp(400, "Senha atual incorreta");
    await prisma.usuario.update({ where: { id: u.id }, data: { senhaHash: await bcrypt.hash(nova, 10) } });
    res.json({ ok: true });
  }),
);
