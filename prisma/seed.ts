// Dados de demonstração: npm run db:seed (local) ou SEED_DEMO=true no servidor (cria na subida).
// Acessos criados:
//   RH:          admin@demo.com.br  / demo12345
//   Funcionária: maria@demo.com.br  / demo12345
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { partesLocais, somarDias, utcDeLocal } from "../src/lib/tempo.js";

const FUSO = "America/Sao_Paulo";
const SENHA = "demo12345";

/** Cria a empresa de demonstração; não faz nada se ela (ou um dos e-mails) já existir. */
export async function criarDemonstracao() {
  if (await prisma.empresa.findUnique({ where: { cnpj: "11222333000181" } })) {
    console.log("Dados de demonstração já existem.");
    return;
  }
  const emailEmUso = await prisma.usuario.findFirst({ where: { email: { in: ["admin@demo.com.br", "maria@demo.com.br"] } } });
  if (emailEmUso) {
    console.log(`Demonstração não criada: o e-mail ${emailEmUso.email} já é usado por outra empresa.`);
    return;
  }
  const senhaHash = await bcrypt.hash(SENHA, 10);
  const empresa = await prisma.empresa.create({
    data: { razaoSocial: "Demonstração Comércio Ltda", cnpj: "11222333000181" },
  });
  const util = (d: string[]) => Object.fromEntries(d.map((dia) => [dia, [["08:00", "12:00"], ["13:00", "17:48"]]]));
  const comercial = await prisma.jornada.create({
    data: { empresaId: empresa.id, nome: "Comercial 44h", horarios: JSON.stringify({ tipo: "SEMANAL", dias: util(["1", "2", "3", "4", "5"]) }) },
  });
  const doze = await prisma.jornada.create({
    data: {
      empresaId: empresa.id,
      nome: "12x36 noturno",
      horarios: JSON.stringify({ tipo: "CICLO", dataBase: "2026-01-01", ciclo: [[["19:00", "07:00"]], []] }),
    },
  });
  await prisma.usuario.create({
    data: { empresaId: empresa.id, nome: "Ana (RH)", email: "admin@demo.com.br", senhaHash, papel: "ADMIN" },
  });

  const maria = await prisma.funcionario.create({
    data: {
      empresaId: empresa.id, nome: "Maria Souza", cpf: "52998224725", matricula: "001", cargo: "Vendedora",
      jornadaId: comercial.id, codigoExterno: "ERP-1001", exigeSelfie: false, exigeGps: false,
    },
  });
  await prisma.usuario.create({
    data: { empresaId: empresa.id, nome: maria.nome, email: "maria@demo.com.br", senhaHash, papel: "FUNCIONARIO", funcionarioId: maria.id },
  });
  const joao = await prisma.funcionario.create({
    data: {
      empresaId: empresa.id, nome: "João Lima", cpf: "16899535009", matricula: "002", cargo: "Vigia",
      jornadaId: doze.id, codigoExterno: "ERP-1002", exigeSelfie: false, exigeGps: false,
    },
  });

  // Marcações dos últimos 20 dias, com NSR e hash encadeados como no registro real
  let nsr = 0;
  let hashAnterior = "";
  const hoje = partesLocais(new Date(), FUSO).data;
  const marcar = async (funcionarioId: string, data: string, hora: string) => {
    const dataHora = utcDeLocal(data, hora, FUSO);
    if (dataHora > new Date()) return;
    nsr++;
    hashAnterior = createHash("sha256").update([hashAnterior, empresa.id, funcionarioId, nsr, dataHora.toISOString()].join("|")).digest("hex");
    await prisma.marcacao.create({
      data: { empresaId: empresa.id, funcionarioId, nsr, dataHora, origem: nsr % 3 ? "MOBILE" : "WEB", hash: hashAnterior, criadoEm: dataHora },
    });
  };
  const variar = (hora: string, n: number) => {
    const [h, m] = hora.split(":").map(Number);
    const t = h * 60 + m + n;
    return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  };

  for (let i = 20; i >= 0; i--) {
    const data = somarDias(hoje, -i);
    const dia = new Date(data + "T12:00:00Z").getUTCDay();
    if (dia >= 1 && dia <= 5 && i !== 7) {
      const extra = i % 4 === 0 ? 75 : 0; // alguns dias com hora extra
      const atraso = i % 5 === 0 ? 25 : (i % 3) - 1;
      for (const h of [variar("08:00", atraso), variar("12:00", 2), variar("13:00", -1), variar("17:48", extra)]) {
        await marcar(maria.id, data, h);
      }
    }
    const diff = Math.round((Date.parse(data) - Date.parse("2026-01-01")) / 86400_000);
    if (diff % 2 === 0) {
      await marcar(joao.id, data, "18:58");
      await marcar(joao.id, somarDias(data, 1), "07:03");
    }
  }
  await prisma.empresa.update({ where: { id: empresa.id }, data: { ultimoNsr: nsr, ultimoHash: hashAnterior } });
  await prisma.tratamento.create({
    data: {
      empresaId: empresa.id, funcionarioId: maria.id, tipo: "ABONO", data: somarDias(hoje, -7),
      motivo: "Atestado médico", solicitadoPor: maria.id,
    },
  });
  console.log(`Demonstração criada: ${nsr} marcações. Login RH: admin@demo.com.br / ${SENHA}`);
}

// Rodando direto (npm run db:seed): cria e fecha a conexão
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  criarDemonstracao().finally(() => prisma.$disconnect());
}
