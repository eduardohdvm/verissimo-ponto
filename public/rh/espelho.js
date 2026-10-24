import { api, dataBr, esc, mesAtual, periodoDoMes, tabelaEspelho } from "/app.js";
import { abrirModal, aoClicar, aoEnviar, conteudo, modal, topo, verFoto } from "./ui.js";

const estadoEspelho = { funcionarioId: "", mes: mesAtual() };

export async function telaEspelho() {
  const funcs = (await api("GET", "/api/admin/funcionarios")).filter((f) => f.ativo);
  const pedido = sessionStorage.getItem("espelho-funcionario");
  if (pedido) {
    estadoEspelho.funcionarioId = pedido;
    sessionStorage.removeItem("espelho-funcionario");
  }
  if (!funcs.some((f) => f.id === estadoEspelho.funcionarioId)) estadoEspelho.funcionarioId = funcs[0]?.id ?? "";
  conteudo().innerHTML = `${topo("Espelho de ponto", `<button id="imprimir">Imprimir</button>`)}
    <div class="card stack">
      <div class="acoes nao-imprimir">
        <select id="func" style="width:auto;min-width:240px">${funcs.map((f) =>
          `<option value="${f.id}" ${f.id === estadoEspelho.funcionarioId ? "selected" : ""}>${esc(f.nome)}</option>`).join("")}</select>
        <input id="mes" type="month" value="${estadoEspelho.mes}" style="width:auto">
      </div>
      <div id="espelho"><p class="muted">${funcs.length ? "Carregando…" : "Nenhum funcionário ativo."}</p></div>
    </div>`;
  document.getElementById("imprimir").onclick = () => print();
  document.getElementById("func").onchange = (e) => { estadoEspelho.funcionarioId = e.target.value; carregarEspelho(); };
  document.getElementById("mes").onchange = (e) => { estadoEspelho.mes = e.target.value; carregarEspelho(); };
  if (funcs.length) carregarEspelho();
}

async function carregarEspelho() {
  const alvo = document.getElementById("espelho");
  const { inicio, fim } = periodoDoMes(estadoEspelho.mes);
  try {
    const e = await api("GET", `/api/admin/espelho/${estadoEspelho.funcionarioId}?inicio=${inicio}&fim=${fim}`);
    alvo.innerHTML = `<div style="margin-bottom:12px"><strong>${esc(e.funcionario.nome)}</strong>
      <span class="muted"> · CPF ${e.funcionario.cpf} · ${esc(e.funcionario.jornada ?? "sem jornada")} · ${dataBr(inicio)} a ${dataBr(fim)}</span>
      <div class="muted small">${esc(e.empresa.razaoSocial)} · CNPJ ${e.empresa.cnpj}</div></div>
      ${e.fechamento ? `<p class="alerta ${e.fechamento.assinatura === "ASSINADO" ? "ok" : "warn"} small">Período fechado em ${new Date(e.fechamento.fechadoEm).toLocaleDateString("pt-BR")}.
        ${e.fechamento.assinatura === "ASSINADO" ? "Espelho assinado pelo funcionário." : e.fechamento.assinatura === "CONTESTADO" ? "O funcionário contestou o espelho." : "Aguardando a assinatura do funcionário."}
        Ajustes só depois de reabrir o período.</p>` : ""}
      ${tabelaEspelho(e, e.fechamento ? null : (d) => `<button class="sm" data-dia="${d.data}">Ajustar</button>`)}`;
    aoClicar(alvo, "dia", ajustarDia);
  } catch (err) {
    alvo.innerHTML = `<p class="alerta">${esc(err.message)}</p>`;
  }
}

async function ajustarDia(data) {
  const fid = estadoEspelho.funcionarioId;
  const marcacoes = (await api("GET", `/api/admin/marcacoes?funcionarioId=${fid}&data=${data}`)).filter((m) => m.data === data);
  abrirModal(`<h2>Ajustar ${dataBr(data)}</h2>
    <h3>Marcações originais</h3>
    ${marcacoes.length ? `<table><tbody>${marcacoes.map((m) => `<tr>
      <td class="tnum"><strong>${m.hora}</strong> <span class="muted small">NSR ${m.nsr}</span></td>
      <td>${m.desconsiderada ? '<span class="tag">Desconsiderada</span>' : ""}</td>
      <td class="num">${m.temSelfie ? `<button class="sm" type="button" data-selfie="${m.id}">Foto</button> ` : ""}
        ${m.desconsiderada ? "" : `<button class="sm danger" type="button" data-desc="${m.id}">Desconsiderar</button>`}</td>
    </tr>`).join("")}</tbody></table>` : `<p class="muted">Nenhuma marcação neste dia.</p>`}
    <form style="margin-top:16px">
      <h3>Novo ajuste</h3>
      <div class="grid2">
        <label>Tipo<select name="tipo"><option value="INCLUSAO">Incluir marcação</option><option value="ABONO">Abonar o dia</option></select></label>
        <label id="campo-hora">Horário<input name="hora" type="time"></label>
      </div>
      <label>Motivo<input name="motivo" required placeholder="Ex.: esqueceu de marcar"></label>
      <div class="acoes"><button class="primary">Salvar ajuste</button><button type="button" data-fechar>Fechar</button></div>
    </form>
    <p class="muted small">A marcação original nunca é apagada: o ajuste fica registrado à parte, com autor e motivo. Para férias e atestados, use a tela Afastamentos.</p>`,
  (m) => {
    const form = m.querySelector("form");
    form.tipo.onchange = () => m.querySelector("#campo-hora").classList.toggle("oculto", form.tipo.value !== "INCLUSAO");
    aoEnviar(form, async (fd) => {
      await api("POST", `/api/admin/funcionarios/${fid}/tratamentos`, {
        tipo: fd.get("tipo"), data, hora: fd.get("hora") || undefined, motivo: fd.get("motivo"),
      });
      modal().close();
      carregarEspelho();
    });
    aoClicar(m, "selfie", (id) => verFoto(`/api/admin/marcacoes/${id}/selfie`, "Foto da marcação"));
    aoClicar(m, "desc", async (id) => {
      const motivo = prompt("Motivo para desconsiderar esta marcação:");
      if (!motivo) return;
      try {
        await api("POST", `/api/admin/funcionarios/${fid}/tratamentos`, { tipo: "DESCONSIDERAR", data, marcacaoId: id, motivo });
        modal().close();
        carregarEspelho();
      } catch (err) { alert(err.message); }
    });
  });
}
