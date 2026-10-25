# Sistema de Ponto

Ponto eletrônico SaaS multiempresa: o funcionário bate ponto no celular, no computador ou no tablet da empresa; o RH acompanha, ajusta, fecha o mês e exporta para a folha; o ERP recebe tudo por API.

## Rodar localmente

Requer Node.js 22 ou mais novo.

```bash
npm install
npx prisma db push
npm run db:seed
npm run dev
```

Abra http://localhost:3000. Logins de demonstração (criados pelo seed):

- RH: `admin@demo.com.br` / `demo12345`
- Funcionária: `maria@demo.com.br` / `demo12345`

Câmera e GPS no navegador só funcionam em `localhost` ou em HTTPS. Sem SMTP configurado, os e-mails (convites, "esqueci a senha") aparecem no log do servidor.

## O que tem

**Funcionário (`/ponto`, instalável no celular como app)**
- Home com foto e cargo, logo da empresa, últimos registros, "próximo registro" com progresso das batidas, informativos, banco de horas (crédito/débito/acumulado), gráfico da semana com meta e atalhos
- Barra inferior: Home, Arquivos, botão de câmera para bater ponto, Suporte e Menu
- Espelho em cartões por dia, histórico com a foto de cada batida, arquivos recebidos (contracheques e folhas de ponto) para abrir e assinar, suporte com WhatsApp/telefone/e-mail do RH e mensagem
- Comunicados da empresa; os importantes abrem sozinhos uma vez
- Bater ponto com foto, GPS e cerca virtual; o botão mostra se é entrada ou saída
- Funciona sem internet: guarda a marcação no aparelho e envia quando voltar
- Comprovante de cada registro, inclusive em PDF assinado digitalmente
- Espelho do mês, pedido de ajuste e envio de atestado com foto
- Assinatura eletrônica do espelho fechado (com a senha) ou contestação
- Notificações no celular: lembrete de bater o ponto, resposta dos pedidos, espelho para assinar
- Termo de uso dos dados (LGPD) aceito no primeiro acesso
- Convite por e-mail ou WhatsApp para criar a senha; "esqueci minha senha"

**Quiosque (`/quiosque`, tablet na entrada da empresa)**
- Pareado uma vez com um código de 6 números gerado pelo RH
- Ponto por rosto (o servidor identifica quem é entre todos os cadastrados) ou por matrícula + PIN com foto
- PIN errado 5 vezes bloqueia por 15 minutos

**RH (`/admin`)**
- Painel do dia, roteiro de primeiros passos e indicadores do mês (absenteísmo, horas extras, atrasos, banco de horas por departamento, quem está trabalhando agora, no mapa)
- Funcionários, com importação por planilha CSV
- Filiais, departamentos e gestores: cada gestor vê e aprova só a equipe dele; um funcionário pode ser promovido a gestor e continua batendo ponto pelo app
- Jornadas semanais e escalas em ciclo (12x36, 6x2…)
- Regras da convenção coletiva: faixas de hora extra, percentual de domingo/feriado, hora noturna, banco de horas com validade
- Feriados nacionais em um clique; feriados municipais por filial
- Férias, atestados e afastamentos (sem falta e sem débito)
- Espelho de ponto com ajustes que nunca alteram a marcação original
- Fechamento do mês: congela o espelho, pede a assinatura de cada funcionário, permite reabrir com motivo registrado
- Comunicados para o app (com imagem, cor, público e contagem de leituras)
- Documentos para o funcionário (contracheque, informe de rendimentos…), um a um ou em lote identificando a pessoa pelo CPF ou matrícula no nome do arquivo, com assinatura no app
- Logo da empresa e contatos de suporte mostrados no app
- Exportação para a folha em CSV configurável (código de cada evento, separador, horas decimais ou HH:MM)
- AFD, AEJ e AFD assinado (.p7s); chaves de API e webhooks para o ERP
- Minhas notificações (cada gestor e administrador escolhe o que recebe e por onde: desligado, painel/celular ou também e-mail): batida da equipe (todas ou só fora do horário), entrada não registrada (15, 30 ou 60 min), dia encerrado com batida faltando (1, 2 ou 4 h depois), hora extra acima de 2h, pedidos, contestações, rosto recusado e resumo diário no horário escolhido
- Conta: plano, funcionários ativos, prazo de guarda das fotos (LGPD)

**Dono do SaaS (`/superadmin`)**: lista as empresas clientes, funcionários ativos, último ponto e receita estimada; muda o plano, estende o teste e bloqueia ou libera o acesso. Acesso para os e-mails em `SUPERADMIN_EMAILS`.

**Reconhecimento facial com prova de vida** (opcional por funcionário): o servidor sorteia um desafio (olhar de frente e virar o rosto para um lado), confere a posição da cabeça e compara com o rosto do cadastro. Tentativas recusadas ficam no painel do RH, com foto. Detalhes e limites em [src/services/facial.ts](src/services/facial.ts). Precisa de ~500 MB de memória (veja Produção).

**Integração com ERP**: veja [docs/integracao-erp.md](docs/integracao-erp.md).

## Estrutura

```
prisma/schema.prisma      modelo de dados (multiempresa)
src/lib/calculo.ts        motor de cálculo de jornada (com testes)
src/lib/regras.ts         regras da convenção coletiva
src/services/             marcação, espelho, fechamento, folha, AFD/AEJ, certificado, facial, alertas…
src/routes/               auth, admin* (RH), ponto (funcionário), quiosque, conta/superadmin, api-v1 (ERP)
public/                   telas (HTML/JS sem build): ponto, quiosque, admin + public/rh/ (uma tela por arquivo)
```

