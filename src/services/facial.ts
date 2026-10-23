// Prova de vida + comparação com o rosto do cadastro.
//
// Prova de vida ativa: o servidor sorteia um desafio (olhar de frente e virar o rosto para um
// lado). O aparelho guia a pessoa e envia uma foto por passo; o servidor confere em cada foto
// a posição da cabeça e se o rosto é o mesmo do cadastro. Uma foto impressa ou uma tela parada
// não consegue virar para o lado sorteado.
//
// Limite: não é uma detecção de ataque certificada (ISO 30107-3). Um vídeo gravado da pessoa
// virando para os dois lados ainda pode passar. Para clientes que exigem mais, plugue um
// provedor como AWS Rekognition Face Liveness em verificarRosto.
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../db.js";
import { ErroHttp } from "../lib/erros.js";
import { analisarRosto, decodificarJpeg, distanciaRostos, type RostoAnalisado } from "../lib/face.js";

export type Passo = "FRENTE" | "ESQUERDA" | "DIREITA";

export const PASTA_UPLOADS = path.resolve("uploads");

const VALIDADE_DESAFIO_MS = 2 * 60_000;
// Folga em relação ao navegador (que exige 0,12 de frente e 0,28 virado),
// porque o servidor usa outro detector de rosto e os pontos variam um pouco
const ROTACAO_MAX_FRENTE = 0.2;
const ROTACAO_MIN_VIRADO = 0.16;
const TAMANHO_MIN_ROSTO = 0.12; // rosto ocupando pelo menos 12% da largura da foto
const FOLGA_VIRADO = 0.1; // rosto de lado fica menos parecido com o cadastro (de frente)

// Desafios em memória: suficiente para um servidor. Com várias instâncias, mover para Redis/banco.
const desafios = new Map<string, { funcionarioId: string; passos: Passo[]; expira: number }>();

export function criarDesafio(funcionarioId: string) {
  const agora = Date.now();
  for (const [id, d] of desafios) if (d.expira < agora) desafios.delete(id);
  const lado: Passo = randomBytes(1)[0] % 2 ? "ESQUERDA" : "DIREITA";
  const id = randomUUID();
  const passos: Passo[] = ["FRENTE", lado];
  desafios.set(id, { funcionarioId, passos, expira: agora + VALIDADE_DESAFIO_MS });
  return { id, passos, expiraEmSeg: VALIDADE_DESAFIO_MS / 1000 };
}

function poseConfere(passo: Passo, r: RostoAnalisado): boolean {
  if (passo === "FRENTE") return Math.abs(r.rotacao) <= ROTACAO_MAX_FRENTE;
  // rotação positiva = virou para a esquerda da pessoa
  return passo === "ESQUERDA" ? r.rotacao >= ROTACAO_MIN_VIRADO : r.rotacao <= -ROTACAO_MIN_VIRADO;
}

export interface Quadro {
  passo: Passo;
  imagem: string; // JPEG em base64
}

interface ContextoVerificacao {
  empresaId: string;
  funcionarioId: string;
  descritorCadastro: string | null;
  limiar: number;
  desafioId?: string;
  quadros?: Quadro[];
  offline: boolean;
  ip?: string;
}

