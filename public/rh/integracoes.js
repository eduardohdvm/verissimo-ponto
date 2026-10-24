import { api, esc, mesAtual, periodoDoMes } from "/app.js";
import { aoClicar, aoEnviar, baixar, conteudo, topo } from "./ui.js";

export async function telaIntegracoes() {
  const [chaves, hooks] = await Promise.all([api("GET", "/api/admin/api-keys"), api("GET", "/api/admin/webhooks")]);
  const { inicio, fim } = periodoDoMes(mesAtual());
  conteudo().innerHTML = `${topo("Integrações e arquivos legais")}
    <div class="stack">
      <div class="card">
        <h2>Chaves de API</h2>
        <p class="muted small">Use no ERP com o header <code>Authorization: Bearer pk_…</code>. Endpoints em <code>/api/v1</code>; veja <code>docs/integracao-erp.md</code>.</p>
        ${chaves.length ? `<table><tbody>${chaves.map((k) => `<tr><td><strong>${esc(k.nome)}</strong></td><td class="mono">${k.prefixo}…</td>
          <td class="small muted">${k.ultimoUso ? "Último uso " + new Date(k.ultimoUso).toLocaleString("pt-BR") : "Nunca usada"}</td>
          <td class="num">${k.revogadaEm ? '<span class="tag">Revogada</span>' : `<button class="sm danger" data-revogar="${k.id}">Revogar</button>`}</td></tr>`).join("")}</tbody></table>` : ""}
        <form id="form-chave" style="margin-top:16px"><div class="acoes">
          <input name="nome" required placeholder="Nome da chave (ex.: Verissimo ERP)" style="flex:1;min-width:200px">
          <button class="primary">Gerar chave</button></div></form>
        <div id="chave-nova"></div>
      </div>
      <div class="card">
        <h2>Webhooks</h2>
        <p class="muted small">O sistema avisa o ERP em tempo real. Cada envio leva o header <code>X-Ponto-Assinatura: sha256=HMAC(segredo, corpo)</code>.</p>
        ${hooks.length ? `<table><tbody>${hooks.map((h) => `<tr><td class="small">${esc(h.url)}<br><span class="muted">${esc(h.eventos)}</span></td>
          <td class="mono">${h.segredo}</td><td class="num"><button class="sm danger" data-del-hook="${h.id}">Remover</button></td></tr>`).join("")}</tbody></table>` : ""}
        <form id="form-hook" style="margin-top:16px">
          <label>URL<input name="url" type="url" required placeholder="https://seu-erp.com.br/webhooks/ponto"></label>
          <label class="check"><input type="checkbox" name="ev" value="marcacao.criada" checked> marcacao.criada</label>
          <label class="check"><input type="checkbox" name="ev" value="tratamento.decidido" checked> tratamento.decidido</label>
          <label class="check"><input type="checkbox" name="ev" value="funcionario.alterado"> funcionario.alterado</label>
          <label class="check"><input type="checkbox" name="ev" value="fechamento.concluido"> fechamento.concluido</label>
          <div class="acoes"><button class="primary">Adicionar webhook</button></div>
        </form>
      </div>
      <div class="card">
        <h2>Arquivos da Portaria 671 (fiscalização)</h2>
        <p class="muted small">AFD: todas as marcações originais do período. AEJ: jornadas, marcações tratadas, ausências e banco de horas.
          Os leiautes seguem os Anexos V e VI da Portaria MTP 671/2021 e precisam ser validados no validador oficial antes do uso em fiscalização.</p>
        <form id="form-afd"><div class="acoes">
          <input name="inicio" type="date" value="${inicio}" style="width:auto"> até
          <input name="fim" type="date" value="${fim}" style="width:auto">
          <button class="primary" name="tipo" value="afd">Baixar AFD</button>
          <button type="button" id="baixar-aej">Baixar AEJ</button>
          <button type="button" id="baixar-p7s">Baixar AFD assinado (+ .p7s)</button></div></form>
        <p id="info-assinatura" class="muted small"></p>
      </div>
    </div>`;
  aoEnviar(document.getElementById("form-chave"), async (fd) => {
    const { chave } = await api("POST", "/api/admin/api-keys", { nome: fd.get("nome") });
    await telaIntegracoes();
    document.getElementById("chave-nova").innerHTML = `<p class="alerta ok">Copie agora, ela não será mostrada de novo:<br><span class="mono">${chave}</span></p>`;
  });
  aoEnviar(document.getElementById("form-hook"), async (fd) => {
    await api("POST", "/api/admin/webhooks", { url: fd.get("url"), eventos: fd.getAll("ev") });
    telaIntegracoes();
  });
  const formAfd = document.getElementById("form-afd");
  const periodo = () => `inicio=${formAfd.inicio.value}&fim=${formAfd.fim.value}`;
  aoEnviar(formAfd, () => baixar(`/api/admin/afd?${periodo()}`, `AFD_${formAfd.inicio.value}_${formAfd.fim.value}.txt`));
  document.getElementById("baixar-aej").onclick = () =>
    baixar(`/api/admin/aej?${periodo()}`, `AEJ_${formAfd.inicio.value}_${formAfd.fim.value}.txt`).catch((e) => alert(e.message));
  // AFD assinado: o arquivo e a assinatura vêm juntos (a assinatura só vale para o AFD gerado junto com ela)
  document.getElementById("baixar-p7s").onclick = async () => {
    try {
      const r = await api("GET", `/api/admin/afd/assinado?${periodo()}`);
      const nome = `AFD_${formAfd.inicio.value}_${formAfd.fim.value}.txt`;
      const salvar = (blob, arquivo) => Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: arquivo }).click();
      salvar(new Blob([r.afd], { type: "text/plain" }), nome);
      salvar(new Blob([Uint8Array.from(atob(r.p7s), (c) => c.charCodeAt(0))], { type: "application/pkcs7-signature" }), `${nome}.p7s`);
    } catch (e) {
      alert(e.message);
    }
  };
  api("GET", "/api/admin/certificado").then((c) => {
    document.getElementById("info-assinatura").textContent = c.configurado
      ? `Certificado digital configurado: ${c.titular} (válido até ${new Date(c.validoAte).toLocaleDateString("pt-BR")}).`
      : "Nenhum certificado digital configurado: o AFD e o comprovante saem sem assinatura. Veja \"Certificado digital\" no README.";
  }).catch(() => {});
  aoClicar(conteudo(), "revogar", (id) => confirm("Revogar esta chave? O ERP perderá o acesso.") && api("DELETE", `/api/admin/api-keys/${id}`).then(telaIntegracoes));
  aoClicar(conteudo(), "del-hook", (id) => api("DELETE", `/api/admin/webhooks/${id}`).then(telaIntegracoes));
}
