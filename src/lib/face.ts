// Reconhecimento facial no servidor (face-api + TensorFlow.js em WebAssembly, sem binário nativo).
// O navegador só guia o usuário; quem decide se o rosto confere é sempre o servidor.
import { createRequire } from "node:module";
import path from "node:path";
import jpeg from "jpeg-js";
import { ErroHttp } from "./erros.js";

const require = createRequire(import.meta.url);

/**
 * O reconhecimento facial usa ~500 MB de memória. Com FACIAL_ATIVO=false (ex.: Render grátis,
 * que tem 512 MB) as bibliotecas nem são carregadas e quem exige facial bate ponto com selfie simples.
 */
export const FACIAL_ATIVO = process.env.FACIAL_ATIVO !== "false";

const PASTA_MODELOS = path.join(path.dirname(require.resolve("@vladmandic/face-api/package.json")), "model");

// Carregados só quando o facial é usado, para não ocupar memória quando está desligado
let tf!: typeof import("@tensorflow/tfjs");
let faceapi!: typeof import("@vladmandic/face-api");
let pronto: Promise<void> | null = null;

export function iniciarFace(): Promise<void> {
  if (!FACIAL_ATIVO) return Promise.reject(new ErroHttp(503, "Reconhecimento facial desativado neste servidor"));
  pronto ??= (async () => {
    tf = require("@tensorflow/tfjs");
    const wasm = require("@tensorflow/tfjs-backend-wasm") as typeof import("@tensorflow/tfjs-backend-wasm");
    faceapi = require("@vladmandic/face-api/dist/face-api.node-wasm.js");
    wasm.setWasmPaths(path.dirname(require.resolve("@tensorflow/tfjs-backend-wasm")) + path.sep);
    await tf.setBackend("wasm");
    await tf.ready();
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromDisk(PASTA_MODELOS),
      faceapi.nets.faceLandmark68Net.loadFromDisk(PASTA_MODELOS),
      faceapi.nets.faceRecognitionNet.loadFromDisk(PASTA_MODELOS),
    ]);
  })();
  return pronto;
}

export interface RostoAnalisado {
  descritor: number[]; // 128 números que representam o rosto
  rotacao: number; // < 0 = virado para a direita da pessoa, > 0 = para a esquerda, ~0 = de frente
  tamanho: number; // largura do rosto em relação à largura da imagem
}

export function decodificarJpeg(base64: string): Buffer {
  return Buffer.from(base64.replace(/^data:image\/\w+;base64,/, ""), "base64");
}

/**
 * Rotação horizontal da cabeça a partir dos 68 pontos do rosto: deslocamento da ponta do nariz
 * em relação ao centro dos olhos, dividido pela distância entre os olhos.
 * Mesma fórmula usada no navegador (public/face-cliente.js).
 */
export function calcularRotacao(pontos: { x: number; y: number }[]): number {
  const olhoA = pontos[36];
  const olhoB = pontos[45];
  const nariz = pontos[30];
  const centro = (olhoA.x + olhoB.x) / 2;
  const distOlhos = Math.hypot(olhoB.x - olhoA.x, olhoB.y - olhoA.y) || 1;
  return (nariz.x - centro) / distOlhos;
}

export async function analisarRosto(imagem: Buffer): Promise<RostoAnalisado> {
  await iniciarFace();
  let px: jpeg.UintArrRet;
  try {
    px = jpeg.decode(imagem, { useTArray: true, maxMemoryUsageInMB: 64 });
  } catch {
    throw new ErroHttp(400, "Imagem inválida");
  }
  const rgb = new Uint8Array(px.width * px.height * 3);
  for (let i = 0, j = 0; i < px.data.length; i += 4, j += 3) {
    rgb[j] = px.data[i];
    rgb[j + 1] = px.data[i + 1];
    rgb[j + 2] = px.data[i + 2];
  }
  const tensor = tf.tensor3d(rgb, [px.height, px.width, 3], "int32");
  try {
    const rostos = await faceapi
      .detectAllFaces(tensor as never, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptors();
    if (rostos.length === 0) throw new ErroHttp(422, "Nenhum rosto encontrado na foto");
    if (rostos.length > 1) throw new ErroHttp(422, "Mais de um rosto na foto: fique sozinho na frente da câmera");
    const r = rostos[0];
    return {
      descritor: Array.from(r.descriptor),
      rotacao: calcularRotacao(r.landmarks.positions),
      tamanho: r.detection.box.width / px.width,
    };
  } finally {
    tensor.dispose();
  }
}

/** Distância euclidiana entre dois rostos: quanto menor, mais parecidos (mesma pessoa costuma ficar < 0,5). */
export function distanciaRostos(a: number[], b: number[]): number {
  let soma = 0;
  for (let i = 0; i < a.length; i++) soma += (a[i] - b[i]) ** 2;
  return Math.sqrt(soma);
}
