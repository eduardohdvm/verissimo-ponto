// Geração do AFD (Arquivo Fonte de Dados) para REP-P.
//
// ATENÇÃO: o leiaute abaixo segue a estrutura do Anexo V da Portaria MTP 671/2021
// (registro 1 = cabeçalho, 7 = marcação de REP-P, 9 = trailer), mas precisa ser
// conferido campo a campo com o texto oficial vigente e validado no validador
// do Ministério antes de uso em produção. Também falta a assinatura digital
// (arquivo .p7s com certificado ICP-Brasil), exigida para o REP-P.
import { prisma } from "../db.js";
import { naoEncontrado } from "../lib/erros.js";
import { isoComOffset, somarDias, utcDeLocal } from "../lib/tempo.js";

const num = (v: string | number, tam: number) => String(v).replace(/\D/g, "").padStart(tam, "0").slice(-tam);
const txt = (v: string, tam: number) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").padEnd(tam, " ").slice(0, tam);

// Dados do fabricante do programa — preencher com os dados reais e o registro no INPI
const FABRICANTE = {
  cnpj: process.env.FABRICANTE_CNPJ ?? "00000000000000",
  registroInpi: process.env.REGISTRO_INPI ?? "",
  modelo: "SISTEMA PONTO WEB",
};

export async function gerarAfd(empresaId: string, inicio: string, fim: string): Promise<string> {
  const emp = await prisma.empresa.findUnique({ where: { id: empresaId } });
  if (!emp) throw naoEncontrado("Empresa");
  const fuso = emp.fusoHorario;

  const marcacoes = await prisma.marcacao.findMany({
    where: {
      empresaId,
      dataHora: { gte: utcDeLocal(inicio, "00:00", fuso), lt: utcDeLocal(somarDias(fim, 1), "00:00", fuso) },
    },
    include: { funcionario: { select: { cpf: true } } },
    orderBy: { nsr: "asc" },
  });

  const linhas: string[] = [];
  linhas.push(
    num(0, 9) +
      "1" +
      "1" + // 1 = CNPJ
      num(emp.cnpj, 14) +
      num(0, 14) + // CNO/CAEPF
      txt(emp.razaoSocial, 150) +
      txt(FABRICANTE.registroInpi, 17) +
      inicio +
      fim +
      isoComOffset(new Date(), fuso) +
      "003" + // versão do leiaute
      "1" +
      num(FABRICANTE.cnpj, 14) +
      txt(FABRICANTE.modelo, 30),
  );

  for (const m of marcacoes) {
    linhas.push(
      num(m.nsr, 9) +
        "7" +
        isoComOffset(m.dataHora, fuso) +
        num(m.funcionario.cpf, 12) +
        isoComOffset(m.criadoEm, fuso) +
        (m.origem === "MOBILE" ? "01" : "02") + // identificador do coletor
        (m.online ? "0" : "1") +
        m.hash,
    );
  }

  linhas.push("999999999" + num(0, 9).repeat(5) + num(marcacoes.length, 9) + "9");
  return linhas.join("\r\n") + "\r\n";
}
