// Certificado digital ICP-Brasil (A1, arquivo .pfx) usado para assinar o AFD (.p7s, CMS destacado)
// e o comprovante de ponto em PDF. Configure CERT_PFX_BASE64 (o .pfx em base64) e CERT_SENHA.
// Sem certificado, os arquivos saem sem assinatura e o painel avisa.
import { readFileSync } from "node:fs";
import forge from "node-forge";
import { ErroHttp } from "../lib/erros.js";

interface Certificado {
  pfx: Buffer;
  senha: string;
  chave: forge.pki.PrivateKey;
  cert: forge.pki.Certificate;
  cadeia: forge.pki.Certificate[];
  titular: string;
  validoAte: Date;
}

let cache: Certificado | null | undefined;

export function carregarCertificado(): Certificado | null {
  if (cache !== undefined) return cache;
  const base64 = process.env.CERT_PFX_BASE64 ?? (process.env.CERT_PFX_ARQUIVO ? readFileSync(process.env.CERT_PFX_ARQUIVO).toString("base64") : "");
  if (!base64) return (cache = null);
  const senha = process.env.CERT_SENHA ?? "";
  const pfx = Buffer.from(base64, "base64");
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(pfx.toString("binary")), senha);
  const chaves = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [];
  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []).map((b) => b.cert!).filter(Boolean);
  const chave = chaves[0]?.key;
  if (!chave || !certs.length) throw new Error("Certificado digital sem chave privada ou sem certificado");
  // O certificado do titular é o que não emitiu nenhum outro da cadeia
  const cert = certs.find((c) => !certs.some((o) => o !== c && o.issuer.hash === c.subject.hash)) ?? certs[0];
  const cn = cert.subject.getField("CN")?.value ?? "";
  cache = { pfx, senha, chave, cert, cadeia: certs, titular: String(cn), validoAte: cert.validity.notAfter };
  return cache;
}

export function situacaoCertificado() {
  try {
    const c = carregarCertificado();
    return c ? { configurado: true, titular: c.titular, validoAte: c.validoAte, vencido: c.validoAte < new Date() } : { configurado: false };
  } catch (e) {
    return { configurado: false, erro: (e as Error).message };
  }
}

/** Assinatura CMS (PKCS#7) destacada, SHA-256, com data da assinatura: o arquivo .p7s que acompanha o AFD. */
export function assinarDestacado(conteudo: Buffer): Buffer {
  const c = carregarCertificado();
  if (!c) throw new ErroHttp(409, "Nenhum certificado digital configurado. Veja \"Certificado digital\" no README.");
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(conteudo.toString("binary"));
  for (const cert of c.cadeia) p7.addCertificate(cert);
  p7.addSigner({
    key: c.chave as forge.pki.rsa.PrivateKey,
    certificate: c.cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() as unknown as string },
    ],
  });
  p7.sign({ detached: true });
  return Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), "binary");
}
