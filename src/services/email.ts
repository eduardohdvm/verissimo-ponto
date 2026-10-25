// Envio de e-mails (redefinição de senha, convites, alertas).
// Configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS e EMAIL_REMETENTE.
// Sem SMTP configurado, o e-mail é escrito no log do servidor (útil em desenvolvimento).
import nodemailer from "nodemailer";
import { esc } from "../lib/texto.js";

const transporte = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    })
  : null;

export const emailConfigurado = () => transporte !== null;

/** Endereço público do sistema, usado nos links dos e-mails. O Render define RENDER_EXTERNAL_URL. */
export function urlApp(): string {
  return (process.env.APP_URL ?? process.env.RENDER_EXTERNAL_URL ?? `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/$/, "");
}

interface Email {
  para: string;
  assunto: string;
  titulo: string;
  paragrafos: string[];
  botao?: { texto: string; url: string };
}

export async function enviarEmail(e: Email): Promise<void> {
  const texto = [e.titulo, "", ...e.paragrafos, ...(e.botao ? ["", `${e.botao.texto}: ${e.botao.url}`] : [])].join("\n");
  if (!transporte) {
    console.log(`\n[e-mail não enviado: SMTP não configurado]\nPara: ${e.para}\nAssunto: ${e.assunto}\n${texto}\n`);
    return;
  }
  const html = `<div style="font-family:Segoe UI,Roboto,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#17202c">
    <p style="margin:0 0 20px;font-size:15px;font-weight:700;letter-spacing:.06em;color:#042c53">VERISSIMO <span style="color:#ef9f27">PONTO</span></p>
    <h2 style="margin:0 0 16px;font-size:20px">${esc(e.titulo)}</h2>
    ${e.paragrafos.map((p) => `<p style="margin:0 0 12px;line-height:1.5">${esc(p)}</p>`).join("")}
    ${e.botao ? `<p style="margin:24px 0"><a href="${esc(e.botao.url)}" style="background:#0c447c;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${esc(e.botao.texto)}</a></p>
    <p style="font-size:12px;color:#5e6b7c">Se o botão não funcionar, copie este endereço: ${esc(e.botao.url)}</p>` : ""}
  </div>`;
  await transporte.sendMail({
    from: process.env.EMAIL_REMETENTE ?? `"Verissimo Ponto" <${process.env.SMTP_USER}>`,
    to: e.para,
    subject: e.assunto,
    text: texto,
    html,
  });
}
