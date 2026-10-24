// Rotas do RH ligadas ao dia a dia do ponto: painel, funcionários, marcações, ajustes e espelho.
// ADMIN vê a empresa toda; GESTOR só os funcionários dos departamentos dele (services/escopo.ts).
import { randomBytes } from "node:crypto";
import path from "node:path";
import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { autenticar, exigirPapel } from "../auth.js";
import { prisma } from "../db.js";
import { ErroHttp, naoEncontrado } from "../lib/erros.js";
import { limiteFuncionarios } from "../lib/planos.js";
import { partesLocais, somarDias, utcDeLocal } from "../lib/tempo.js";
import { enviarConvite } from "../services/acesso.js";
import { dadosFuncionario, esquemaFuncionario, esquemaPeriodo, validarReferencias } from "../services/cadastros.js";
import { filtroFuncionarios, funcionarioNoEscopo } from "../services/escopo.js";
import { gerarEspelho, periodoDoMes } from "../services/espelho.js";
import { indicadoresDoMes, trabalhandoAgora } from "../services/indicadores.js";
import { cadastrarRosto } from "../services/facial.js";
import { garantirPeriodoAberto } from "../services/fechamentos.js";
import { PASTA_UPLOADS } from "../services/marcacoes.js";
import { notificarFuncionarios } from "../services/notificacoes.js";
import { criarTratamento } from "../services/tratamentos.js";
import { dispararWebhook } from "../services/webhooks.js";
import { rota, sessao } from "./util.js";

export const rotasAdmin = Router();
rotasAdmin.use(autenticar, exigirPapel("ADMIN", "GESTOR"));
export const soAdmin = exigirPapel("ADMIN");

const eid = (req: Parameters<typeof sessao>[0]) => sessao(req).empresaId;

// ---------- Painel ----------

rotasAdmin.get(
  "/painel",
  rota(async (req, res) => {
    const emp = await prisma.empresa.findUniqueOrThrow({ where: { id: eid(req) } });
    const escopo = await filtroFuncionarios(sessao(req));
    const hoje = partesLocais(new Date(), emp.fusoHorario).data;
    const inicioHoje = utcDeLocal(hoje, "00:00", emp.fusoHorario);
    const [ativos, marcacoesHoje, pendentes, recusadasHoje, afastamentosPendentes] = await Promise.all([
      prisma.funcionario.count({ where: { ...escopo, ativo: true } }),
      prisma.marcacao.findMany({
        where: { empresaId: emp.id, funcionario: escopo, dataHora: { gte: inicioHoje } },
        include: { funcionario: { select: { nome: true } } },
        orderBy: { dataHora: "desc" },
      }),
      prisma.tratamento.count({ where: { empresaId: emp.id, funcionario: escopo, status: "PENDENTE" } }),
      prisma.tentativaRecusada.count({
        where: { empresaId: emp.id, ...(sessao(req).papel === "ADMIN" ? {} : { funcionario: escopo }), criadoEm: { gte: inicioHoje } },
      }),
      prisma.afastamento.count({ where: { empresaId: emp.id, funcionario: escopo, status: "PENDENTE" } }),
    ]);
    const presentes = new Set(marcacoesHoje.map((m) => m.funcionarioId));
    res.json({
      hoje,
      funcionariosAtivos: ativos,
      presentesHoje: presentes.size,
      tratamentosPendentes: pendentes,
      afastamentosPendentes,
      tentativasRecusadasHoje: recusadasHoje,
      ultimasMarcacoes: marcacoesHoje.slice(0, 30).map((m) => ({
        id: m.id,
        nsr: m.nsr,
        funcionario: m.funcionario.nome,
        hora: partesLocais(m.dataHora, emp.fusoHorario).hora,
        origem: m.origem,
        temSelfie: !!m.selfie,
        distanciaFacial: m.distanciaFacial,
        provaVida: m.provaVida,
      })),
    });
  }),
);

// ---------- Funcionários ----------

rotasAdmin.get(
  "/funcionarios",
  rota(async (req, res) => {
    const lista = await prisma.funcionario.findMany({
      where: await filtroFuncionarios(sessao(req)),
      include: {
        jornada: { select: { nome: true } },
        departamento: { select: { nome: true } },
        filial: { select: { nome: true } },
        usuario: { select: { email: true } },
      },
      orderBy: { nome: "asc" },
    });
    res.json(
      lista.map(({ descritorFacial, fotoCadastro, pinHash, ...f }) => ({
        ...f,
        rostoCadastrado: !!descritorFacial,
        temPin: !!pinHash,
      })),
    );
  }),
);

