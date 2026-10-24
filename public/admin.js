// Casca do painel do RH: menu conforme o papel e navegação entre as telas (public/admin/*.js).
import { api, esc, LOGO, sair, token } from "/app.js";
import { telaAfastamentos } from "./rh/afastamentos.js";
import { telaConta } from "./rh/conta.js";
import { telaEspelho } from "./rh/espelho.js";
import { telaFechamentos } from "./rh/fechamentos.js";
import { telaFolha } from "./rh/folha.js";
import { telaFuncionarios } from "./rh/funcionarios.js";
import { telaImportar } from "./rh/importar.js";
import { telaIndicadores } from "./rh/indicadores.js";
import { telaIntegracoes } from "./rh/integracoes.js";
import { telaJornadas } from "./rh/jornadas.js";
import { telaLocais } from "./rh/locais.js";
import { telaOrganizacao } from "./rh/organizacao.js";
import { telaInicio } from "./rh/inicio.js";
import { telaQuiosques } from "./rh/quiosques.js";
import { telaSolicitacoes } from "./rh/solicitacoes.js";
import { conteudo, estado } from "./rh/ui.js";
import { iniciarNotificacoes } from "./rh/notificacoes.js";

if (!token.get()) location.href = "/";

// [rota, título no menu, função, só para ADMIN?]
const TELAS = [
  ["painel", "Painel", telaInicio, false],
  ["indicadores", "Indicadores", telaIndicadores, false],
  ["funcionarios", "Funcionários", telaFuncionarios, false],
  ["espelho", "Espelho de ponto", telaEspelho, false],
  ["solicitacoes", "Solicitações", telaSolicitacoes, false],
  ["afastamentos", "Férias e afastamentos", telaAfastamentos, false],
  ["fechamento", "Fechamento do mês", telaFechamentos, true],
  ["folha", "Exportar para a folha", telaFolha, true],
  ["organizacao", "Organização", telaOrganizacao, true],
  ["jornadas", "Jornadas e regras", telaJornadas, true],
  ["locais", "Locais e feriados", telaLocais, true],
  ["quiosques", "Quiosques (tablet)", telaQuiosques, true],
  ["integracoes", "Integrações", telaIntegracoes, true],
  ["conta", "Conta e privacidade", telaConta, true],
  ["importar", null, telaImportar, true],
];

const eu = await api("GET", "/api/auth/eu");
if (eu.papel === "FUNCIONARIO") location.href = "/ponto";
estado.eu = eu;

const menu = document.getElementById("menu");
menu.innerHTML = `<div class="marca">${LOGO}<span>Ponto</span></div>
  ${TELAS.filter(([, titulo, , soAdmin]) => titulo && (!soAdmin || eu.papel === "ADMIN"))
    .map(([rota, titulo]) => `<a href="#${rota}">${titulo}</a>`).join("")}
  ${eu.superadmin ? '<a href="/superadmin">Empresas clientes (SaaS)</a>' : ""}
  <div class="rodape"><div><strong>${esc(eu.nome)}</strong><br>${esc(eu.empresa.razaoSocial)}</div>
    <a href="#" id="sair" style="padding:6px 0">Sair</a></div>`;
document.getElementById("sair").onclick = (e) => { e.preventDefault(); sair(); };

if (eu.aviso) {
  const aviso = document.createElement("p");
  aviso.className = "alerta warn";
  aviso.style.margin = "0 0 16px";
  aviso.innerHTML = esc(eu.aviso);
  conteudo().before(aviso);
}

async function navegar() {
  const nome = location.hash.slice(1) || "painel";
  const tela = TELAS.find(([rota, , , soAdmin]) => rota === nome && (!soAdmin || eu.papel === "ADMIN")) ?? TELAS[0];
  menu.querySelectorAll("a[href^='#']").forEach((a) => a.classList.toggle("ativo", a.getAttribute("href") === `#${tela[0]}`));
  conteudo().innerHTML = `<p class="muted">Carregando…</p>`;
  try {
    await tela[2]();
  } catch (err) {
    conteudo().innerHTML = `<p class="alerta">${esc(err.message)}</p>`;
  }
}
addEventListener("hashchange", navegar);
navegar();
iniciarNotificacoes();
