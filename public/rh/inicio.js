// Tela inicial: painel do dia + roteiro de primeiros passos (só para o ADMIN, até concluir ou dispensar).
import { api } from "/app.js";
import { telaPainel } from "./painel.js";
import { ehAdmin } from "./ui.js";

const DISPENSADO = "primeiros-passos-dispensado";

export async function telaInicio() {
  await telaPainel();
  if (!ehAdmin()) return;
  let dispensado = false;
  try { dispensado = localStorage.getItem(DISPENSADO) === "1"; } catch {}
  if (dispensado) return;
  const s = await api("GET", "/api/admin/primeiros-passos");
  const passos = [
    [s.comJornada > 0, "Confira a jornada de trabalho", "Já criamos uma jornada comercial de 44h. Ajuste os horários, a tolerância e as regras de hora extra.", "#jornadas"],
    [s.funcionarios > 0, "Cadastre os funcionários", "Um a um ou importando uma planilha.", "#importar"],
    [s.comAcesso > 0, "Convide para o app", "Cada funcionário recebe um link por e-mail (ou WhatsApp) para criar a senha e bater ponto pelo celular.", "#funcionarios"],
    [s.feriados > 0, "Importe os feriados", "Os nacionais em um clique; depois inclua os da sua cidade.", "#locais"],
    [s.locais > 0, "Defina onde o ponto pode ser batido", "Cerca virtual: o ponto só é aceito perto da empresa. Opcional.", "#locais"],
    [s.departamentos > 0, "Organize equipes e gestores", "Cada gestor vê e aprova só a equipe dele. Opcional.", "#organizacao"],
  ];
  const feitos = passos.filter((p) => p[0]).length;
  if (feitos === passos.length) return;
  const el = document.getElementById("extra-painel");
  if (!el) return;
  el.innerHTML = `<div class="card">
    <div class="topo" style="margin-bottom:8px"><h2 style="margin:0">Primeiros passos · ${feitos} de ${passos.length}</h2>
      <button class="sm" id="dispensar">Dispensar</button></div>
    <ol class="passos">${passos.map(([ok, titulo, texto, link]) => `<li class="${ok ? "feito" : ""}">
      <a href="${link}"><strong>${titulo}</strong></a><span class="muted small">${texto}</span></li>`).join("")}</ol>
  </div>`;
  document.getElementById("dispensar").onclick = () => {
    try { localStorage.setItem(DISPENSADO, "1"); } catch {}
    el.innerHTML = "";
  };
}
