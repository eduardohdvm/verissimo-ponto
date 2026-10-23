// API pública de integração (ERP, folha de pagamento). Autenticada por chave de API.
// Documentação: docs/integracao-erp.md
import { Router } from "express";
import { z } from "zod";
import { autenticarApiKey } from "../auth.js";
import { prisma } from "../db.js";
import { naoEncontrado } from "../lib/erros.js";
import { isoComOffset, somarDias, utcDeLocal } from "../lib/tempo.js";
import { dadosFuncionario, esquemaFuncionario, esquemaPeriodo } from "../services/cadastros.js";
import { gerarEspelho } from "../services/espelho.js";
import { dispararWebhook } from "../services/webhooks.js";
import { rota } from "./util.js";

export const rotasApiV1 = Router();
rotasApiV1.use(autenticarApiKey);

const eid = (req: { empresaApiId?: string }) => req.empresaApiId!;

rotasApiV1.get(
  "/funcionarios",
  rota(async (req, res) => {
    res.json(
      await prisma.funcionario.findMany({
        where: { empresaId: eid(req) },
        select: {
          id: true,
          codigoExterno: true,
          nome: true,
          cpf: true,
          pis: true,
          matricula: true,
          cargo: true,
          admissao: true,
          ativo: true,
          jornadaId: true,
        },
        orderBy: { nome: "asc" },
      }),
    );
  }),
);

/** Cria ou atualiza o funcionário pelo id do ERP (idempotente). */
rotasApiV1.put(
  "/funcionarios/:codigoExterno",
  rota(async (req, res) => {
    const d = dadosFuncionario(esquemaFuncionario.parse({ ...req.body, codigoExterno: req.params.codigoExterno }));
    if (d.jornadaId && !(await prisma.jornada.findFirst({ where: { id: d.jornadaId, empresaId: eid(req) } }))) {
      throw naoEncontrado("Jornada");
    }
    const chave = { empresaId_codigoExterno: { empresaId: eid(req), codigoExterno: req.params.codigoExterno } };
    const existente = await prisma.funcionario.findUnique({ where: chave });
    const f = existente
      ? await prisma.funcionario.update({ where: chave, data: d })
      : await prisma.funcionario.create({ data: { ...d, empresaId: eid(req) } });
    dispararWebhook(eid(req), "funcionario.alterado", f);
    res.status(existente ? 200 : 201).json(f);
  }),
);

rotasApiV1.get(
  "/jornadas",
  rota(async (req, res) => {
    const lista = await prisma.jornada.findMany({ where: { empresaId: eid(req) } });
    res.json(lista.map((j) => ({ id: j.id, nome: j.nome, toleranciaMin: j.toleranciaMin, config: JSON.parse(j.horarios) })));
  }),
);

/** Marcações originais do período (ex.: para o ERP guardar uma cópia). Paginação por NSR. */
rotasApiV1.get(
  "/marcacoes",
  rota(async (req, res) => {
    const p = esquemaPeriodo.parse(req.query);
    const aposNsr = Number(req.query.aposNsr ?? 0);
    const emp = await prisma.empresa.findUniqueOrThrow({ where: { id: eid(req) } });
    const lista = await prisma.marcacao.findMany({
      where: {
        empresaId: emp.id,
        nsr: { gt: aposNsr },
        dataHora: {
          gte: utcDeLocal(p.inicio, "00:00", emp.fusoHorario),
          lt: utcDeLocal(somarDias(p.fim, 1), "00:00", emp.fusoHorario),
        },
      },
      include: { funcionario: { select: { codigoExterno: true, cpf: true } } },
      orderBy: { nsr: "asc" },
      take: 1000,
    });
    res.json({
      dados: lista.map((m) => ({
        nsr: m.nsr,
        funcionarioId: m.funcionarioId,
        codigoExterno: m.funcionario.codigoExterno,
        cpf: m.funcionario.cpf,
        dataHora: isoComOffset(m.dataHora, emp.fusoHorario),
        origem: m.origem,
        online: m.online,
        hash: m.hash,
      })),
      proximoNsr: lista.length === 1000 ? lista[lista.length - 1].nsr : null,
    });
  }),
);

/**
 * Totais por funcionário no período, prontos para a folha de pagamento.
 * Filtre um funcionário com ?codigoExterno=...
 */
rotasApiV1.get(
  "/espelho",
  rota(async (req, res) => {
    const p = esquemaPeriodo.parse(req.query);
    const codigoExterno = z.string().optional().parse(req.query.codigoExterno);
    const funcionarios = await prisma.funcionario.findMany({
      where: { empresaId: eid(req), ativo: true, ...(codigoExterno ? { codigoExterno } : {}) },
      select: { id: true },
    });
    const detalhado = req.query.detalhado === "true";
    const resultado = [];
    for (const f of funcionarios) {
      const e = await gerarEspelho(eid(req), f.id, p.inicio, p.fim);
      resultado.push({ funcionario: e.funcionario, totais: e.totais, ...(detalhado ? { dias: e.dias } : {}) });
    }
    res.json({ periodo: p, funcionarios: resultado });
  }),
);
