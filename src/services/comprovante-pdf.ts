// Comprovante de registro de ponto em PDF, assinado com o certificado da empresa quando configurado.
import { SignPdf } from "@signpdf/signpdf";
import { plainAddPlaceholder } from "@signpdf/placeholder-plain";
import { P12Signer } from "@signpdf/signer-p12";
import PDFDocument from "pdfkit";
import { carregarCertificado } from "./certificado.js";
import type { montarComprovante } from "./marcacoes.js";

type Comprovante = ReturnType<typeof montarComprovante>;

function gerarPdf(c: Comprovante): Promise<Buffer> {
  return new Promise((ok, erro) => {
    const doc = new PDFDocument({ size: [298, 420], margin: 24, compress: false, info: { Title: `Comprovante de ponto NSR ${c.nsr}` } });
    const partes: Buffer[] = [];
    doc.on("data", (p: Buffer) => partes.push(p));
    doc.on("end", () => ok(Buffer.concat(partes)));
    doc.on("error", erro);
    const [data, hora] = [c.dataHora.slice(0, 10).split("-").reverse().join("/"), c.dataHora.slice(11, 19)];
    doc.font("Helvetica-Bold").fontSize(13).text("Comprovante de Registro de Ponto do Trabalhador", { align: "center" });
    doc.moveDown(0.8);
    const linha = (rotulo: string, valor: string) => {
      doc.font("Helvetica").fontSize(8).fillColor("#555").text(rotulo);
      doc.font("Helvetica").fontSize(10).fillColor("#000").text(valor);
      doc.moveDown(0.4);
    };
    linha("Empregador", `${c.empregador}\nCNPJ ${c.cnpj}`);
    linha("Trabalhador", `${c.trabalhador}\nCPF ${c.cpf}`);
    linha("Data e hora da marcação", `${data} ${hora} (${c.dataHora.slice(19)})`);
    linha("NSR (número sequencial do registro)", String(c.nsr));
    linha("Origem", { MOBILE: "Aplicativo no celular", WEB: "Navegador", QUIOSQUE: "Quiosque (tablet da empresa)" }[c.origem] ?? c.origem);
    linha("Código de verificação (SHA-256)", c.hash);
    doc.moveDown(0.4);
    doc.font("Helvetica").fontSize(7).fillColor("#555").text("Registro eletrônico de ponto por programa (REP-P), Portaria MTP 671/2021.");
    doc.end();
  });
}

export async function comprovantePdf(c: Comprovante): Promise<{ pdf: Buffer; assinado: boolean }> {
  const pdf = await gerarPdf(c);
  const cert = carregarCertificado();
  if (!cert) return { pdf, assinado: false };
  const comEspaco = plainAddPlaceholder({
    pdfBuffer: pdf,
    reason: "Comprovante de registro de ponto",
    contactInfo: c.cnpj,
    name: cert.titular,
    location: "Brasil",
  });
  const assinado = await new SignPdf().sign(comEspaco, new P12Signer(cert.pfx, { passphrase: cert.senha }));
  return { pdf: Buffer.from(assinado), assinado: true };
}
