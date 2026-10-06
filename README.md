# Ponto Digital: registro de ponto com foto para várias empresas

Sistema de controle de ponto para lojas e pequenas empresas, feito com Firebase.

- **Aparelho de ponto na loja** (tablet, celular ou computador com câmera): o funcionário digita a **matrícula** e o **PIN**, a foto é tirada automaticamente e o horário oficial vem do **servidor**, não do relógio do aparelho.
- **Painel do gestor** (navegador): escolha da empresa com busca por nome ou CNPJ, quem está em expediente agora, marcações com foto, espelho de ponto mensal com horas, saldo e faltas, além de funcionários, aparelhos, abonos e auditoria.
- **Várias empresas no mesmo sistema**: o administrador vê todas; cada gestor vê só as empresas liberadas para ele.

## Sumário

1. [Funcionalidades](#funcionalidades)
2. [Posso usar o Firebase?](#posso-usar-o-firebase)
3. [Como o sistema é organizado](#como-o-sistema-é-organizado)
4. [Colocar no ar, passo a passo](#colocar-no-ar-passo-a-passo)
5. [Uso no dia a dia](#uso-no-dia-a-dia)
6. [Dados, histórico e backups](#dados-histórico-e-backups)
7. [Publicar o site na Vercel (opcional)](#publicar-o-site-na-vercel-opcional)
8. [Testar no computador, sem tocar na nuvem](#testar-no-computador-sem-tocar-na-nuvem)
9. [Segurança](#segurança)
10. [Aspectos legais: leia antes de usar com a equipe](#aspectos-legais-leia-antes-de-usar-com-a-equipe)
11. [Limitações conhecidas e próximos passos](#limitações-conhecidas-e-próximos-passos)

---

## Funcionalidades

### No aparelho da loja (`/ponto`)

- Teclado numérico grande (aceita também teclado físico), câmera ao vivo com moldura para o rosto e contagem regressiva de 3 segundos antes da foto.
- Comprovante na tela: nome, **Entrada/Saída**, hora, data, **NSR** (número sequencial do registro) e código de verificação.
- **"Esqueci de bater o ponto"**: o funcionário se identifica com matrícula e PIN e pede a inclusão do horário que faltou (dia, horário e motivo). Uma foto pequena é tirada como prova, e a marcação só vale depois que o gestor aprovar.
- **"Assinar meu espelho"**: com matrícula e PIN, o funcionário confere o espelho dos meses fechados (dia a dia e totais) e **assina** ou **contesta** explicando o que está errado. A assinatura registra data, hora, aparelho, foto e um código de verificação.
- Relógio sincronizado com o servidor, aviso de "Sem internet", tela sempre acesa e tela cheia. Pode ser instalado como aplicativo (PWA).
- Ativado uma única vez por um gestor e desativável pelo painel a qualquer momento.

### No painel (`/admin`)

| Página | O que faz |
|---|---|
| **Hoje** | Quem está em expediente, quem saiu, quem está de férias ou atestado, marcações do dia em tempo real e aparelhos online |
| **Marcações** | Filtro por período e funcionário, foto de cada batida, inclusão manual com justificativa, desconsiderar ou restaurar uma batida, exportação CSV |
| **Solicitações** | Pedidos de marcação esquecida feitos pelo funcionário no aparelho ou registrados pelo gestor. Aprovar inclui a marcação; recusar exige motivo. Contador de pendentes no menu |
| **Espelho de ponto** | Qualquer mês, por funcionário: marcações, previsto, trabalhado, saldo, faltas e marcações ímpares. Lançamento de abonos. Mostra se o mês foi fechado e assinado e avisa se algo mudou depois. Impressão ou PDF (com os dados da assinatura eletrônica, quando houver) e CSV |
| **Fechamento mensal** | Congela o espelho de todos os funcionários de um mês e envia para assinatura. Mostra quem assinou, quem contestou e quem falta, com os totais de cada um; CSV do mês para a folha. Reabrir um espelho assinado exige motivo e guarda a versão anterior |
| **Funcionários** | CPF, matrícula, cargo, admissão, jornada de cada dia da semana e PIN |
| **Aparelhos de ponto** | Aparelhos ativados, último sinal, último registro e desativação |
| **Auditoria** | Quem fez o quê e quando, com as justificativas |
| **Empresas** *(admin)* | CNPJ (inclusive o novo CNPJ alfanumérico), fuso horário, intervalo mínimo entre batidas, tolerância e início do controle de ponto |
| **Usuários** *(admin)* | Administradores e gestores, com as empresas que cada gestor acessa |

**Abonos** (no espelho) cobrem feriado, atestado, férias e folga. Valem para um funcionário ou para a empresa toda, por um dia ou por um período, inteiro ou parcial (ex.: 2 horas de consulta). Dia abonado não conta como falta.

---

## Posso usar o Firebase?

**Sim.** O sistema foi feito para ele. Usa:

| Serviço | Para quê |
|---|---|
| Authentication | Login dos gestores e conta própria de cada aparelho de ponto |
| Cloud Firestore | Empresas, funcionários, marcações, abonos e auditoria |
| Cloud Storage | Fotos das marcações |
| Cloud Functions | Toda gravação de dados: validação, horário oficial, NSR e auditoria |
| Hosting | O site (painel e tela do ponto), com HTTPS, necessário para usar a câmera |

> **É preciso ativar o plano Blaze** (pago conforme o uso). Cloud Functions e Cloud Storage não funcionam no plano gratuito Spark. O Blaze mantém as cotas gratuitas e só cobra o que passar delas; para uma loja, o uso costuma ficar perto de zero. **Configure um alerta de orçamento** (ex.: R$ 20/mês) no Google Cloud para não ter surpresas.

---

## Como o sistema é organizado

```
Aparelho da loja (/ponto) ─┐
                           ├──► Cloud Functions (São Paulo) ──► Firestore (dados) + Storage (fotos)
Painel do gestor (/admin) ─┘          ▲
         └──────── leitura direta, liberada pelas regras de segurança ┘
```

```
Sistema bater ponto/
├── firebase.json            configuração do Firebase (hosting, functions, emuladores)
├── firestore.rules          quem pode ler o quê no banco (ninguém grava direto)
├── firestore.indexes.json   índices do banco
├── storage.rules            quem pode ver as fotos
├── functions/               backend (Cloud Functions, TypeScript)
│   └── src/
│       ├── ponto.ts         registro do ponto: foto, NSR, cadeia de hashes
│       ├── identificacao.ts matrícula + PIN no aparelho, com bloqueios por erro
│       ├── solicitacoes.ts  pedidos de marcação esquecida (pedir, aprovar, recusar)
│       ├── espelho.ts       cálculo do espelho (fonte única: servidor e painel usam o mesmo)
│       ├── fechamentos.ts   fechamento mensal, assinatura e contestação do espelho
│       ├── ajustes.ts       incluir/desconsiderar marcação
│       ├── abonos.ts        feriados, atestados, férias
│       ├── funcionarios.ts, empresas.ts, usuarios.ts, dispositivos.ts, sistema.ts
│       └── validacao.ts, tempo.ts, seguranca.ts, acesso.ts, auditoria.ts
└── web/                     site (React + Vite, TypeScript)
    ├── src/paginas/ponto/   tela do aparelho de ponto
    ├── src/paginas/admin/   painel do gestor
    ├── vercel.json          configuração para publicar o site na Vercel (opcional)
    └── testes/e2e.mjs       teste de ponta a ponta com os emuladores
```

**Modelo de dados (Firestore):**

```
sistema/estado
usuarios/{uid}                          nome, e-mail, papel (admin|gestor), empresas[]
auditoria/{id}                          ações globais (empresas, usuários)
empresas/{empresaId}                    nome, CNPJ, fuso, regras
  ├── funcionarios/{id}                 nome, CPF, matrícula, jornada
  ├── credenciais/{funcionarioId}       hash do PIN e bloqueio (inacessível pelo navegador)
  ├── registros/{id}                    marcações (imutáveis)
  ├── abonos/{id}                       feriados, atestados, férias
  ├── solicitacoes/{id}                 pedidos de marcação esquecida (pendente/aprovada/recusada)
  ├── espelhos/{funcionarioId_AAAA-MM}  espelho fechado (congelado, com hash) e sua assinatura
  │   └── versoes/{n}                   versões anteriores, quando um espelho é reaberto
  ├── dispositivos/{uid}                aparelhos de ponto
  ├── auditoria/{id}                    ações na empresa
  └── privado/controle                  último NSR e último hash (inacessível pelo navegador)
```

---

## Colocar no ar, passo a passo

### 1. Instale as ferramentas no computador

1. **Node.js 24 LTS**: <https://nodejs.org> (instalador do Windows, opções padrão).
2. **Firebase CLI**: abra o terminal e rode:
   ```
   npm install -g firebase-tools
   firebase login
   ```

> **Windows:** se o PowerShell disser que "a execução de scripts foi desabilitada", use o **Prompt de Comando (cmd)** ou rode uma vez `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` no PowerShell.

### 2. Crie o projeto no Firebase

No [Console do Firebase](https://console.firebase.google.com):

1. **Adicionar projeto**, com o nome que quiser (ex.: `ponto-minhaloja`).
2. **Upgrade para o plano Blaze** (canto inferior esquerdo) e configure o alerta de orçamento.
3. **Authentication**: "Vamos começar" → método **E-mail/senha** → ativar.
4. **Firestore Database**: "Criar banco de dados" → edição **Standard** → local **southamerica-east1 (São Paulo)** → modo **produção**.
5. **Storage**: "Vamos começar" → modo **produção** → local preferencialmente o mesmo do Firestore.
6. **Configurações do projeto** (engrenagem) → **Seus apps** → ícone **Web `</>`** → registre o app (não precisa marcar Hosting aqui). Copie os valores de `firebaseConfig`.

### 3. Configure o site

Na pasta `web`, copie o arquivo `.env.example` para `.env` e preencha com os valores copiados:

```
VITE_FIREBASE_API_KEY=AIza...
VITE_FIREBASE_AUTH_DOMAIN=ponto-minhaloja.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=ponto-minhaloja
VITE_FIREBASE_STORAGE_BUCKET=ponto-minhaloja.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=1234567890
VITE_FIREBASE_APP_ID=1:1234567890:web:abc123
VITE_NOME_SISTEMA=Ponto Digital
```

### 4. Instale as dependências

Na pasta raiz do projeto:

```
npm --prefix functions install
npm --prefix web install
```

### 5. Escolha o projeto e publique

```
firebase use --add        (escolha o seu projeto e dê o apelido "producao")
firebase deploy
```

O primeiro deploy leva alguns minutos. Durante ele:

- Se perguntar se o **Storage pode ler o Firestore** (regras entre serviços), responda **Sim**: é assim que as fotos ficam visíveis só para quem tem acesso à empresa.
- Se perguntar sobre **política de limpeza de imagens** das Functions, aceite o padrão.
- O índice do banco termina de ser criado alguns minutos depois. Até lá, o filtro por funcionário pode avisar que o índice "está sendo criado".

Ao final aparece o endereço do site, algo como `https://ponto-minhaloja.web.app`.

### 6. Primeiro acesso

1. Abra `https://SEU-PROJETO.web.app` → clique em **"Configure o sistema e crie o administrador"**.
2. Crie a sua conta de administrador (só funciona uma vez).
3. Em **Empresas**, cadastre a primeira empresa.
4. Em **Usuários**, crie a conta da gestora e marque as empresas que ela pode acessar.
5. Em **Funcionários**, cadastre a equipe com matrícula e PIN. Entregue o PIN a cada pessoa.

### 7. Coloque o aparelho na loja

1. No tablet ou celular, abra `https://SEU-PROJETO.web.app/ponto`.
2. Entre com o e-mail e a senha de um gestor, escolha a empresa e dê um nome ao aparelho (ex.: "Tablet do caixa").
3. **Permita a câmera** quando o navegador pedir.
4. Deixe o aparelho em modo quiosque:
   - **Android**: no Chrome, menu ⋮ → **Instalar app** (ou "Adicionar à tela inicial") → abra pelo ícone. Depois ative a **Fixação de app** (Configurações → Segurança) para ninguém sair da tela.
   - **iPad/iPhone**: no Safari, **Compartilhar → Adicionar à Tela de Início** e ative o **Acesso Guiado** (Ajustes → Acessibilidade).
   - **Computador com webcam**: Chrome ou Edge em tela cheia (F11).
5. Deixe o aparelho na tomada, com o rosto do funcionário na altura da câmera e boa iluminação.

---

## Uso no dia a dia

**Funcionário:** digita a matrícula → ✓ → digita o PIN → ✓ → olha para a câmera → vê o comprovante. A 1ª batida do dia é Entrada, a 2ª Saída, a 3ª Entrada, e assim por diante.

**Funcionário que esqueceu de bater:** no aparelho, toca em **"Esqueci de bater o ponto"** → matrícula → PIN → informa o dia (até 31 dias atrás), o horário e o motivo → envia. O pedido vai para a gestora.

**Funcionário assinando o espelho:** no aparelho, toca em **"Assinar meu espelho"** → matrícula → PIN → confere o mês dia a dia → **Concordo e assino** (ou **Não concordo**, explicando o que está errado).

**Gestora:**

- Escolha a empresa no topo da tela (busca por nome ou CNPJ).
- **Solicitações** (o número ao lado do menu mostra as pendentes): veja o pedido com a foto de quem pediu e as marcações que já existem no dia, e **Aprove** (a marcação é incluída) ou **Recuse** (com motivo).
- **Funcionário avisou que esqueceu:** Solicitações → **Nova solicitação** → marque "Aprovar e incluir a marcação agora" (ou deixe pendente para outra pessoa analisar). Também dá para incluir direto pelo Espelho de ponto → botão **+** no dia.
- **Batida duplicada ou errada:** abra a marcação → **Desconsiderar** (com motivo). A original continua guardada.
- **Feriado, atestado ou férias:** Espelho de ponto → **Lançar abono** (ou o ícone de calendário no dia).
- **Esqueceu o PIN ou foi bloqueado** (5 erros seguidos bloqueiam por 15 minutos): Funcionários → editar → **Redefinir o PIN**.
- **Fechamento do mês** (no início do mês seguinte): **Fechamento mensal** → escolha o mês → **Fechar mês e enviar para assinatura**. Acompanhe quem assinou; quem contestou aparece com o motivo, e depois de corrigir você clica em **Reenviar**. O **CSV do mês** traz os totais de todos para a folha.
- **Consultar meses anteriores:** todas as telas aceitam qualquer período (Marcações, Espelho, Fechamento, Auditoria e Solicitações, com "carregar mais antigos"). Nada é apagado.
- **Algo mudou depois da assinatura:** o espelho avisa. No Fechamento mensal, use **Reabrir** com motivo: uma nova versão vai para assinatura e a assinada fica guardada.
- **Papel assinado:** Espelho de ponto → **Imprimir / PDF**. Se o funcionário já assinou no aparelho, a impressão sai com os dados da assinatura eletrônica.
- **Aparelho perdido ou trocado:** Aparelhos de ponto → **Desativar**. Ele para de registrar na hora.

**Ajustes por empresa** (Empresas → editar):

| Campo | Para quê | Padrão |
|---|---|---|
| Fuso horário | Define o dia e a hora das marcações (o Brasil tem 4 fusos) | Brasília |
| Intervalo mínimo entre batidas | Evita batida duplicada por engano | 2 min |
| Tolerância diária no saldo | Diferenças até esse limite não geram saldo no dia | 10 min |
| Início do controle de ponto | Antes dessa data, dia sem marcação não é falta (útil ao implantar no meio do mês) | data do cadastro |

---

## Dados, histórico e backups

- **Nada expira:** marcações, fotos, espelhos assinados (e suas versões anteriores), solicitações, abonos e auditoria ficam guardados sem prazo. Qualquer mês antigo pode ser consultado, fechado, assinado e impresso.
- **O que já protege os dados:** toda escrita passa pelo servidor com transações (sem registro pela metade ou duplicado), marcações nunca são apagadas, e a cadeia de hashes e a auditoria mostram qualquer alteração.
- **Ative os backups do Firestore** (recomendado antes de usar em produção). No Console do Google Cloud → Firestore → **Disaster recovery**:
  1. **Recuperação pontual (PITR)**: permite voltar o banco a qualquer minuto dos últimos 7 dias.
  2. **Backups agendados**: crie um diário com retenção de 14 semanas.
- **Fotos:** os buckets novos do Storage guardam arquivos apagados por 7 dias (*soft delete*). Aumente esse prazo nas configurações do bucket, se quiser.
- **Custo de leitura:** a tela de Marcações traz no máximo 3.000 registros por consulta (os mais recentes) e avisa quando atinge o limite. Assim, um período longo não fica lento nem caro.

---

## Publicar o site na Vercel (opcional)

O sistema tem duas partes:

- **Site** (painel e tela do ponto): pode ficar no Firebase Hosting (já configurado) **ou** na Vercel.
- **Banco, fotos, login e regras de negócio**: ficam **sempre no Firebase**. A Vercel não hospeda o Firestore, o Storage nem as Cloud Functions, então o passo 5 (`firebase deploy`) continua necessário.

Para usar a Vercel no lugar do Firebase Hosting:

1. Em <https://vercel.com/new>, importe o repositório do GitHub.
2. **Root Directory:** `web`. Deixe marcada a opção de incluir arquivos fora do Root Directory: o cálculo do espelho fica em `functions/src/espelho.ts` e é compartilhado com o site.
3. **Environment Variables:** as mesmas do `web/.env` (`VITE_FIREBASE_API_KEY` etc.).
4. **Deploy.** O `web/vercel.json` já configura as rotas, a permissão de câmera e o cache. Cada envio ao GitHub publica uma versão nova.
5. Publique o backend com `firebase deploy --only functions,firestore,storage` (sem o Hosting).

> O plano gratuito da Vercel (Hobby) é para uso pessoal e **não comercial**. Para empresas, os termos pedem o plano Pro (pago). O Firebase Hosting não tem essa restrição e já está incluído no projeto.

---

## Testar no computador, sem tocar na nuvem

Os emuladores do Firebase rodam tudo localmente (exigem **Java 21 ou mais novo**).

```
npm --prefix functions run build
firebase emulators:start --project demo-ponto --only auth,firestore,functions,storage
```

Em outro terminal:

```
cd web
npm run dev:emuladores
```

Abra <http://localhost:5173>. Os dados somem quando os emuladores são fechados.

**Testes automáticos:**

| Comando (na pasta indicada) | O que testa |
|---|---|
| `functions`: `npm test` | CPF, CNPJ (inclusive alfanumérico), PIN, matrícula e fusos horários |
| `web`: `npm test` | Cálculo do espelho (pares, saldo, tolerância, faltas, abonos, início do controle) e mensagens de erro |
| `web`: `npm run test:e2e` | 21 etapas de ponta a ponta com os emuladores: permissões de cada papel, registro com foto, NSR, cadeia de hashes, bloqueio de PIN, ajustes, abonos, solicitações, fechamento e assinatura do espelho, auditoria e desativação de aparelho |
| `web`: `npm run dados:exemplo` | Com os emuladores ligados, cria administrador, gestora, empresas, funcionários e o histórico do mês anterior, pronto para fechar e assinar (senha `senha1234`) |

---

## Segurança

- **O navegador nunca grava direto no banco.** Toda escrita passa pelas Cloud Functions, que validam os dados, conferem a permissão e registram na auditoria. As regras do Firestore e do Storage só liberam leitura para quem tem acesso à empresa.
- **Horário do servidor:** mudar o relógio do tablet não altera a hora da batida.
- **PIN:** guardado só como hash (scrypt com sal), numa coleção que nenhum navegador lê. PINs óbvios (1234, 1111) são recusados. 5 erros seguidos bloqueiam a matrícula por 15 minutos, e muitos erros no mesmo aparelho bloqueiam o aparelho temporariamente.
- **Foto em toda batida**, gravada pelo servidor e visível só para gestores da empresa.
- **Marcações imutáveis:** correções viram inclusões ou desconsiderações com justificativa. Nada é apagado.
- **NSR sequencial e cadeia de hashes (SHA-256)** por empresa: cada registro inclui o hash do anterior e o da foto. Apagar ou alterar uma marcação quebra a cadeia, o que torna a adulteração detectável.
- **Sem batida duplicada:** intervalo mínimo entre batidas, e o reenvio automático após queda de internet nunca cria dois registros.
- **Aparelhos com conta própria**, presos a uma empresa, que só registram ponto: não leem funcionários nem marcações.
- **Papéis:** administrador (tudo) e gestor (só as empresas liberadas). Um administrador não consegue remover o próprio acesso.

---

## Aspectos legais: leia antes de usar com a equipe

> **Este sistema não é um REP-P homologado.** Confirme com o contador ou o advogado trabalhista de cada empresa antes de usá-lo como controle oficial de jornada.

- Pela CLT (art. 74, §2º), estabelecimentos com **mais de 20 empregados** são obrigados a registrar entrada e saída.
- O registro **eletrônico** de ponto é regulado pela **Portaria MTP nº 671/2021**. Para sistemas via programa (**REP-P**), ela exige, entre outros pontos, registro do programa no **INPI**, comprovante para o trabalhador, geração dos arquivos **AFD** e **AEJ** e assinatura eletrônica.
- O sistema já tem a base que essas regras pedem: horário do servidor, NSR sequencial, marcações imutáveis, ajustes justificados, trilha de auditoria, comprovante na tela e espelho mensal congelado e assinado pelo funcionário. **Ainda faltam** os arquivos AFD/AEJ, a assinatura digital com certificado (ICP-Brasil) dos arquivos, o comprovante enviado ao trabalhador e o registro no INPI.
- **Assinatura do espelho:** é uma assinatura eletrônica *simples* (matrícula + PIN pessoal + foto + data, hora e aparelho, ligada ao conteúdo exato do espelho por um hash). Ela documenta a concordância do funcionário, mas não substitui um certificado digital. Peça ao contador ou advogado para validar o uso como comprovante.
- **LGPD:** a foto é dado pessoal. O sistema a usa só como prova visual da batida e não faz reconhecimento facial (que seria dado biométrico sensível). Informe os funcionários por escrito sobre a coleta, a finalidade e o prazo de guarda. Mantenha os registros por pelo menos 5 anos (prazo de prescrição trabalhista).

---

## Limitações conhecidas e próximos passos

- **Exige internet no momento da batida.** A tela abre sem internet, mas o registro precisa de conexão. Registro offline com envio posterior é uma evolução possível.
- **Turnos que atravessam a meia-noite** contam no dia de cada marcação. Para turnos noturnos, o espelho precisaria do conceito de "dia de trabalho".
- **Escalas (12x36 etc.)** não são calculadas automaticamente: a jornada é por dia da semana. Use folgas e abonos para ajustar.
- **Horas extras e adicional noturno** aparecem como saldo, sem percentuais (50%, 100%).
- **Banco de horas** é calculado mês a mês; o saldo de um mês ainda não é levado automaticamente para o seguinte.
- **Próximos passos sugeridos:** arquivos AFD/AEJ (Portaria 671), banco de horas acumulado, envio do comprovante por e-mail, Firebase App Check e alertas de solicitações pendentes por e-mail ou WhatsApp.
