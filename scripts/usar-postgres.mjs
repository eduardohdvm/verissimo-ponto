// Usado no build do Render: troca o banco do Prisma de SQLite (desenvolvimento local)
// para PostgreSQL (produção). O resto do schema é igual nos dois.
import { readFileSync, writeFileSync } from "node:fs";

const arquivo = new URL("../prisma/schema.prisma", import.meta.url);
const schema = readFileSync(arquivo, "utf8");
const novo = schema.replace(/provider = "sqlite"/, 'provider = "postgresql"');
if (novo === schema && !schema.includes('provider = "postgresql"')) {
  throw new Error("Não encontrei o provider do banco em prisma/schema.prisma");
}
writeFileSync(arquivo, novo);
console.log("Prisma configurado para PostgreSQL");
