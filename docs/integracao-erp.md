# Integração com ERP

O ERP conversa com o sistema de ponto de duas formas:

- **API REST (`/api/v1`)**: o ERP envia funcionários e busca marcações e totais.
- **Webhooks**: o sistema de ponto avisa o ERP na hora em que algo acontece.

## Autenticação

No painel, em **Integrações (ERP) → Chaves de API**, gere uma chave. Ela aparece uma única vez.

```
Authorization: Bearer pk_xxxxxxxxxxxxxxxxxxxxxxxx
```

Cada chave pertence a uma empresa. O ERP só enxerga os dados dessa empresa.

## Endpoints

### Funcionários

`GET /api/v1/funcionarios` lista todos.

`PUT /api/v1/funcionarios/{codigoExterno}` cria ou atualiza pelo id do funcionário no ERP. É idempotente: pode chamar sempre que o cadastro mudar no ERP.

```json
{
  "nome": "Carlos Pereira",
  "cpf": "390.533.447-05",
  "pis": "12345678901",
  "matricula": "0042",
  "cargo": "Estoquista",
  "admissao": "2026-10-01",
  "jornadaId": "id da jornada (GET /api/v1/jornadas)",
  "ativo": true
}
```

Para desligar um funcionário, envie `"ativo": false`. O histórico de ponto é mantido.

Respostas: `201` criado, `200` atualizado, `400` com `{"erro": "..."}` se algum dado for inválido.

### Jornadas

`GET /api/v1/jornadas` lista as jornadas cadastradas (para preencher `jornadaId`).

### Marcações

`GET /api/v1/marcacoes?inicio=2026-10-01&fim=2026-10-31`

Retorna as marcações **originais** em ordem de NSR, até 1000 por página. Se `proximoNsr` vier preenchido, busque a próxima página com `&aposNsr={proximoNsr}`.

```json
{
  "dados": [
    { "nsr": 77, "codigoExterno": "ERP-1001", "cpf": "52998224725",
      "dataHora": "2026-10-23T19:11:00-0300", "origem": "MOBILE", "online": true, "hash": "4f51…" }
  ],
  "proximoNsr": null
}
```

### Espelho / totais para a folha

`GET /api/v1/espelho?inicio=2026-10-01&fim=2026-10-31[&codigoExterno=ERP-1001][&detalhado=true]`

Já considera os ajustes aprovados (inclusões, marcações desconsideradas, abonos), férias e atestados, feriados (da empresa e da filial), a jornada e as regras da convenção de cada empresa. Se o mês já foi fechado, devolve o espelho congelado no fechamento. Todos os valores estão em **minutos**.

```json
{
  "periodo": { "inicio": "2026-10-01", "fim": "2026-10-31" },
  "funcionarios": [{
    "funcionario": { "id": "…", "nome": "Maria Souza", "codigoExterno": "ERP-1001", "departamento": "Vendas", "…": "…" },
    "totais": {
      "previstoMin": 8448, "trabalhadoMin": 8530,
      "extraMin": 286, "extras": { "50": 240, "100": 46 },
      "extra50Min": 240, "extra100Min": 46,
      "debitoMin": 204, "atrasoMin": 35, "atrasos": 2,
      "noturnoReduzidoMin": 0, "faltas": 0, "diasAfastado": 2,
      "saldoBancoMin": 82, "bancoAnteriorMin": -30, "bancoAcumuladoMin": 52
    }
  }]
}
```

`extras` traz os minutos por percentual, conforme as faixas configuradas pela empresa (ex.: `"60"`, `"100"`). `extra50Min` e `extra100Min` continuam vindo para integrações antigas. `bancoAcumuladoMin` soma o saldo dos meses fechados ainda dentro da validade do banco de horas.

O cadastro de funcionário (`PUT /api/v1/funcionarios/{codigoExterno}`) também aceita `departamentoId` e `filialId`.

Com `detalhado=true`, cada funcionário também traz `dias` com o cálculo dia a dia.

## Webhooks

Cadastre a URL do ERP em **Integrações (ERP) → Webhooks**. Eventos:

| Evento | Quando |
|---|---|
| `marcacao.criada` | Um funcionário bateu ponto |
| `tratamento.decidido` | O gestor aprovou ou rejeitou um ajuste |
| `funcionario.alterado` | Um funcionário foi criado ou alterado |
| `fechamento.concluido` | O RH fechou um período: bom momento para o ERP buscar `/api/v1/espelho` e lançar na folha |

Corpo enviado (POST, JSON):

```json
{ "evento": "marcacao.criada", "enviadoEm": "2026-10-23T22:11:00.000Z", "dados": { "...": "..." } }
```

### Como validar a assinatura

Cada envio traz `X-Ponto-Assinatura: sha256=<hex>`. Calcule `HMAC-SHA256(segredo_do_webhook, corpo_bruto)` e compare. Exemplo em Node:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function assinaturaValida(corpoBruto, header, segredo) {
  const esperado = "sha256=" + createHmac("sha256", segredo).update(corpoBruto).digest("hex");
  return header && esperado.length === header.length && timingSafeEqual(Buffer.from(esperado), Buffer.from(header));
}
```

Responda `2xx` em até 10 segundos. Nesta versão, um envio que falha **não é reenviado**. Por isso, use também `GET /api/v1/marcacoes` periodicamente para conciliar.
