import { api, dataBr, esc } from "/app.js";
import { aoClicar, aoEnviar, conteudo, opcoes, topo } from "./ui.js";

export async function telaLocais() {
  const [locais, feriados, filiais] = await Promise.all([
    api("GET", "/api/admin/locais"),
    api("GET", "/api/admin/feriados"),
    api("GET", "/api/admin/filiais"),
  ]);
  const ano = new Date().getFullYear();
  const anos = [...new Set(feriados.map((f) => f.data.slice(0, 4)))];
  conteudo().innerHTML = `${topo("Locais e feriados")}
    <div class="stack">
      <div class="card">
        <h2>Locais permitidos</h2>
        <p class="muted small">Funcionários com GPS obrigatório só conseguem bater ponto dentro do raio de um destes locais. Sem locais cadastrados, qualquer lugar é aceito (a localização continua sendo gravada).</p>
        ${locais.length ? `<table><tbody>${locais.map((l) => `<tr><td><strong>${esc(l.nome)}</strong></td>
          <td class="small tnum">${l.latitude.toFixed(5)}, ${l.longitude.toFixed(5)}</td><td>${l.raioMetros} m</td>
          <td class="num"><button class="sm danger" data-del-local="${l.id}">Remover</button></td></tr>`).join("")}</tbody></table>` : ""}
        <form id="form-local" style="margin-top:16px">
          <div class="grid2">
            <label>Nome<input name="nome" required placeholder="Matriz"></label>
            <label>Raio (metros)<input name="raio" type="number" value="150" min="20" max="5000"></label>
            <label>Latitude<input name="lat" required inputmode="decimal"></label>
            <label>Longitude<input name="lng" required inputmode="decimal"></label>
          </div>
          <div class="acoes"><button class="primary">Adicionar local</button><button type="button" id="usar-gps">Usar minha localização</button></div>
        </form>
      </div>
      <div class="card">
        <h2>Feriados</h2>
        <p class="muted small">Trabalho em feriado conta como hora extra de domingo/feriado. Feriados de uma filial (municipais e estaduais) valem só para quem é dessa filial.</p>
        <form id="form-nacionais" class="acoes" style="margin-bottom:16px">
          <select name="ano" style="width:auto">${[ano, ano + 1].map((a) => `<option>${a}</option>`).join("")}</select>
          <label class="check" style="margin:0"><input type="checkbox" name="facultativos"> Incluir Carnaval e Corpus Christi</label>
          <button class="primary">Importar feriados nacionais</button>
        </form>
        ${feriados.length ? `<div class="tabela-wrap"><table><thead><tr><th>Data</th><th>Feriado</th><th>Vale para</th><th></th></tr></thead><tbody>${feriados.map((f) => `<tr>
          <td class="tnum">${dataBr(f.data)}</td><td>${esc(f.descricao)}</td><td class="small">${esc(f.filial?.nome ?? "Empresa toda")}</td>
          <td class="num"><button class="sm danger" data-del-feriado="${f.id}">Remover</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">Nenhum feriado cadastrado${anos.length ? "" : ". Comece importando os nacionais"}.</p>`}
        <form id="form-feriado" style="margin-top:16px">
          <h3>Feriado municipal, estadual ou da empresa</h3>
          <div class="grid2">
            <label>Data<input name="data" type="date" required></label>
            <label>Descrição<input name="descricao" required placeholder="Ex.: Aniversário da cidade"></label>
            ${filiais.length ? `<label>Vale para<select name="filialId">${opcoes(filiais, "", "Empresa toda")}</select></label>` : ""}
          </div>
          <div class="acoes"><button class="primary">Adicionar feriado</button></div>
        </form>
      </div>
    </div>`;
  const fl = document.getElementById("form-local");
  document.getElementById("usar-gps").onclick = () => navigator.geolocation.getCurrentPosition(
    (p) => { fl.lat.value = p.coords.latitude.toFixed(6); fl.lng.value = p.coords.longitude.toFixed(6); },
    () => alert("Não foi possível obter a localização"),
  );
  aoEnviar(fl, async (fd) => {
    await api("POST", "/api/admin/locais", {
      nome: fd.get("nome"), latitude: Number(fd.get("lat").replace(",", ".")),
      longitude: Number(fd.get("lng").replace(",", ".")), raioMetros: Number(fd.get("raio")),
    });
    telaLocais();
  });
  aoEnviar(document.getElementById("form-nacionais"), async (fd) => {
    await api("POST", "/api/admin/feriados/nacionais", { ano: Number(fd.get("ano")), facultativos: fd.has("facultativos") });
    telaLocais();
  });
  aoEnviar(document.getElementById("form-feriado"), async (fd) => {
    await api("POST", "/api/admin/feriados", { data: fd.get("data"), descricao: fd.get("descricao"), filialId: fd.get("filialId") || null });
    telaLocais();
  });
  aoClicar(conteudo(), "del-local", (id) => api("DELETE", `/api/admin/locais/${id}`).then(telaLocais));
  aoClicar(conteudo(), "del-feriado", (id) => api("DELETE", `/api/admin/feriados/${id}`).then(telaLocais));
}