// Acesso ao app: com senha definida pelo RH, ou por convite (o funcionário cria a senha pelo link)
const esquemaAcesso = z
  .object({
    email: z.string().email("E-mail de login inválido").toLowerCase(),
    senha: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres").optional(),
    convite: z.boolean().optional(),
  })
  .optional();

async function salvarAcesso(empresaId: string, f: { id: string; nome: string }, acesso: z.infer<typeof esquemaAcesso>) {
  if (!acesso) return null;
  const dono = await prisma.usuario.findUnique({ where: { email: acesso.email } });
  const existente = await prisma.usuario.findUnique({ where: { funcionarioId: f.id } });
  if (dono && dono.id !== existente?.id) throw new ErroHttp(409, "Este e-mail já é usado por outro login");
  // Sem senha, cria com uma senha aleatória que ninguém sabe: o acesso só vale depois do convite
  const senhaHash = await bcrypt.hash(acesso.senha ?? randomBytes(24).toString("hex"), 10);
  const u = existente
    ? await prisma.usuario.update({
        where: { id: existente.id },
        data: { email: acesso.email, nome: f.nome, ...(acesso.senha ? { senhaHash } : {}) },
      })
    : await prisma.usuario.create({
        data: { empresaId, nome: f.nome, email: acesso.email, senhaHash, papel: "FUNCIONARIO", funcionarioId: f.id },
      });
  return acesso.convite || (!existente && !acesso.senha) ? enviarConvite(u.id) : null;
}

rotasAdmin.post(
  "/funcionarios",
  soAdmin,
  rota(async (req, res) => {
    const d = await validarReferencias(eid(req), esquemaFuncionario.parse(req.body));
    const acesso = esquemaAcesso.parse(req.body.acesso);
    if (acesso && (await prisma.usuario.findUnique({ where: { email: acesso.email } }))) {
      throw new ErroHttp(409, "Este e-mail já é usado por outro login");
    }
    await verificarLimitePlano(eid(req));
    const f = await prisma.funcionario.create({ data: { ...dadosFuncionario(d), empresaId: eid(req) } });
    const linkConvite = await salvarAcesso(eid(req), f, acesso);
    dispararWebhook(eid(req), "funcionario.alterado", f);
    res.status(201).json({ ...f, linkConvite });
  }),
);

rotasAdmin.put(
  "/funcionarios/:id",
  soAdmin,
  rota(async (req, res) => {
    const atual = await funcionarioNoEscopo(sessao(req), req.params.id);
    const d = await validarReferencias(eid(req), esquemaFuncionario.parse(req.body));
    if (d.ativo && !atual.ativo) await verificarLimitePlano(eid(req));
    const f = await prisma.funcionario.update({ where: { id: atual.id }, data: dadosFuncionario(d) });
    const linkConvite = await salvarAcesso(eid(req), f, esquemaAcesso.parse(req.body.acesso));
    dispararWebhook(eid(req), "funcionario.alterado", f);
    res.json({ ...f, linkConvite });
  }),
);

// Reenvia o convite de primeiro acesso; devolve o link para o RH mandar também pelo WhatsApp
rotasAdmin.post(
  "/funcionarios/:id/convite",
  soAdmin,
  rota(async (req, res) => {
    const f = await funcionarioNoEscopo(sessao(req), req.params.id);
    const u = await prisma.usuario.findUnique({ where: { funcionarioId: f.id } });
    if (!u) throw new ErroHttp(400, "Cadastre um e-mail de login para este funcionário");
    res.json({ link: await enviarConvite(u.id) });
  }),
);

// PIN do modo quiosque (4 a 6 dígitos)
rotasAdmin.put(
  "/funcionarios/:id/pin",
  soAdmin,
  rota(async (req, res) => {
    const f = await funcionarioNoEscopo(sessao(req), req.params.id);
    const { pin } = z.object({ pin: z.string().regex(/^\d{4,6}$/, "O PIN deve ter de 4 a 6 números").nullable() }).parse(req.body);
    await prisma.funcionario.update({ where: { id: f.id }, data: { pinHash: pin ? await bcrypt.hash(pin, 10) : null } });
    res.json({ ok: true });
  }),
);

async function verificarLimitePlano(empresaId: string) {
  const emp = await prisma.empresa.findUniqueOrThrow({ where: { id: empresaId } });
  const limite = limiteFuncionarios(emp.plano);
  const ativos = await prisma.funcionario.count({ where: { empresaId, ativo: true } });
  if (limite !== null && ativos >= limite) {
    throw new ErroHttp(402, `O plano atual permite até ${limite} funcionários ativos. Fale com a gente para mudar de plano.`);
  }
}