/** Valida prova de vida e rosto. Devolve a foto de frente (vira a selfie da marcação). */
export async function verificarRosto(c: ContextoVerificacao): Promise<{ distancia: number; foto: Buffer; provaVida: string }> {
  if (!c.descritorCadastro) {
    throw new ErroHttp(403, "Seu rosto ainda não foi cadastrado. Procure o RH para liberar o ponto.");
  }
  const quadros = c.quadros ?? [];
  if (quadros.length !== 2 || quadros[0].passo !== "FRENTE" || !["ESQUERDA", "DIREITA"].includes(quadros[1].passo)) {
    throw new ErroHttp(400, "Faça a verificação de rosto antes de bater o ponto");
  }

  // Online, o desafio precisa ter sido emitido pelo servidor para este funcionário e é de uso único.
  // Offline (sem internet no momento da marcação) o aparelho sorteia o lado; a marcação fica sinalizada.
  if (!c.offline) {
    const d = c.desafioId ? desafios.get(c.desafioId) : undefined;
    if (c.desafioId) desafios.delete(c.desafioId);
    if (!d || d.funcionarioId !== c.funcionarioId || d.expira < Date.now()) {
      throw new ErroHttp(400, "A verificação expirou. Tente de novo.");
    }
    if (d.passos.some((p, i) => quadros[i].passo !== p)) throw new ErroHttp(400, "Verificação fora da ordem pedida");
  }

  const cadastro = JSON.parse(c.descritorCadastro) as number[];
  const fotos = quadros.map((q) => {
    const b = decodificarJpeg(q.imagem);
    if (b.length < 1000 || b.length > 1_500_000) throw new ErroHttp(400, "Foto inválida");
    return b;
  });

  const recusar = async (motivo: string, distancia?: number): Promise<never> => {
    await registrarTentativa(c, motivo, fotos[0], distancia);
    throw new ErroHttp(403, motivo);
  };

  const analises: RostoAnalisado[] = [];
  for (let i = 0; i < quadros.length; i++) {
    try {
      analises.push(await analisarRosto(fotos[i]));
    } catch (e) {
      if (e instanceof ErroHttp && e.status === 422) await recusar(e.message);
      throw e;
    }
  }

  const [frente, lado] = analises;
  if (frente.tamanho < TAMANHO_MIN_ROSTO) await recusar("Aproxime o rosto da câmera");
  if (!poseConfere("FRENTE", frente)) await recusar("Prova de vida falhou: olhe de frente para a câmera");
  if (!poseConfere(quadros[1].passo, lado)) await recusar("Prova de vida falhou: o rosto não virou para o lado pedido");

  // As duas fotos precisam ser da mesma pessoa (impede trocar de rosto entre os passos)
  if (distanciaRostos(frente.descritor, lado.descritor) > 0.6) await recusar("Prova de vida falhou: rostos diferentes entre as fotos");

  const distFrente = distanciaRostos(frente.descritor, cadastro);
  const distLado = distanciaRostos(lado.descritor, cadastro);
  if (distFrente > c.limiar || distLado > c.limiar + FOLGA_VIRADO) {
    await recusar("Rosto não reconhecido", distFrente);
  }

  return { distancia: distFrente, foto: fotos[0], provaVida: c.offline ? "OFFLINE" : "SERVIDOR" };
}

async function salvarFoto(empresaId: string, nome: string, foto: Buffer) {
  const relativo = `${empresaId}/${nome}`;
  await mkdir(path.join(PASTA_UPLOADS, empresaId), { recursive: true });
  await writeFile(path.join(PASTA_UPLOADS, relativo), foto);
  return relativo;
}

async function registrarTentativa(c: ContextoVerificacao, motivo: string, foto: Buffer, distancia?: number) {
  await prisma.tentativaRecusada.create({
    data: {
      empresaId: c.empresaId,
      funcionarioId: c.funcionarioId,
      motivo,
      distanciaFacial: distancia,
      foto: await salvarFoto(c.empresaId, `recusada-${randomUUID()}.jpg`, foto),
      ip: c.ip,
    },
  });
}

/** Cadastro do rosto de referência pelo RH: uma foto de frente, nítida, só com a pessoa. */
export async function cadastrarRosto(empresaId: string, funcionarioId: string, imagemBase64: string) {
  const foto = decodificarJpeg(imagemBase64);
  if (foto.length < 1000 || foto.length > 3_000_000) throw new ErroHttp(400, "Foto inválida");
  const r = await analisarRosto(foto);
  if (Math.abs(r.rotacao) > ROTACAO_MAX_FRENTE) throw new ErroHttp(422, "Use uma foto com o rosto de frente");
  if (r.tamanho < TAMANHO_MIN_ROSTO) throw new ErroHttp(422, "O rosto está muito pequeno na foto");
  const caminho = await salvarFoto(empresaId, `cadastro-${funcionarioId}-${Date.now()}.jpg`, foto);
  return prisma.funcionario.update({
    where: { id: funcionarioId },
    data: { fotoCadastro: caminho, descritorFacial: JSON.stringify(r.descritor), facialCadastradoEm: new Date() },
    select: { id: true, facialCadastradoEm: true },
  });
}
