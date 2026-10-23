# Sistema de Ponto

Ponto eletrônico SaaS multiempresa: o funcionário bate ponto no celular ou no computador, o RH acompanha e ajusta, e o ERP recebe tudo por API.

## Rodar localmente

Requer Node.js 20 ou mais novo.

```bash
npm install
npx prisma db push
npm run db:seed
npm run dev
```

Abra http://localhost:3000. Logins de demonstração (criados pelo seed):

- RH: `admin@demo.com.br` / `demo12345`
- Funcionária: `maria@demo.com.br` / `demo12345`

Câmera e GPS no navegador só funcionam em `localhost` ou em HTTPS.

## O que já tem

**Funcionário (`/ponto`, instalável no celular como app)**
- Bater ponto com foto (selfie) e localização GPS
- Cerca virtual: só aceita o registro dentro do raio dos locais cadastrados
- Funciona sem internet: guarda a marcação no aparelho e envia quando voltar
- Comprovante de cada registro (NSR, data e hora, código de verificação)
- Espelho do mês e pedido de ajuste (esquecimento, atestado)

**RH (`/admin`)**
- Painel do dia: quem já bateu ponto, últimas marcações, fotos
- Funcionários, com acesso ao app
- Jornadas semanais e escalas em ciclo (12x36, 6x2…), com tolerância
- Espelho de ponto com extras 50% e 100%, adicional noturno (hora reduzida), débitos, faltas, banco de horas e alertas de CLT (intervalo, interjornada, limite de 2h extras)
- Ajustes sem alterar a marcação original: incluir, desconsiderar, abonar
- Aprovação das solicitações dos funcionários
- Locais permitidos e feriados
- Exportação do AFD
- Chaves de API e webhooks para o ERP

**Reconhecimento facial com prova de vida** (opcional por funcionário)
- O RH cadastra o rosto de referência (câmera ou arquivo); o sistema recusa foto virada, pequena ou com mais de uma pessoa
- Na hora do ponto, o servidor sorteia um desafio: olhar de frente e virar o rosto para um lado (esquerda ou direita)
- O celular guia a pessoa e tira as fotos sozinho quando ela está na posição certa
- O servidor confere em cada foto a posição da cabeça e se o rosto é o mesmo do cadastro; foto impressa ou tela parada não passa
- Tentativas recusadas ficam no painel do RH, com foto, para auditoria
- Sem internet, o aparelho sorteia o desafio e a marcação fica sinalizada como "offline" para o RH

Como funciona: [src/services/facial.ts](src/services/facial.ts) (regras e limites) e [public/face-cliente.js](public/face-cliente.js) (guia no navegador). Roda no próprio servidor (TensorFlow em WebAssembly, ~1 s por foto), sem serviço pago.

Limites conhecidos: não é uma detecção de ataque certificada (ISO 30107-3); um vídeo gravado da pessoa virando para os lados ainda pode passar. Para clientes que exigem mais segurança, dá para plugar um serviço como AWS Rekognition Face Liveness no mesmo ponto do código. O desafio fica em memória: com mais de um servidor, mover para Redis ou banco.

**Integração com ERP**: veja [docs/integracao-erp.md](docs/integracao-erp.md).

## Estrutura

```
prisma/schema.prisma      modelo de dados (multiempresa)
src/lib/calculo.ts        motor de cálculo de jornada (com testes)
src/services/             registro de marcação, espelho, AFD, webhooks
src/routes/               auth, admin (RH), ponto (funcionário), api-v1 (ERP)
public/                   telas (HTML/JS sem build) e PWA
```

Comandos: `npm test` (testes do cálculo), `npm run typecheck`.

## Antes de vender: o que falta

