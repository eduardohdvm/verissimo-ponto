// Importação de funcionários por planilha CSV (o Excel salva em "CSV UTF-8").
import { api, esc } from "/app.js";
import { caixaLink, conteudo, topo } from "./ui.js";

const COLUNAS = ["nome", "cpf", "matricula", "cargo", "admissao", "email", "departamento", "jornada", "pis"];
const MODELO = "nome;cpf;matricula;cargo;admissao;email;departamento;jornada;pis\r\n" +
  "Maria da Silva;529.982.247-25;001;Vendedora;01/03/2024;maria@exemplo.com;Loja Centro;;\r\n";

/** Lê CSV com ; ou , e aspas. Cabeçalhos são comparados sem acento e sem maiúsculas. */
function lerCsv(texto) {
  texto = texto.replace(/^﻿/, "");
  const sep = (texto.split("\n")[0].match(/;/g)?.length ?? 0) >= (texto.split("\n")[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const linhas = [];
  let campo = "", linha = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      linha.push(campo); campo = "";
      if (linha.some((x) => x.trim())) linhas.push(linha);
      linha = [];
    } else campo += c;
  }
  linha.push(campo);
  if (linha.some((x) => x.trim())) linhas.push(linha);
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, "");
  const cab = linhas.shift()?.map(norm) ?? [];
  const faltando = ["nome", "cpf"].filter((c) => !cab.includes(c));
  if (faltando.length) throw new Error(`A planilha precisa das colunas: ${faltando.join(", ")}. Baixe o modelo.`);
  return linhas.map((l) => Object.fromEntries(COLUNAS.filter((c) => cab.includes(c)).map((c) => [c, (l[cab.indexOf(c)] ?? "").trim()])));
}

export async function telaImportar() {
  conteudo().innerHTML = `${topo("Importar funcionários", `<a class="btn" href="#funcionarios">Voltar</a>`)}
    <div class="stack">
      <div class="card">
        <h2>1. Prepare a planilha</h2>
        <p class="small">Colunas aceitas: <strong>nome</strong> e <strong>cpf</strong> (obrigatórias), matricula, cargo, admissao (dd/mm/aaaa),
          email, departamento, jornada (nome exato de uma jornada cadastrada) e pis.</p>
        <p class="muted small">Departamentos que não existirem são criados. Quem tiver e-mail recebe o convite para criar a senha.
          CPF que já existir é atualizado, não duplicado. No Excel, use Arquivo → Salvar como → "CSV UTF-8".</p>
        <button id="modelo">Baixar planilha modelo</button>
      </div>
      <div class="card">
        <h2>2. Envie o arquivo</h2>
        <input type="file" id="arquivo" accept=".csv,text/csv">
        <div id="previa" style="margin-top:12px"></div>
      </div>
    </div>`;
  document.getElementById("modelo").onclick = () => {
    const url = URL.createObjectURL(new Blob(["﻿" + MODELO], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: "modelo-funcionarios.csv" }).click();
  };
  document.getElementById("arquivo").onchange = async (e) => {
    const previa = document.getElementById("previa");
    const arq = e.target.files[0];
    if (!arq) return;
    let linhas;
    try {
      linhas = lerCsv(await arq.text());
    } catch (err) {
      previa.innerHTML = `<p class="alerta">${esc(err.message)}</p>`;
      return;
    }
    const cols = COLUNAS.filter((c) => linhas.some((l) => l[c]));
    previa.innerHTML = `<p><strong>${linhas.length}</strong> funcionário(s) encontrados. Confira as primeiras linhas:</p>
      <div class="tabela-wrap" style="max-height:300px"><table><thead><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead>
      <tbody>${linhas.slice(0, 20).map((l) => `<tr>${cols.map((c) => `<td class="small">${esc(l[c] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      <div class="acoes" style="margin-top:12px"><button class="primary" id="importar">Importar ${linhas.length} funcionário(s)</button></div>
      <div id="resultado"></div>`;
    document.getElementById("importar").onclick = async (ev) => {
      ev.target.disabled = true;
      ev.target.textContent = "Importando…";
      try {
        const r = await api("POST", "/api/admin/funcionarios/importar", { linhas });
        document.getElementById("resultado").innerHTML = `<p class="alerta ${r.erros.length ? "warn" : "ok"}">
            ${r.criados} criado(s), ${r.atualizados} atualizado(s)${r.erros.length ? `, ${r.erros.length} com erro` : ""}.</p>
          ${r.erros.length ? `<table class="small"><tbody>${r.erros.map((x) => `<tr><td>Linha ${x.linha}</td><td>${esc(x.erro)}</td></tr>`).join("")}</tbody></table>` : ""}
          ${r.convites.length ? `<p class="small" style="margin-top:12px">Convites enviados por e-mail. Se algum não chegar, envie o link:</p>
            ${r.convites.map((c) => `<details><summary>${esc(c.nome)}</summary>${caixaLink(c.link, c.nome)}</details>`).join("")}` : ""}
          <div class="acoes" style="margin-top:12px"><a class="btn" href="#funcionarios">Ver funcionários</a></div>`;
        ev.target.classList.add("oculto");
      } catch (err) {
        document.getElementById("resultado").innerHTML = `<p class="alerta">${esc(err.message)}</p>`;
        ev.target.disabled = false;
      }
    };
  };
}
