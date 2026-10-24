// Anexos enviados pelo app (foto de atestado etc.), guardados na mesma pasta das fotos.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ErroHttp } from "../lib/erros.js";
import { PASTA_UPLOADS } from "./facial.js";

const TIPOS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf" };

/** Recebe um data URL (data:image/jpeg;base64,...) e devolve o caminho relativo salvo. */
export async function salvarAnexo(empresaId: string, prefixo: string, dataUrl: string): Promise<string> {
  const m = dataUrl.match(/^data:([\w/+.-]+);base64,(.+)$/);
  const ext = m && TIPOS[m[1]];
  if (!m || !ext) throw new ErroHttp(400, "Envie uma foto (JPG ou PNG) ou um PDF");
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > 4 * 1024 * 1024) throw new ErroHttp(413, "Arquivo muito grande (máximo 4 MB)");
  await mkdir(path.join(PASTA_UPLOADS, empresaId), { recursive: true });
  const relativo = `${empresaId}/${prefixo}-${randomUUID()}.${ext}`;
  await writeFile(path.join(PASTA_UPLOADS, relativo), bytes);
  return relativo;
}
