import "dotenv/config";
import { createRequire } from "node:module";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";
import { autenticar, autenticarApiKey } from "./auth.js";
import { ErroHttp } from "./lib/erros.js";
import { FACIAL_ATIVO, iniciarFace } from "./lib/face.js";
import { rotasAdmin } from "./routes/admin.js";
import { rotasAfastamentos } from "./routes/admin-afastamentos.js";
import { rotasConfig } from "./routes/admin-config.js";
import { rotasFechamentos } from "./routes/admin-fechamentos.js";
import { rotasFolha } from "./routes/admin-folha.js";
import { rotasOrg } from "./routes/admin-org.js";
import { rotasApiV1 } from "./routes/api-v1.js";
import { rotasAuth } from "./routes/auth.js";
import { rotasConta, rotasSuperadmin } from "./routes/conta.js";
import { rotasNotificacoes } from "./routes/notificacoes.js";
import { rotasPonto } from "./routes/ponto.js";
import { rotasQuiosque, rotasQuiosquesAdmin } from "./routes/quiosque.js";
import { iniciarAlertas } from "./services/alertas.js";
import { exigirEmpresaAtiva } from "./services/conta.js";
import { iniciarRetencao } from "./services/retencao.js";

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "8mb" })); // fotos vêm em base64 no corpo

app.use("/api/auth", rotasAuth);
// Teste vencido ou empresa suspensa: tudo fica bloqueado, menos a tela da conta (para ver o plano)
app.use(
  "/api/admin",
  autenticar,
  exigirEmpresaAtiva(["/conta"]),
  rotasAdmin, rotasConfig, rotasOrg, rotasAfastamentos, rotasFechamentos, rotasFolha, rotasQuiosquesAdmin, rotasConta,
);
app.use("/api/quiosque", rotasQuiosque);
app.use("/api/ponto", autenticar, exigirEmpresaAtiva(), rotasPonto);
app.use("/api/v1", autenticarApiKey, exigirEmpresaAtiva(), rotasApiV1);
app.use("/api/superadmin", rotasSuperadmin);
app.use("/api", rotasNotificacoes);
app.use("/api", (_req, _res, next) => next(new ErroHttp(404, "Rota não encontrada")));

app.use(express.static(path.resolve("public"), { extensions: ["html"] }));
// Biblioteca e modelos de rosto usados no navegador para guiar a prova de vida
const require = createRequire(import.meta.url);
const pastaFaceApi = path.dirname(require.resolve("@vladmandic/face-api/package.json"));
app.get("/vendor/face-api.esm.js", (_req, res) => res.sendFile(path.join(pastaFaceApi, "dist", "face-api.esm.js")));
app.use("/modelos", express.static(path.join(pastaFaceApi, "model"), { maxAge: "7d" }));

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ erro: err.issues.map((i) => i.message).join("; ") });
  }
  if (err instanceof ErroHttp) return res.status(err.status).json({ erro: err.message });
  if ((err as { type?: string }).type === "entity.too.large") return res.status(413).json({ erro: "Arquivo muito grande" });
  console.error(err);
  res.status(500).json({ erro: "Erro interno" });
});

const porta = Number(process.env.PORT ?? 3000);
app.listen(porta, () => console.log(`Sistema de ponto rodando em http://localhost:${porta}`));
iniciarAlertas();
iniciarRetencao();
// Carrega os modelos de rosto já na subida, para a primeira marcação não demorar
if (FACIAL_ATIVO) {
  iniciarFace().then(
    () => console.log("Reconhecimento facial pronto"),
    (e) => console.error("Falha ao carregar o reconhecimento facial:", e),
  );
} else {
  console.log("Reconhecimento facial desativado (FACIAL_ATIVO=false)");
}
