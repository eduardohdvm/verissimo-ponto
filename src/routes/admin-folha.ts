// Exportação para a folha (só ADMIN).
import { Router } from "express";
import { z } from "zod";
import { autenticar, exigirPapel } from "../auth.js";
import { esquemaPeriodo } from "../services/cadastros.js";
import { esquemaConfigFolha, exportarFolha, lerConfigFolha, salvarConfigFolha } from "../services/folha.js";
import { rota, sessao } from "./util.js";

export const rotasFolha = Router();
rotasFolha.use("/folha", autenticar, exigirPapel("ADMIN"));
const eid = (req: Parameters<typeof sessao>[0]) => sessao(req).empresaId;

rotasFolha.get("/folha/config", rota(async (req, res) => res.json(await lerConfigFolha(eid(req)))));

rotasFolha.put(
  "/folha/config",
  rota(async (req, res) => {
    const c = esquemaConfigFolha.parse(req.body);
    await salvarConfigFolha(eid(req), c);
    res.json(c);
  }),
);

rotasFolha.get(
  "/folha/exportar",
  rota(async (req, res) => {
    const p = esquemaPeriodo.parse(req.query);
    const previa = z.enum(["true", "false"]).optional().parse(req.query.previa) === "true";
    const r = await exportarFolha(eid(req), p.inicio, p.fim, await lerConfigFolha(eid(req)));
    if (previa) return res.json({ funcionarios: r.funcionarios, semIdentificador: r.semIdentificador, amostra: r.conteudo.slice(1, 2000) });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="folha_${p.inicio.slice(0, 7)}.csv"`);
    res.send(r.conteudo);
  }),
);
