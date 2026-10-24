// Card "Regras de cálculo" (convenção coletiva) dentro da tela de jornadas.
import { api, hhmm } from "/app.js";
import { aoEnviar, erroNo } from "./ui.js";

export async function cardRegras(alvo) {
  const r = await api("GET", "/api/admin/regras");
  const faixas = [...r.faixasExtra];
  while (faixas.length < 3) faixas.push({ ateMin: null, percentual: "" });
  alvo.innerHTML = `<form class="card" id="form-regras">
    <h2>Regras de cálculo (convenção coletiva)</h2>
    <p class="muted small">Confira na convenção coletiva do sindicato da categoria. Os valores padrão seguem a CLT.</p>
    <h3>Hora extra em dia útil</h3>
    <p class="muted small">Faixas por dia. Ex.: as primeiras 2h a 50% e o que passar a 100%. Deixe "até" vazio na última faixa.</p>
    ${faixas.map((f, i) => `<div class="grid2">
      <label>Faixa ${i + 1}: até (horas extras no dia)<input name="ate${i}" placeholder="${i === 0 ? "ex.: 02:00 (vazio = sem limite)" : "vazio = o restante"}" value="${f.ateMin ? hhmm(f.ateMin) : ""}"></label>
      <label>Percentual (%)<input name="pct${i}" type="number" min="0" max="300" value="${f.percentual}"></label>
    </div>`).join("")}
    <div class="grid2">
      <label>Hora extra em domingo e feriado (%)<input name="domingo" type="number" min="0" max="300" value="${r.percentualDomingoFeriado}"></label>
      <label>Adicional noturno (%)<input name="noturno" type="number" min="0" max="100" value="${r.adicionalNoturnoPercentual}"></label>
    </div>
    <label class="check"><input type="checkbox" name="reduzida" ${r.horaNoturnaReduzida ? "checked" : ""}> Hora noturna reduzida (52min30s entre 22h e 5h)</label>
    <h3 style="margin-top:16px">Banco de horas</h3>
    <label class="check"><input type="checkbox" name="banco" ${r.bancoHoras.ativo ? "checked" : ""}> A empresa usa banco de horas (extras viram saldo para compensar)</label>
    <label>Validade do saldo (meses)<input name="validade" type="number" min="1" max="12" value="${r.bancoHoras.validadeMeses}" style="max-width:120px"></label>
    <p class="muted small">Acordo individual: até 6 meses. Acordo ou convenção coletiva: até 12 meses (CLT art. 59). O saldo acumulado considera os meses já fechados dentro da validade.</p>
    <div class="acoes"><button class="primary">Salvar regras</button></div>
  </form>`;
  const form = alvo.querySelector("form");
  aoEnviar(form, async (fd) => {
    const lerHoras = (v) => {
      if (!v) return null;
      const m = String(v).trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
      if (!m) throw new Error(`Use horas no formato 02:00 (recebi "${v}")`);
      return Number(m[1]) * 60 + Number(m[2] ?? 0);
    };
    const faixasExtra = [0, 1, 2]
      .map((i) => ({ ateMin: lerHoras(fd.get(`ate${i}`)), percentual: fd.get(`pct${i}`) }))
      .filter((f) => f.percentual !== "" && f.percentual !== null)
      .map((f) => ({ ...f, percentual: Number(f.percentual) }));
    if (!faixasExtra.length) throw new Error("Informe pelo menos uma faixa de hora extra");
    await api("PUT", "/api/admin/regras", {
      faixasExtra,
      percentualDomingoFeriado: Number(fd.get("domingo")),
      adicionalNoturnoPercentual: Number(fd.get("noturno")),
      horaNoturnaReduzida: fd.has("reduzida"),
      bancoHoras: { ativo: fd.has("banco"), validadeMeses: Number(fd.get("validade")) },
    });
    const ok = new Error("Regras salvas. O espelho dos meses em aberto já usa os novos valores.");
    erroNo(form, ok);
    form.querySelector(".alerta").className = "alerta ok";
  });
}