// ---------- Rosto de referência (reconhecimento facial) ----------

rotasAdmin.post(
  "/funcionarios/:id/rosto",
  soAdmin,
  rota(async (req, res) => {
    const f = await funcionarioNoEscopo(sessao(req), req.params.id);
    const { imagem } = z.object({ imagem: z.string().min(100) }).parse(req.body);
    res.json(await cadastrarRosto(eid(req), f.id, imagem));
  }),
);

rotasAdmin.get(
  "/funcionarios/:id/rosto",
  rota(async (req, res) => {
    const f = await funcionarioNoEscopo(sessao(req), req.params.id);
    if (!f.fotoCadastro) throw naoEncontrado("Foto de cadastro");
    res.sendFile(path.join(PASTA_UPLOADS, f.fotoCadastro));
  }),
);

rotasAdmin.delete(
  "/funcionarios/:id/rosto",
  soAdmin,
  rota(async (req, res) => {
    const f = await funcionarioNoEscopo(sessao(req), req.params.id);
    await prisma.funcionario.update({
      where: { id: f.id },
      data: { fotoCadastro: null, descritorFacial: null, facialCadastradoEm: null },
    });
    res.json({ ok: true });
  }),
);

// Tentativas recusadas pelo reconhecimento facial. O ADMIN vê também as de pessoas
// não reconhecidas no quiosque (sem funcionário); o gestor, só as da equipe dele.
async function filtroTentativas(req: Parameters<typeof sessao>[0]) {
  return sessao(req).papel === "ADMIN" ? {} : { funcionario: await filtroFuncionarios(sessao(req)) };
}

rotasAdmin.get(
  "/tentativas",
  rota(async (req, res) => {
    const emp = await prisma.empresa.findUniqueOrThrow({ where: { id: eid(req) } });
    const lista = await prisma.tentativaRecusada.findMany({
      where: { empresaId: emp.id, ...(await filtroTentativas(req)), criadoEm: { gte: new Date(Date.now() - 7 * 86400_000) } },
      include: { funcionario: { select: { nome: true } } },
      orderBy: { criadoEm: "desc" },
      take: 100,
    });
    res.json(
      lista.map((t) => ({
        id: t.id,
        funcionario: t.funcionario?.nome ?? "Não identificado (quiosque)",
        motivo: t.motivo,
        distanciaFacial: t.distanciaFacial,
        temFoto: !!t.foto,
        data: partesLocais(t.criadoEm, emp.fusoHorario).data,
        hora: partesLocais(t.criadoEm, emp.fusoHorario).hora,
      })),
    );
  }),
);

rotasAdmin.get(
  "/tentativas/:id/foto",
  rota(async (req, res) => {
    const t = await prisma.tentativaRecusada.findFirst({
      where: { id: req.params.id, empresaId: eid(req), ...(await filtroTentativas(req)) },
    });
    if (!t?.foto) throw naoEncontrado("Foto");
    res.sendFile(path.join(PASTA_UPLOADS, t.foto));
  }),
);

// ---------- Marcações (somente leitura: nunca são editadas) ----------

rotasAdmin.get(
  "/marcacoes",
  rota(async (req, res) => {
    const { funcionarioId, data } = z.object({ funcionarioId: z.string(), data: z.string() }).parse(req.query);
    await funcionarioNoEscopo(sessao(req), funcionarioId);
    const emp = await prisma.empresa.findUniqueOrThrow({ where: { id: eid(req) } });
    const lista = await prisma.marcacao.findMany({
      where: {
        empresaId: emp.id,
        funcionarioId,
        dataHora: {
          gte: utcDeLocal(data, "00:00", emp.fusoHorario),
          lt: utcDeLocal(somarDias(data, 2), "00:00", emp.fusoHorario),
        },
      },
      include: { tratamentos: { where: { tipo: "DESCONSIDERAR", status: { not: "REJEITADO" } } } },
      orderBy: { dataHora: "asc" },
    });
    res.json(
      lista.map((m) => ({
        id: m.id,
        nsr: m.nsr,
        data: partesLocais(m.dataHora, emp.fusoHorario).data,
        hora: partesLocais(m.dataHora, emp.fusoHorario).hora,
        origem: m.origem,
        online: m.online,
        latitude: m.latitude,
        longitude: m.longitude,
        temSelfie: !!m.selfie,
        desconsiderada: m.tratamentos.some((t) => t.status === "APROVADO"),
      })),
    );
  }),
);

