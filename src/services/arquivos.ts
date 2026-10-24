// Anexos enviados pelo app ou pelo RH (foto de atestado, contracheque, imagem de comunicado, logo),
// guardados na mesma pasta das fotos.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ErroHttp } from "../lib/erros.js";
import { PASTA_UPLOADS } from "./facial.js";

const TIPOS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf" };

/** Recebe um data URL (data:image/jpeg;base64,...) e salva. `soImagem` recusa PDF. */
export async function salvarArquivo(empresaId: string, prefixo: string, dataUrl: string, { soImagem = false } = {}) {
  const m = dataUrl.match(/^data:([\w/+.-]+);base64,(.+)$/);
  const ext = m && TIPOS[m[1]];
  if (!m || !ext || (soImagem && ext === "pdf")) {
    throw new ErroHttp(400, soImagem ? "Envie uma imagem JPG ou PNG" : "Envie uma foto (JPG ou PNG) ou um PDF");
  }
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > 4 * 1024 * 1024) throw new ErroHttp(413, "Arquivo muito grande (máximo 4 MB)");
  await mkdir(path.join(PASTA_UPLOADS, empresaId), { recursive: true });
  const caminho = `${empresaId}/${prefixo}-${randomUUID()}.${ext}`;
  await writeFile(path.join(PASTA_UPLOADS, caminho), bytes);
  return { caminho, hash: createHash("sha256").update(bytes).digest("hex"), tipo: m[1] };
}

export async function salvarAnexo(empresaId: string, prefixo: string, dataUrl: string): Promise<string> {
  return (await salvarArquivo(empresaId, prefixo, dataUrl)).caminho;
}

export const caminhoAbsoluto = (relativo: string) => path.join(PASTA_UPLOADS, relativo);
