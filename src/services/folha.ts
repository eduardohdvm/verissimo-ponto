// Exportação para a folha de pagamento: arquivo de eventos configurável (código de cada evento,
// separador, formato das horas), compatível com a importação de "eventos variáveis" dos sistemas de folha.
import { z } from "zod";
import { prisma } from "../db.js";
import { gerarEspelho, type Espelho } from "./espelho.js";

export const esquemaConfigFolha = z.object({
  formato: z.enum(["EVENTOS", "RESUMO"]),
  separador: z.enum([";", ",", "TAB"]),
  formatoHoras: z.enum(["HH:MM", "DECIMAL"]),
  identificador: z.enum(["MATRICULA", "CPF", "CODIGO_EXTERNO"]),
  cabecalho: z.boolean(),
  // código do evento na folha; vazio = não exporta
  codigos: z.object({
    trabalhadas: z.string().max(20),
    noturno: z.string().max(20),
    faltas: z.string().max(20),
    atrasos: z.string().max(20),
    debito: z.string().max(20),
    extras: z.record(z.string(), z.string().max(20)), // percentual -> código
  }),
});
export type ConfigFolha = z.infer<typeof esquemaConfigFolha>;

export const CONFIG_FOLHA_PADRAO: ConfigFolha = {
  formato: "EVENTOS",
  separador: ";",
  formatoHoras: "DECIMAL",
  identificador: "MATRICULA",
  cabecalho: true,
  codigos: { trabalhadas: "", noturno: "", faltas: "", atrasos: "", debito: "", extras: {} },
};

const chave = (empresaId: string) => `folha:${empresaId}`;

export async function lerConfigFolha(empresaId: string): Promise<ConfigFolha> {
  const c = await prisma.configSistema.findUnique({ where: { chave: chave(empresaId) } });
  try {
    return c ? esquemaConfigFolha.parse(JSON.parse(c.valor)) : CONFIG_FOLHA_PADRAO;
  } catch {
    return CONFIG_FOLHA_PADRAO;
  }
}

export async function salvarConfigFolha(empresaId: string, config: ConfigFolha) {
  const valor = JSON.stringify(config);
  await prisma.configSistema.upsert({ where: { chave: chave(empresaId) }, create: { chave: chave(empresaId), valor }, update: { valor } });
}

const horas = (min: number, fmt: ConfigFolha["formatoHoras"]) =>
  fmt === "DECIMAL"
    ? (min / 60).toFixed(2).replace(".", ",")
    : `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

function identificar(e: Espelho, c: ConfigFolha) {
  const f = e.funcionario;
  return (c.identificador === "CPF" ? f.cpf : c.identificador === "CODIGO_EXTERNO" ? f.codigoExterno : f.matricula) ?? "";
}

/** Valores por evento de um espelho: [chave, código, quantidade formatada]. */
function eventos(e: Espelho, c: ConfigFolha): { nome: string; codigo: string; valor: string; bruto: number }[] {
  const t = e.totais;
  const lista = [
    { nome: "Horas trabalhadas", codigo: c.codigos.trabalhadas, bruto: t.trabalhadoMin, valor: horas(t.trabalhadoMin, c.formatoHoras) },
    ...Object.entries(t.extras).map(([p, min]) => ({
      nome: `Hora extra ${p}%`, codigo: c.codigos.extras[p] ?? "", bruto: min, valor: horas(min, c.formatoHoras),
    })),
    { nome: "Adicional noturno (horas)", codigo: c.codigos.noturno, bruto: t.noturnoReduzidoMin, valor: horas(t.noturnoReduzidoMin, c.formatoHoras) },
    { nome: "Faltas (dias)", codigo: c.codigos.faltas, bruto: t.faltas, valor: String(t.faltas) },
    { nome: "Atrasos (horas)", codigo: c.codigos.atrasos, bruto: t.atrasoMin, valor: horas(t.atrasoMin, c.formatoHoras) },
    { nome: "Horas a descontar", codigo: c.codigos.debito, bruto: t.debitoMin, valor: horas(t.debitoMin, c.formatoHoras) },
  ];
  return lista;
}

export async function exportarFolha(empresaId: string, inicio: string, fim: string, c: ConfigFolha) {
  const funcionarios = await prisma.funcionario.findMany({
    where: { empresaId, ativo: true },
    orderBy: { nome: "asc" },
    select: { id: true },
  });
  const espelhos: Espelho[] = [];
  for (const f of funcionarios) espelhos.push(await gerarEspelho(empresaId, f.id, inicio, fim));

  const sep = c.separador === "TAB" ? "\t" : c.separador;
  const linhas: string[][] = [];
  const competencia = inicio.slice(0, 7).replace("-", "");
  const semIdentificador: string[] = [];

  if (c.formato === "EVENTOS") {
    if (c.cabecalho) linhas.push(["identificador", "competencia", "evento", "quantidade"]);
    for (const e of espelhos) {
      const id = identificar(e, c);
      if (!id) semIdentificador.push(e.funcionario.nome);
      for (const ev of eventos(e, c)) if (ev.codigo && ev.bruto > 0) linhas.push([id, competencia, ev.codigo, ev.valor]);
    }
  } else {
    const nomes = espelhos.length ? eventos(espelhos[0], c).map((ev) => ev.nome) : [];
    const percentuais = [...new Set(espelhos.flatMap((e) => Object.keys(e.totais.extras)))];
    if (c.cabecalho) {
      linhas.push(["identificador", "nome", "competencia", "Horas trabalhadas", ...percentuais.map((p) => `Hora extra ${p}%`),
        ...nomes.filter((n) => !n.startsWith("Hora extra") && n !== "Horas trabalhadas"), "Saldo banco (min)"]);
    }
    for (const e of espelhos) {
      const id = identificar(e, c);
      if (!id) semIdentificador.push(e.funcionario.nome);
      const evs = eventos(e, c);
      const valor = (nome: string) => evs.find((ev) => ev.nome === nome)?.valor ?? horas(0, c.formatoHoras);
      linhas.push([
        id, e.funcionario.nome, competencia, valor("Horas trabalhadas"),
        ...percentuais.map((p) => horas(e.totais.extras[p] ?? 0, c.formatoHoras)),
        valor("Adicional noturno (horas)"), valor("Faltas (dias)"), valor("Atrasos (horas)"), valor("Horas a descontar"),
        String(e.totais.saldoBancoMin),
      ]);
    }
  }
  const escapar = (v: string) => (v.includes(sep) || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v);
  // BOM no início para o Excel abrir com acentos corretos
  const conteudo = "﻿" + linhas.map((l) => l.map(escapar).join(sep)).join("\r\n") + "\r\n";
  return { conteudo, funcionarios: espelhos.length, semIdentificador };
}
