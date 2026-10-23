// Guia da prova de vida no navegador: detecta o rosto na câmera, pede os movimentos sorteados
// e tira uma foto automaticamente quando a pessoa está na posição certa.
// A decisão final (posição e se o rosto confere) é sempre do servidor.

let faceapi = null;
let carregando = null;

export function carregarModelos() {
  carregando ??= (async () => {
    faceapi = await import("/vendor/face-api.esm.js");
    await faceapi.nets.tinyFaceDetector.loadFromUri("/modelos");
    await faceapi.nets.faceLandmark68Net.loadFromUri("/modelos");
    // A primeira detecção compila os shaders da GPU (vários segundos). Faz isso agora,
    // enquanto a tela carrega, e não na hora em que o funcionário vai bater o ponto.
    const aquecimento = document.createElement("canvas");
    aquecimento.width = aquecimento.height = 320;
    await faceapi.detectAllFaces(aquecimento, new faceapi.TinyFaceDetectorOptions({ inputSize: 320 })).withFaceLandmarks();
  })();
  return carregando;
}

/** Mesma fórmula do servidor (src/lib/face.ts): > 0 = virou para a esquerda da pessoa. */
export function calcularRotacao(pontos) {
  const olhoA = pontos[36];
  const olhoB = pontos[45];
  const nariz = pontos[30];
  const distOlhos = Math.hypot(olhoB.x - olhoA.x, olhoB.y - olhoA.y) || 1;
  return (nariz.x - (olhoA.x + olhoB.x) / 2) / distOlhos;
}

export const INSTRUCOES = {
  FRENTE: "Olhe de frente para a câmera",
  ESQUERDA: "Vire o rosto devagar para a sua esquerda",
  DIREITA: "Vire o rosto devagar para a sua direita",
};

// Mais exigente que o servidor, para a foto chegar lá com folga
function naPosicao(passo, rot) {
  if (passo === "FRENTE") return Math.abs(rot) < 0.12;
  return passo === "ESQUERDA" ? rot > 0.28 : rot < -0.28;
}

/** Captura o quadro atual do vídeo em JPEG, sem espelhar (o servidor espera a imagem real). */
export function capturar(video, largura = 480) {
  const canvas = document.createElement("canvas");
  canvas.width = largura;
  canvas.height = Math.round((video.videoHeight / video.videoWidth) * largura) || 360;
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Executa os passos do desafio. `aviso(texto, progresso)` atualiza a tela.
 * Devolve [{ passo, imagem }] ou lança erro se o tempo acabar.
 */
export async function executarDesafio(video, passos, aviso, { tempoLimiteMs = 25_000 } = {}) {
  await carregarModelos();
  const opcoes = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
  const fim = Date.now() + tempoLimiteMs;
  const quadros = [];

  for (let i = 0; i < passos.length; i++) {
    const passo = passos[i];
    let seguidos = 0;
    aviso(INSTRUCOES[passo], i / passos.length);
    while (true) {
      if (Date.now() > fim) throw new Error("Tempo esgotado. Toque em Registrar ponto para tentar de novo.");
      const rostos = await faceapi.detectAllFaces(video, opcoes).withFaceLandmarks();
      if (rostos.length === 0) {
        seguidos = 0;
        aviso(`${INSTRUCOES[passo]}. Rosto não encontrado.`, i / passos.length);
      } else if (rostos.length > 1) {
        seguidos = 0;
        aviso("Só uma pessoa na frente da câmera", i / passos.length);
      } else {
        const rot = calcularRotacao(rostos[0].landmarks.positions);
        const tamanho = rostos[0].detection.box.width / video.videoWidth;
        if (tamanho < 0.18) {
          seguidos = 0;
          aviso("Aproxime o rosto da câmera", i / passos.length);
        } else if (naPosicao(passo, rot)) {
          // Algumas leituras seguidas na posição evitam foto tremida no meio do movimento
          if (++seguidos >= 3) {
            quadros.push({ passo, imagem: capturar(video) });
            aviso("Pronto!", (i + 1) / passos.length);
            await esperar(300);
            break;
          }
        } else {
          seguidos = 0;
          aviso(INSTRUCOES[passo], i / passos.length);
        }
      }
      await esperar(80);
    }
  }
  return quadros;
}

/** Desafio sorteado no aparelho, só para quando não há internet (o servidor marca como OFFLINE). */
export function desafioLocal() {
  return ["FRENTE", crypto.getRandomValues(new Uint8Array(1))[0] % 2 ? "ESQUERDA" : "DIREITA"];
}
