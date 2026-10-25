// Organização da empresa (só ADMIN): filiais, departamentos e a equipe do RH (administradores e gestores).
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { autenticar, esquecerUsuario, exigirPapel } from "../auth.js";
import { prisma } from "../db.js";
import { ErroHttp, naoEncontrado } from "../lib/erros.js";
import { enviarConvite } from "../services/acesso.js";
import { rota, sessao } from "./util.js";

export const rotasOrg = Router();
rotasOrg.use(autenticar, exigirPapel("ADMIN", "GESTOR"));
const soAdmin = exigirPapel("ADMIN");
const eid = (req: Parameters<typeof sessao>[0]) => sessao(req).empresaId;
const opcional = z.string().trim().nullable().optional().transform((v) => v || null);

// ---------- Filiais ----------

const esquemaFilial = z.object({
  nome: z.string().trim().min(1, "Informe o nome"),
  cnpj: opcional,
  cidade: opcional,
  uf: z.string().trim().toUpperCase().length(2, "UF com 2 letras").nullable().optional().or(z.literal("")).transform((v) => v || null),
});

rotasOrg.get(
  "/filiais",
  rota(async (req, res) => {
    res.json(
      await prisma.filial.findMany({
        where: { empresaId: eid(req) },
        include: { _count: { select: { funcionarios: { where: { ativo: true } } } } },
        orderBy: { nome: "asc" },
      }),
    );
  }),
);

rotasOrg.post(
  "/filiais",
  soAdmin,
  rota(async (req, res) => {
    res.status(201).json(await prisma.filial.create({ data: { ...esquemaFilial.parse(req.body), empresaId: eid(req) } }));
  }),
);

rotasOrg.put(
  "/filiais/:id",
  soAdmin,
  rota(async (req, res) => {
    if (!(await prisma.filial.findFirst({ where: { id: req.params.id, empresaId: eid(req) } }))) throw naoEncontrado("Filial");
    res.json(await prisma.filial.update({ where: { id: req.params.id }, data: esquemaFilial.parse(req.body) }));
  }),
);

rotasOrg.delete(
  "/filiais/:id",
  soAdmin,
  rota(async (req, res) => {
    const f = await prisma.filial.findFirst({
      where: { id: req.params.id, empresaId: eid(req) },
      include: { _count: { select: { funcionarios: true, departamentos: true } } },
    });
    if (!f) throw naoEncontrado("Filial");
    if (f._count.funcionarios || f._count.departamentos) {
      throw new ErroHttp(409, "Mova os funcionários e departamentos desta filial antes de removê-la");
    }
    await prisma.feriado.deleteMany({ where: { filialId: f.id } });
    await prisma.filial.delete({ where: { id: f.id } });
    res.json({ ok: true });
  }),
);

// ---------- Departamentos ----------

const esquemaDepartamento = z.object({ nome: z.string().trim().min(1, "Informe o nome"), filialId: opcional });

async function validarFilial(empresaId: string, filialId: string | null) {
  if (filialId && !(await prisma.filial.findFirst({ where: { id: filialId, empresaId } }))) throw naoEncontrado("Filial");
}

rotasOrg.get(
  "/departamentos",
  rota(async (req, res) => {
    const lista = await prisma.departamento.findMany({
      where: { empresaId: eid(req) },
      include: {
        filial: { select: { nome: true } },
        gestores: { include: { usuario: { select: { id: true, nome: true } } } },
        _count: { select: { funcionarios: { where: { ativo: true } } } },
      },
      orderBy: { nome: "asc" },
    });
    res.json(
      lista.map(({ gestores, ...d }) => ({ ...d, gestores: gestores.map((g) => g.usuario) })),
    );
  }),
);

rotasOrg.post(
  "/departamentos",
  soAdmin,
  rota(async (req, res) => {
    const d = esquemaDepartamento.parse(req.body);
    await validarFilial(eid(req), d.filialId);
    res.status(201).json(await prisma.departamento.create({ data: { ...d, empresaId: eid(req) } }));
  }),
);

rotasOrg.put(
  "/departamentos/:id",
  soAdmin,
  rota(async (req, res) => {
    if (!(await prisma.departamento.findFirst({ where: { id: req.params.id, empresaId: eid(req) } }))) {
      throw naoEncontrado("Departamento");
    }
    const d = esquemaDepartamento.parse(req.body);
    await validarFilial(eid(req), d.filialId);
    res.json(await prisma.departamento.update({ where: { id: req.params.id }, data: d }));
  }),
);

rotasOrg.delete(
  "/departamentos/:id",
  soAdmin,
  rota(async (req, res) => {
    const d = await prisma.departamento.findFirst({
      where: { id: req.params.id, empresaId: eid(req) },
      include: { _count: { select: { funcionarios: true } } },
    });
    if (!d) throw naoEncontrado("Departamento");
    if (d._count.funcionarios) throw new ErroHttp(409, "Mova os funcionários deste departamento antes de removê-lo");
    await prisma.departamento.delete({ where: { id: d.id } });
    res.json({ ok: true });
  }),
);

// ---------- Equipe do RH: administradores e gestores ----------

const esquemaUsuario = z.object({
  nome: z.string().trim().min(2, "Informe o nome"),
  papel: z.enum(["ADMIN", "GESTOR"]),
  departamentoIds: z.array(z.string()).default([]),
  ativo: z.boolean().optional(),
});

async function definirDepartamentos(empresaId: string, usuarioId: string, ids: string[]) {
  const validos = await prisma.departamento.findMany({ where: { empresaId, id: { in: ids } }, select: { id: true } });
  await prisma.gestorDepartamento.deleteMany({ where: { usuarioId } });
  if (validos.length) {
    await prisma.gestorDepartamento.createMany({ data: validos.map((d) => ({ usuarioId, departamentoId: d.id })) });
  }
}

