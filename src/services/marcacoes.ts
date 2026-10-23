import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../db.js";
import { ErroHttp } from "../lib/erros.js";
import { decodificarJpeg, FACIAL_ATIVO } from "../lib/face.js";
import { distanciaMetros } from "../lib/geo.js";
import { isoComOffset } from "../lib/tempo.js";
import { PASTA_UPLOADS, verificarRosto, type Quadro } from "./facial.js";
import { dispararWebhook } from "./webhooks.js";

export { PASTA_UPLOADS };
const MAX_OFFLINE_MS = 7 * 86400_000;

export interface NovaMarcacao {
  empresaId: string;
  funcionarioId: string;
  origem: "WEB" | "MOBILE";
  latitude?: number;
  longitude?: number;
  precisaoGps?: number;
  selfieBase64?: string; // data URL ou base64 puro de um JPEG
  dataHoraOffline?: string; // marcação feita sem internet e sincronizada depois
  desafioId?: string; // prova de vida (reconhecimento facial)
  quadros?: Quadro[];
  ip?: string;
  userAgent?: string;
}

export async function registrarMarcacao(n: NovaMarcacao) {
  const func = await prisma.funcionario.findFirst({
    where: { id: n.funcionarioId, empresaId: n.empresaId },
    include: { empresa: { include: { locais: true } } },
  });
  if (!func || !func.ativo) throw new ErroHttp(403, "Funcionário inativo ou não encontrado");

  let dataHora = new Date();
  let online = true;
  if (n.dataHoraOffline) {
    const d = new Date(n.dataHoraOffline);
    const idade = Date.now() - d.getTime();
    if (isNaN(d.getTime()) || idade < -60_000 || idade > MAX_OFFLINE_MS) {
      throw new ErroHttp(400, "Horário da marcação offline inválido");
    }
    dataHora = d;
    online = false;
  }

  let localId: string | null = null;
  if (func.exigeGps) {
    if (n.latitude == null || n.longitude == null) throw new ErroHttp(400, "Ative a localização para bater o ponto");
    const locais = func.empresa.locais;
    if (locais.length) {
      const local = locais.find((l) => distanciaMetros(l.latitude, l.longitude, n.latitude!, n.longitude!) <= l.raioMetros);
      if (!local) throw new ErroHttp(403, "Você está fora dos locais permitidos para registro de ponto");
      localId = local.id;
    }
  }

  // Bloqueia marcação duplicada por clique duplo
  const recente = await prisma.marcacao.findFirst({
    where: { funcionarioId: func.id, dataHora: { gte: new Date(dataHora.getTime() - 60_000), lte: dataHora } },
  });
  if (recente) throw new ErroHttp(409, "Você já registrou o ponto há menos de 1 minuto");

  let fotoBytes: Buffer | null = null;
  let distanciaFacial: number | null = null;
  let provaVida: string | null = null;
  if (func.exigeFacial && FACIAL_ATIVO) {
    const v = await verificarRosto({
      empresaId: n.empresaId,
      funcionarioId: func.id,
      descritorCadastro: func.descritorFacial,
      limiar: func.empresa.limiarFacial,
      desafioId: n.desafioId,
      quadros: n.quadros,
      offline: !online,
      ip: n.ip,
    });
    fotoBytes = v.foto;
    distanciaFacial = v.distancia;
    provaVida = v.provaVida;
  } else if (func.exigeSelfie || func.exigeFacial) {
    if (!n.selfieBase64) throw new ErroHttp(400, "A foto é obrigatória para bater o ponto");
    fotoBytes = decodificarJpeg(n.selfieBase64);
    if (fotoBytes.length < 1000 || fotoBytes.length > 2_000_000) throw new ErroHttp(400, "Foto inválida");
  }

  let selfie: string | null = null;
  if (fotoBytes) {
    await mkdir(path.join(PASTA_UPLOADS, n.empresaId), { recursive: true });
    selfie = `${n.empresaId}/${randomUUID()}.jpg`;
    await writeFile(path.join(PASTA_UPLOADS, selfie), fotoBytes);
  }

  const marcacao = await prisma.$transaction(async (tx) => {
    // O incremento trava a linha da empresa, garantindo NSR sequencial sem buracos
    const emp = await tx.empresa.update({ where: { id: n.empresaId }, data: { ultimoNsr: { increment: 1 } } });
    const hash = createHash("sha256")
      .update([emp.ultimoHash, emp.id, func.id, emp.ultimoNsr, dataHora.toISOString()].join("|"))
      .digest("hex");
    await tx.empresa.update({ where: { id: emp.id }, data: { ultimoHash: hash } });
    return tx.marcacao.create({
      data: {
        empresaId: emp.id,
        funcionarioId: func.id,
        nsr: emp.ultimoNsr,
        dataHora,
        origem: n.origem,
        online,
        latitude: n.latitude,
        longitude: n.longitude,
        precisaoGps: n.precisaoGps,
        localId,
        selfie,
        distanciaFacial,
        provaVida,
        ip: n.ip,
        userAgent: n.userAgent?.slice(0, 300),
        hash,
      },
    });
  });

  const comprovante = montarComprovante(marcacao, func, func.empresa);
  dispararWebhook(n.empresaId, "marcacao.criada", {
    ...comprovante,
    funcionarioId: func.id,
    codigoExterno: func.codigoExterno,
  });
  return comprovante;
}

/** Dados do comprovante de registro de ponto entregue ao trabalhador. */
export function montarComprovante(
  m: { id: string; nsr: number; dataHora: Date; hash: string; origem: string; online: boolean },
  f: { nome: string; cpf: string },
  e: { razaoSocial: string; cnpj: string; fusoHorario: string },
) {
  return {
    id: m.id,
    nsr: m.nsr,
    empregador: e.razaoSocial,
    cnpj: e.cnpj,
    trabalhador: f.nome,
    cpf: f.cpf,
    dataHora: isoComOffset(m.dataHora, e.fusoHorario),
    origem: m.origem,
    online: m.online,
    hash: m.hash,
  };
}
