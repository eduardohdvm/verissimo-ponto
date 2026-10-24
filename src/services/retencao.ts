// LGPD: apaga as fotos (selfies e tentativas recusadas) mais antigas que o prazo de cada empresa.
// A marcação continua guardada (obrigação legal); só a imagem é removida.
import { unlink } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../db.js";
import { PASTA_UPLOADS } from "./facial.js";

const apagar = (relativo: string) => unlink(path.join(PASTA_UPLOADS, relativo)).catch(() => {});

export async function apagarFotosVencidas() {
  const empresas = await prisma.empresa.findMany({ select: { id: true, retencaoFotosDias: true } });
  let total = 0;
  for (const e of empresas) {
    const limite = new Date(Date.now() - e.retencaoFotosDias * 86400_000);
    for (;;) {
      const lote = await prisma.marcacao.findMany({
        where: { empresaId: e.id, selfie: { not: null }, dataHora: { lt: limite } },
        select: { id: true, selfie: true },
        take: 500,
      });
      if (!lote.length) break;
      for (const m of lote) await apagar(m.selfie!);
      await prisma.marcacao.updateMany({ where: { id: { in: lote.map((m) => m.id) } }, data: { selfie: null } });
      total += lote.length;
    }
    const tentativas = await prisma.tentativaRecusada.findMany({
      where: { empresaId: e.id, foto: { not: null }, criadoEm: { lt: limite } },
      select: { id: true, foto: true },
    });
    for (const t of tentativas) await apagar(t.foto!);
    if (tentativas.length) {
      await prisma.tentativaRecusada.updateMany({ where: { id: { in: tentativas.map((t) => t.id) } }, data: { foto: null } });
      total += tentativas.length;
    }
  }
  if (total) console.log(`LGPD: ${total} foto(s) vencida(s) apagada(s)`);
  return total;
}

export function iniciarRetencao() {
  const rodar = () => apagarFotosVencidas().catch((e) => console.error("Erro na retenção de fotos:", e));
  setTimeout(rodar, 60_000);
  setInterval(rodar, 6 * 3600_000);
}