rotasOrg.get(
  "/usuarios",
  soAdmin,
  rota(async (req, res) => {
    const lista = await prisma.usuario.findMany({
      where: { empresaId: eid(req), papel: { in: ["ADMIN", "GESTOR"] } },
      select: {
        id: true, nome: true, email: true, papel: true, ativo: true, criadoEm: true, funcionarioId: true,
        departamentosGeridos: { select: { departamentoId: true } },
      },
      orderBy: { nome: "asc" },
    });
    res.json(
      lista.map(({ departamentosGeridos, ...u }) => ({ ...u, departamentoIds: departamentosGeridos.map((d) => d.departamentoId) })),
    );
  }),
);

rotasOrg.post(
  "/usuarios",
  soAdmin,
  rota(async (req, res) => {
    const d = esquemaUsuario.parse(req.body);
    // Promover um funcionário que já tem login: ele continua batendo ponto e ganha o acesso ao painel
    const { funcionarioId } = z.object({ funcionarioId: z.string().optional() }).parse(req.body);
    if (funcionarioId) {
      const existente = await prisma.usuario.findFirst({ where: { funcionarioId, empresaId: eid(req) } });
      if (!existente) throw new ErroHttp(400, "Este funcionário ainda não tem login no app. Crie o acesso dele em Funcionários primeiro.");
      if (existente.papel !== "FUNCIONARIO") throw new ErroHttp(409, "Este funcionário já faz parte da equipe do RH");
      await prisma.usuario.update({ where: { id: existente.id }, data: { papel: d.papel } });
      esquecerUsuario(existente.id);
      await definirDepartamentos(eid(req), existente.id, d.papel === "GESTOR" ? d.departamentoIds : []);
      return res.status(201).json({ id: existente.id, promovido: true });
    }
    const { email } = z.object({ email: z.string().email("E-mail inválido").toLowerCase() }).parse(req.body);
    if (await prisma.usuario.findUnique({ where: { email } })) throw new ErroHttp(409, "Este e-mail já é usado por outro login");
    const u = await prisma.usuario.create({
      data: {
        empresaId: eid(req),
        nome: d.nome,
        email,
        papel: d.papel,
        // Senha aleatória que ninguém sabe: a pessoa cria a dela pelo convite
        senhaHash: await bcrypt.hash(randomBytes(24).toString("hex"), 10),
      },
    });
    await definirDepartamentos(eid(req), u.id, d.papel === "GESTOR" ? d.departamentoIds : []);
    res.status(201).json({ id: u.id, link: await enviarConvite(u.id) });
  }),
);

rotasOrg.put(
  "/usuarios/:id",
  soAdmin,
  rota(async (req, res) => {
    const d = esquemaUsuario.parse(req.body);
    const u = await prisma.usuario.findFirst({
      where: { id: req.params.id, empresaId: eid(req), papel: { in: ["ADMIN", "GESTOR"] } },
    });
    if (!u) throw naoEncontrado("Usuário");
    const perdeAdmin = u.papel === "ADMIN" && (d.papel !== "ADMIN" || d.ativo === false);
    if (perdeAdmin) {
      if (u.id === sessao(req).usuarioId) throw new ErroHttp(400, "Você não pode tirar o seu próprio acesso de administrador");
      const outros = await prisma.usuario.count({ where: { empresaId: eid(req), papel: "ADMIN", ativo: true, id: { not: u.id } } });
      if (!outros) throw new ErroHttp(400, "A empresa precisa ter pelo menos um administrador ativo");
    }
    await prisma.usuario.update({
      where: { id: u.id },
      data: { nome: d.nome, papel: d.papel, ...(d.ativo !== undefined ? { ativo: d.ativo } : {}) },
    });
    esquecerUsuario(u.id);
    await definirDepartamentos(eid(req), u.id, d.papel === "GESTOR" ? d.departamentoIds : []);
    res.json({ ok: true });
  }),
);

// Tira a pessoa da equipe do RH: quem também é funcionário volta a ser só funcionário; os demais são desativados
rotasOrg.delete(
  "/usuarios/:id",
  soAdmin,
  rota(async (req, res) => {
    const u = await prisma.usuario.findFirst({ where: { id: req.params.id, empresaId: eid(req), papel: { in: ["ADMIN", "GESTOR"] } } });
    if (!u) throw naoEncontrado("Usuário");
    if (u.id === sessao(req).usuarioId) throw new ErroHttp(400, "Você não pode se remover da equipe do RH");
    if (u.papel === "ADMIN") {
      const outros = await prisma.usuario.count({ where: { empresaId: eid(req), papel: "ADMIN", ativo: true, id: { not: u.id } } });
      if (!outros) throw new ErroHttp(400, "A empresa precisa ter pelo menos um administrador ativo");
    }
    await prisma.gestorDepartamento.deleteMany({ where: { usuarioId: u.id } });
    await prisma.usuario.update({ where: { id: u.id }, data: u.funcionarioId ? { papel: "FUNCIONARIO" } : { ativo: false } });
    esquecerUsuario(u.id);
    res.json({ ok: true, virouFuncionario: !!u.funcionarioId });
  }),
);

rotasOrg.post(
  "/usuarios/:id/convite",
  soAdmin,
  rota(async (req, res) => {
    const u = await prisma.usuario.findFirst({ where: { id: req.params.id, empresaId: eid(req) } });
    if (!u) throw naoEncontrado("Usuário");
    res.json({ link: await enviarConvite(u.id) });
  }),
);