// Selfies só são servidas autenticadas (dado biométrico — LGPD)
rotasAdmin.get(
  "/marcacoes/:id/selfie",
  rota(async (req, res) => {
    const m = await prisma.marcacao.findFirst({
      where: { id: req.params.id, empresaId: eid(req), funcionario: await filtroFuncionarios(sessao(req)) },
    });
    if (!m?.selfie) throw naoEncontrado("Foto");
    res.sendFile(path.join(PASTA_UPLOADS, m.selfie));
  }),
);

// ---------- Tratamentos (ajustes de ponto) ----------

rotasAdmin.get(
  "/tratamentos",
  rota(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const emp = await prisma.empresa.findUniqueOrThrow({ where: { id: eid(req) } });
    const lista = await prisma.tratamento.findMany({
      where: { empresaId: emp.id, funcionario: await filtroFuncionarios(sessao(req)), ...(status ? { status } : {}) },
      include: { funcionario: { select: { nome: true } }, marcacao: { select: { dataHora: true, nsr: true } } },
      orderBy: { criadoEm: "desc" },
      take: 200,
    });
    res.json(
      lista.map((t) => ({
        ...t,
        hora: t.dataHora ? partesLocais(t.dataHora, emp.fusoHorario).hora : null,
        horaMarcacao: t.marcacao ? partesLocais(t.marcacao.dataHora, emp.fusoHorario).hora : null,
      })),
    );
  }),
);

rotasAdmin.post(
  "/funcionarios/:id/tratamentos",
  rota(async (req, res) => {
    const f = await funcionarioNoEscopo(sessao(req), req.params.id);
    const t = await criarTratamento(eid(req), f.id, sessao(req).usuarioId, req.body, true);
    res.status(201).json(t);
  }),
);

rotasAdmin.post(
  "/tratamentos/:id/decisao",
  rota(async (req, res) => {
    const { aprovar } = z.object({ aprovar: z.boolean() }).parse(req.body);
    const t = await prisma.tratamento.findFirst({
      where: { id: req.params.id, empresaId: eid(req), status: "PENDENTE", funcionario: await filtroFuncionarios(sessao(req)) },
    });
    if (!t) throw naoEncontrado("Solicitação pendente");
    if (aprovar) await garantirPeriodoAberto(eid(req), t.data);
    const atualizado = await prisma.tratamento.update({
      where: { id: t.id },
      data: { status: aprovar ? "APROVADO" : "REJEITADO", decididoPor: sessao(req).usuarioId, decididoEm: new Date() },
    });
    dispararWebhook(eid(req), "tratamento.decidido", atualizado);
    notificarFuncionarios(eid(req), [t.funcionarioId], aprovar ? "Ajuste aprovado" : "Ajuste recusado",
      `Seu pedido de ajuste do dia ${t.data.split("-").reverse().join("/")} foi ${aprovar ? "aprovado" : "recusado"}.`, "/ponto#ajuste");
    res.json(atualizado);
  }),
);

// ---------- Espelho de ponto ----------

rotasAdmin.get(
  "/espelho/:funcionarioId",
  rota(async (req, res) => {
    const p = esquemaPeriodo.parse(req.query);
    const f = await funcionarioNoEscopo(sessao(req), req.params.funcionarioId);
    res.json(await gerarEspelho(eid(req), f.id, p.inicio, p.fim));
  }),
);

// ---------- Indicadores ----------

rotasAdmin.get(
  "/indicadores",
  rota(async (req, res) => {
    const { mes } = z.object({ mes: z.string().regex(/^\d{4}-\d{2}$/) }).parse(req.query);
    const p = periodoDoMes(mes);
    const [indicadores, agora] = await Promise.all([indicadoresDoMes(sessao(req), p.inicio, p.fim), trabalhandoAgora(sessao(req))]);
    res.json({ periodo: p, ...indicadores, agora });
  }),
);

// ---------- Primeiros passos e importação de planilha ----------

rotasAdmin.get(
  "/primeiros-passos",
  soAdmin,
  rota(async (req, res) => {
    const empresaId = eid(req);
    const [funcionarios, comJornada, comAcesso, feriados, locais, departamentos] = await Promise.all([
      prisma.funcionario.count({ where: { empresaId } }),
      prisma.funcionario.count({ where: { empresaId, jornadaId: { not: null } } }),
      prisma.usuario.count({ where: { empresaId, papel: "FUNCIONARIO" } }),
      prisma.feriado.count({ where: { empresaId } }),
      prisma.localPermitido.count({ where: { empresaId } }),
      prisma.departamento.count({ where: { empresaId } }),
    ]);
    res.json({ funcionarios, comJornada, comAcesso, feriados, locais, departamentos });
  }),
);