Comandos: `npm test` (testes do cálculo), `npm run typecheck`.

## Antes de vender: o que ainda falta

### Exigências legais (Portaria MTP 671/2021, REP-P)
- [ ] Registrar o programa no INPI e informar o número em `REGISTRO_INPI`
- [ ] Conferir o leiaute do AFD e do AEJ campo a campo com os Anexos V e VI vigentes e validar no validador oficial ([afd.ts](src/services/afd.ts), [aej.ts](src/services/aej.ts))
- [ ] Configurar o certificado digital ICP-Brasil da empresa (veja abaixo)
- [ ] Atestado Técnico e Termo de Responsabilidade
- [ ] Validar com um advogado trabalhista e revisar o texto do termo LGPD ([src/lib/lgpd.ts](src/lib/lgpd.ts))

### Produto
- [ ] Definir preços e limites dos planos ([src/lib/planos.ts](src/lib/planos.ts) tem valores de exemplo) e integrar um meio de pagamento (Asaas, Stripe…); hoje o plano é mudado à mão em `/superadmin`
- [ ] Testar o reconhecimento facial com pessoas reais em vários celulares e ajustar o rigor (`limiarFacial`, padrão 0,5)
- [ ] Reenvio automático de webhooks que falharam
- [ ] Guardar fotos em armazenamento de objetos (S3 ou similar) em vez de disco
- [ ] Alertas de jornada para turnos que viram a meia-noite (hoje ficam de fora)

## Produção

### Render (configurado em `render.yaml`)

No painel do Render: **New → Blueprint**, escolha este repositório e confirme. Ele cria o servidor web, gera o `JWT_SECRET` e usa HTTPS automaticamente. O banco fica no [Neon](https://neon.tech): copie a connection string com **Connection pooling desligado** (sem `-pooler`) e sem `&channel_binding=require`, e cole no `DATABASE_URL`.

- No build, `scripts/usar-postgres.mjs` troca o banco do Prisma de SQLite (seu computador) para PostgreSQL.
- Na subida, `prisma db push` cria ou atualiza as tabelas. Mudanças no schema devem ser só aditivas.
- Empresas novas ganham 14 dias de teste. Empresas criadas antes disso não têm data de fim de teste e não são bloqueadas; ajuste o plano delas em `/superadmin`.

Plano gratuito (configuração atual):
- O servidor dorme depois de 15 min sem uso; o primeiro acesso leva cerca de 1 min. **Enquanto dorme, os alertas automáticos não rodam.**
- As fotos se perdem a cada deploy (não há disco permanente).
- **Reconhecimento facial desligado** (`FACIAL_ATIVO=false`): ele usa ~500 MB e o plano tem 512 MB. Quem tiver o facial marcado bate ponto com foto simples; o quiosque usa matrícula + PIN.

Para clientes reais: servidor **Standard** (2 GB) com `FACIAL_ATIVO=true`, disco permanente com `UPLOADS_DIR` e banco pago.

### Certificado digital

Para assinar o AFD (.p7s) e o comprovante em PDF, use o certificado A1 (arquivo `.pfx`) da empresa:

```bash
base64 -w0 certificado.pfx
```

Cole o resultado em `CERT_PFX_BASE64` e a senha em `CERT_SENHA`. A tela Integrações mostra o titular e a validade. Sem certificado, os arquivos saem sem assinatura.

### E-mail

Configure um servidor SMTP (Gmail com senha de app, Brevo, Resend, Amazon SES…) em `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e `EMAIL_REMETENTE` (ex.: `Ponto <ponto@suaempresa.com.br>`). Sem SMTP, convites e redefinição de senha só aparecem no log; o RH ainda pode copiar o link do convite e mandar pelo WhatsApp.

### Variáveis de ambiente

| Variável | Para quê |
|---|---|
| `DATABASE_URL` | Conexão com o banco |
| `JWT_SECRET` | Segredo dos logins (longo e aleatório) |
| `FACIAL_ATIVO` | `false` desliga o reconhecimento facial e economiza ~400 MB |
| `UPLOADS_DIR` | Pasta das fotos (padrão: `uploads`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_REMETENTE` | Envio de e-mails |
| `APP_URL` | Endereço público usado nos links dos e-mails (no Render é automático) |
| `CERT_PFX_BASE64`, `CERT_SENHA` | Certificado digital A1 para assinar AFD e comprovantes |
| `REGISTRO_INPI`, `FABRICANTE_CNPJ`, `FABRICANTE_NOME`, `FABRICANTE_EMAIL` | Dados do programa no AFD/AEJ |
| `SUPERADMIN_EMAILS` | E-mails (separados por vírgula) com acesso a `/superadmin` |
| `CONTATO_VENDAS` | Contato mostrado na tela de planos (ex.: WhatsApp) |
| `ALERTAS_ATIVOS` | `false` desliga os alertas automáticos |
| `SEED_DEMO` | `true` cria a empresa de demonstração na subida (`admin@demo.com.br` e `maria@demo.com.br`, senha `demo12345`), só se ainda não existir. Como a senha está no código, troque-a depois ou use só para demonstração |
| `PORT` | Porta do servidor (o Render define sozinho) |