### Exigências legais (Portaria MTP 671/2021, REP-P)
- [ ] Registrar o programa no INPI e informar o número em `REGISTRO_INPI`
- [ ] Conferir o leiaute do AFD campo a campo com o Anexo V vigente e testar no validador oficial (`src/services/afd.ts`)
- [ ] Assinar digitalmente o AFD (arquivo .p7s com certificado ICP-Brasil)
- [ ] Gerar o AEJ (Arquivo Eletrônico de Jornada)
- [ ] Comprovante de registro em PDF assinado eletronicamente
- [ ] Atestado Técnico e Termo de Responsabilidade
- [ ] Validar tudo com um advogado trabalhista ou consultor especializado

### LGPD
- [ ] Termo de consentimento para foto, biometria facial e localização (biometria é dado sensível)
- [ ] Política de retenção e exclusão das fotos
- [ ] Guardar as fotos em armazenamento privado (S3 ou similar) em vez do disco local

### Produto
- [ ] Testar o reconhecimento facial com pessoas reais em vários celulares e ajustar o rigor (`limiarFacial`, padrão 0,5) e criar a tela para o RH mudar esse valor
- [ ] Desempenho do facial com muitos funcionários batendo ponto ao mesmo tempo: em Linux, trocar o WebAssembly por `@tensorflow/tfjs-node` (bem mais rápido) ou processar em workers
- [ ] Regras de convenção coletiva (percentuais de extra por faixa, banco de horas com vencimento)
- [ ] Fechamento de período e assinatura do espelho pelo funcionário
- [ ] Exportação para folha e eSocial
- [ ] Reenvio automático de webhooks que falharam
- [ ] Recuperação de senha por e-mail
- [ ] Planos e cobrança (assinatura mensal por funcionário ativo)
- [ ] App nativo (opcional: o PWA já instala no celular)

## Produção

### Render (configurado em `render.yaml`)

No painel do Render: **New → Blueprint**, escolha este repositório e confirme. Ele cria o servidor web, gera o `JWT_SECRET` e usa HTTPS automaticamente.

O banco não é criado pelo Blueprint, porque o Render permite só um PostgreSQL grátis por conta. Quando o Render pedir o `DATABASE_URL`, cole a **Internal Database URL** de um banco que você já tem e acrescente `?schema=ponto` no final. As tabelas do ponto ficam num schema próprio, separadas das de outros sistemas no mesmo banco.

- No build, `scripts/usar-postgres.mjs` troca o banco do Prisma de SQLite (usado no seu computador) para PostgreSQL. Você não precisa mexer no schema.
- Na subida, `prisma db push` cria ou atualiza as tabelas.
- O banco começa vazio. Entre pelo link do serviço e use **Comece o teste grátis** para criar a primeira empresa.

Plano gratuito (configuração atual):
- O servidor dorme depois de 15 min sem uso; o primeiro acesso depois disso leva cerca de 1 min.
- O banco gratuito do Render expira em 30 dias (vale para o banco compartilhado também).
- As fotos das marcações se perdem a cada novo deploy (não há disco permanente).
- **Reconhecimento facial desligado** (`FACIAL_ATIVO=false`): ele usa ~500 MB e o plano tem 512 MB no total. Quem tiver o facial marcado bate ponto com foto simples.

Para usar com clientes: servidor no plano **Standard** (2 GB) com `FACIAL_ATIVO=true`, banco pago e um disco permanente para as fotos com `UPLOADS_DIR` apontando para ele (veja os comentários no `render.yaml`).

### Variáveis de ambiente

| Variável | Para quê |
|---|---|
| `DATABASE_URL` | Conexão com o banco |
| `JWT_SECRET` | Segredo dos logins (longo e aleatório) |
| `FACIAL_ATIVO` | `false` desliga o reconhecimento facial e economiza ~400 MB |
| `UPLOADS_DIR` | Pasta das fotos (padrão: `uploads`) |
| `PORT` | Porta do servidor (o Render define sozinho) |

Câmera e GPS só funcionam em HTTPS (o Render já entrega com HTTPS).