const esquemaLinhaImportacao = z.object({
  nome: z.string().trim().min(2, "nome obrigatório"),
  cpf: z.string(),
  matricula: z.string().trim().optional().nullable(),
  pis: z.string().trim().optional().nullable(),
  cargo: z.string().trim().optional().nullable(),
  admissao: z.string().trim().optional().nullable(), // DD/MM/AAAA ou AAAA-MM-DD
  email: z.string().trim().toLowerCase().optional().nullable(),
  departamento: z.string().trim().optional().nullable(),
  jornada: z.string().trim().optional().nullable(),
});

rotasAdmin.post(
  "/funcionarios/importar",
  soAdmin,
  rota(async (req, res) => {
    const empresaId = eid(req);
    const { linhas, convites } = z
      .object({ linhas: z.array(z.record(z.string(), z.unknown())).min(1).max(2000), convites: z.boolean().default(false) })
      .parse(req.body);
    const jornadas = await prisma.jornada.findMany({ where: { empresaId } });
    const departamentos = new Map(
      (await prisma.departamento.findMany({ where: { empresaId } })).map((d) => [d.nome.toLowerCase(), d.id]),
    );
    const emp = await prisma.empresa.findUniqueOrThrow({ where: { id: empresaId } });
    const limite = limiteFuncionarios(emp.plano);
    let ativos = await prisma.funcionario.count({ where: { empresaId, ativo: true } });

    const relatorio = { criados: 0, atualizados: 0, erros: [] as { linha: number; erro: string }[], convites: [] as { nome: string; link: string }[] };
    for (const [i, bruta] of linhas.entries()) {
      const n = i + 2; // linha 1 da planilha é o cabeçalho
      try {
        const l = esquemaLinhaImportacao.parse(bruta);
        let admissao = l.admissao || null;
        if (admissao && /^\d{2}\/\d{2}\/\d{4}$/.test(admissao)) admissao = admissao.split("/").reverse().join("-");
        let departamentoId: string | null = null;
        if (l.departamento) {
          departamentoId = departamentos.get(l.departamento.toLowerCase()) ?? null;
          if (!departamentoId) {
            const novo = await prisma.departamento.create({ data: { empresaId, nome: l.departamento } });
            departamentos.set(l.departamento.toLowerCase(), novo.id);
            departamentoId = novo.id;
          }
        }
        const jornada = l.jornada ? jornadas.find((j) => j.nome.toLowerCase() === l.jornada!.toLowerCase()) : null;
        if (l.jornada && !jornada) throw new Error(`jornada "${l.jornada}" não existe`);
        const cpfLimpo = l.cpf.replace(/\D/g, "");
        const existente = await prisma.funcionario.findUnique({ where: { empresaId_cpf: { empresaId, cpf: cpfLimpo } } });
        // Coluna vazia não apaga o que já está no cadastro (undefined = não mexe)
        const ou = <T>(v: T | null | undefined | "") => (v ? v : undefined);
        const dados = esquemaFuncionario.parse({
          nome: l.nome, cpf: l.cpf, matricula: ou(l.matricula), pis: ou(l.pis), cargo: ou(l.cargo),
          admissao: ou(admissao), departamentoId: ou(departamentoId),
          // Funcionário novo sem jornada na planilha: usa a única jornada da empresa, se houver só uma
          jornadaId: jornada?.id ?? (!existente && jornadas.length === 1 ? jornadas[0].id : undefined),
        });
        const d = await validarReferencias(empresaId, dados);
        if (!existente && limite !== null && ativos >= limite) throw new Error(`limite de ${limite} funcionários do plano atingido`);
        const f = existente
          ? await prisma.funcionario.update({ where: { id: existente.id }, data: dadosFuncionario(d) })
          : await prisma.funcionario.create({ data: { ...dadosFuncionario(d), empresaId, exigeGps: true, exigeSelfie: true } });
        if (existente) relatorio.atualizados++;
        else {
          relatorio.criados++;
          ativos++;
        }
        if (l.email) {
          const link = await salvarAcesso(empresaId, f, { email: l.email, convite: convites });
          if (link) relatorio.convites.push({ nome: f.nome, link });
        }
      } catch (e) {
        const msg = e instanceof z.ZodError ? e.issues.map((x) => x.message).join("; ") : (e as Error).message;
        relatorio.erros.push({ linha: n, erro: msg });
      }
    }
    res.json(relatorio);
  }),
);
