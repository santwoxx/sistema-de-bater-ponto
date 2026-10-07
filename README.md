# Ponto Digital: registro de ponto com foto para várias empresas

Sistema de controle de ponto para lojas e pequenas empresas. **Tudo roda no Firebase** (site, regras de negócio, banco, fotos e login) e é publicado com um comando: `npm run publicar`.

- **Aparelho de ponto na loja** (tablet, celular ou computador com câmera): o funcionário digita a **matrícula** e o **PIN**, a foto é tirada automaticamente e o horário oficial vem do **servidor**, não do relógio do aparelho.
- **Painel do gestor** (navegador): escolha da empresa com busca por nome ou CNPJ, quem está em expediente agora, marcações com foto, espelho de ponto mensal com horas, saldo e faltas, além de funcionários, aparelhos, abonos e auditoria.
- **Várias empresas no mesmo sistema**: o administrador vê todas; cada gestor vê só as empresas liberadas para ele.

## Sumário

1. [Funcionalidades](#funcionalidades)
2. [Tudo roda no Firebase](#tudo-roda-no-firebase)
3. [Como o sistema é organizado](#como-o-sistema-é-organizado)
4. [Colocar no ar, passo a passo](#colocar-no-ar-passo-a-passo)
5. [Uso no dia a dia](#uso-no-dia-a-dia)
6. [Dados, histórico e backups](#dados-histórico-e-backups)
7. [Testar no computador, sem tocar na nuvem](#testar-no-computador-sem-tocar-na-nuvem)
8. [Segurança](#segurança)
9. [Aspectos legais: leia antes de usar com a equipe](#aspectos-legais-leia-antes-de-usar-com-a-equipe)
10. [Limitações conhecidas e próximos passos](#limitações-conhecidas-e-próximos-passos)

---

## Funcionalidades

### No aparelho da loja (`/ponto`)

- Teclado numérico grande (aceita também teclado físico), câmera ao vivo com moldura para o rosto e contagem regressiva de 3 segundos antes da foto.
- Comprovante na tela: nome, **Entrada/Saída**, hora, data, **NSR** (número sequencial do registro) e código de verificação.
- **"Esqueci de bater o ponto"**: o funcionário se identifica com matrícula e PIN e pede a inclusão do horário que faltou (dia, horário e motivo). Uma foto pequena é tirada como prova, e a marcação só vale depois que o gestor aprovar.
- **"Assinar meu espelho"**: com matrícula e PIN, o funcionário confere o espelho dos meses fechados (dia a dia e totais) e **assina** ou **contesta** explicando o que está errado. A assinatura registra data, hora, aparelho, foto e um código de verificação.
- **PIN pessoal**: o PIN que o gestor cadastra é provisório. No primeiro uso, o aparelho pede que o funcionário crie o dele, e ninguém da empresa fica sabendo. **"Trocar meu PIN"** permite trocá-lo quando quiser.
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
| **Exportar dados** | Baixa os dados de ponto da empresa escolhida, com filtros de período (até 12 meses), funcionários, origem e situação: **marcações** (uma linha por batida), **espelho diário**, **resumo por funcionário** (CSV que abre no Excel) ou **espelhos para imprimir/PDF**, um por folha. Cada exportação fica na auditoria |
| **Funcionários** | CPF, matrícula, cargo, admissão, jornada de cada dia da semana e PIN provisório (mostra quem ainda não criou o PIN pessoal) |
| **Aparelhos de ponto** | Aparelhos ativados, último sinal, último registro e desativação |
| **Auditoria** | Quem fez o quê e quando, com as justificativas. Bloqueios por PIN errado aparecem com a foto de quem tentou. **Verificação de integridade**: refaz a cadeia de hashes e aponta marcação apagada, inserida ou alterada, mesmo direto no banco |
| **Empresas** *(admin)* | CNPJ (inclusive o novo CNPJ alfanumérico), fuso horário, intervalo mínimo entre batidas, tolerância e início do controle de ponto |
| **Usuários** *(admin)* | Administradores e gestores, com as empresas que cada gestor acessa |

**Abonos** (no espelho) cobrem feriado, atestado, férias e folga. Valem para um funcionário ou para a empresa toda, por um dia ou por um período, inteiro ou parcial (ex.: 2 horas de consulta). Dia abonado não conta como falta.

---

## Tudo roda no Firebase

| Serviço | Para quê |
|---|---|
| Hosting | O site (painel e tela do ponto), com HTTPS (necessário para a câmera) e cabeçalhos de segurança |
| Cloud Functions | Toda gravação de dados: validação, horário oficial, NSR, auditoria, fotos e exportações |
| Cloud Firestore | Empresas, funcionários, marcações, abonos, espelhos e auditoria |
| Cloud Storage | Fotos das marcações (só as funções leem e gravam) |
| Authentication | Login dos gestores e conta própria de cada aparelho de ponto |
| Cloud Scheduler | Verificação automática da integridade das marcações, toda segunda-feira |

> **É preciso ativar o plano Blaze** (pago conforme o uso). Cloud Functions e Cloud Storage não funcionam no plano gratuito Spark. O Blaze mantém as cotas gratuitas e só cobra o que passar delas; para uma loja, o uso costuma ficar perto de zero. **Configure um alerta de orçamento** (ex.: R$ 20/mês) no Google Cloud para não ter surpresas.

---

## Como o sistema é organizado

```
Aparelho da loja (/ponto) ─────► Cloud Functions (São Paulo) ──► Firestore (dados) + Storage (fotos)
Painel do gestor (/admin) ─┬───►        ▲
                           └── leitura direta do Firestore, liberada pelas regras de segurança
```

O aparelho só fala com as funções. O painel lê o Firestore direto (as regras liberam só as empresas de cada gestor) e recebe as fotos pelas funções.

```
Sistema bater ponto/
├── package.json             comandos do projeto (preparar, verificar, publicar...) e o Firebase CLI fixado
├── firebase.json            configuração do Firebase (hosting, functions, banco, emuladores)
├── .firebaserc              projetos: "producao" (real) e "demo-ponto" (só emuladores)
├── firestore.rules          quem pode ler o quê no banco (ninguém grava direto)
├── firestore.indexes.json   índices do banco
├── storage.rules            fotos: nenhum navegador lê ou grava direto
├── scripts/
│   ├── publicar.mjs         publicação completa, com conferências antes e depois
│   └── conferir-configuracao.mjs  impede publicar o site apontando para o projeto errado
├── functions/               backend (Cloud Functions, TypeScript)
│   └── src/
│       ├── ponto.ts         registro do ponto: foto, NSR, cadeia de hashes
│       ├── identificacao.ts matrícula + PIN no aparelho, com bloqueios por erro
│       ├── pinPessoal.ts    o funcionário cria ou troca o próprio PIN
│       ├── cadeia.ts        cálculo e verificação da cadeia de hashes
│       ├── integridade.ts   verificação de integridade (no painel e toda segunda-feira)
│       ├── fotos.ts         entrega da foto ao painel, com conferência do hash
│       ├── limites.ts       limite de uso por usuário nas funções pesadas
│       ├── solicitacoes.ts  pedidos de marcação esquecida (pedir, aprovar, recusar)
│       ├── espelho.ts       cálculo do espelho (fonte única: servidor e painel usam o mesmo)
│       ├── fechamentos.ts   fechamento mensal, assinatura e contestação do espelho
│       ├── exportacao.ts    exportação com filtros (CSV e espelhos para impressão)
│       ├── ajustes.ts       incluir/desconsiderar marcação
│       ├── abonos.ts        feriados, atestados, férias
│       ├── funcionarios.ts, empresas.ts, usuarios.ts, dispositivos.ts, sistema.ts
│       └── validacao.ts, tempo.ts, seguranca.ts, acesso.ts, auditoria.ts
└── web/                     site (React + Vite, TypeScript)
    ├── src/paginas/ponto/   tela do aparelho de ponto (Terminal.tsx + componentes em terminal/)
    ├── src/paginas/admin/   painel do gestor
    └── testes/e2e.mjs       teste de ponta a ponta com os emuladores
```

**Modelo de dados (Firestore):**

```
sistema/estado
usuarios/{uid}                          nome, e-mail, papel (admin|gestor), empresas[]
auditoria/{id}                          ações globais (empresas, usuários)
limites/{uid}_{acao}                    contadores de limite de uso (inacessível pelo navegador)
empresas/{empresaId}                    nome, CNPJ, fuso, regras e resultado da verificação de integridade
  ├── funcionarios/{id}                 nome, CPF, matrícula, jornada
  ├── credenciais/{funcionarioId}       hash do PIN, se é provisório e bloqueios (inacessível pelo navegador)
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

### 1. Instale as ferramentas

1. **Node.js 24 LTS**: <https://nodejs.org> (instalador do Windows, opções padrão).
2. Na pasta do projeto, abra o terminal e rode:
   ```
   npm install
   npm run preparar
   ```
   O primeiro instala o **Firebase CLI na versão usada pelo projeto** (não precisa instalar nada global); o segundo, as dependências do site e das funções.

> **Windows:** se o PowerShell disser que "a execução de scripts foi desabilitada", use o **Prompt de Comando (cmd)** ou rode uma vez `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` no PowerShell.

### 2. Crie o projeto no Firebase

No [Console do Firebase](https://console.firebase.google.com):

1. **Adicionar projeto**, com o nome que quiser (ex.: `ponto-minhaloja`).
2. **Upgrade para o plano Blaze** (canto inferior esquerdo) e configure o alerta de orçamento.
3. **Authentication**: "Vamos começar" → método **E-mail/senha** → ativar. Depois, em **Configurações → Ações do usuário**, desmarque **"Ativar criação (inscrição)"** e **"Ativar exclusão"**: as contas são criadas só pelo administrador, então ninguém precisa se cadastrar sozinho.
4. **Storage**: "Vamos começar" → modo **produção** → local **southamerica-east1 (São Paulo)**. O console destaca as regiões dos EUA como "sem custo"; em São Paulo as fotos custam centavos por mês e ficam na mesma região do servidor.
5. **Configurações do projeto** (engrenagem) → **Seus apps** → ícone **Web `</>`** → registre o app (não precisa marcar Hosting aqui). Copie os valores de `firebaseConfig`.

O **banco (Firestore)** não precisa ser criado: a primeira publicação cria em São Paulo (`southamerica-east1`, definido no `firebase.json`). O local não pode ser mudado depois.

### 3. Configure o projeto

1. Na pasta `web`, copie `.env.example` para `.env` e preencha com os valores copiados (o arquivo fica fora do Git):
   ```
   VITE_FIREBASE_API_KEY=AIza...
   VITE_FIREBASE_AUTH_DOMAIN=ponto-minhaloja.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=ponto-minhaloja
   VITE_FIREBASE_STORAGE_BUCKET=ponto-minhaloja.firebasestorage.app
   VITE_FIREBASE_MESSAGING_SENDER_ID=1234567890
   VITE_FIREBASE_APP_ID=1:1234567890:web:abc123
   VITE_NOME_SISTEMA=Ponto Digital
   ```
2. No `.firebaserc`, o apelido **`producao`** aponta para o ID do projeto (hoje, `ponto-digital-2e2f9`). Troque se for outro.

### 4. Publique

```
npx firebase login
npm run publicar
```

O `firebase login` é feito uma vez por computador (entre com a conta Google dona do projeto). O `npm run publicar` faz tudo, em ordem, e para no primeiro problema, explicando o que corrigir:

1. confere o login e o acesso ao projeto;
2. confere se o `web/.env` é do mesmo projeto (nunca publica um site falando com o projeto errado) e gera o **código de instalação** em `functions/.env.SEU-PROJETO` (fora do Git);
3. confere se o login por e-mail/senha está ativo no Authentication;
4. roda `npm run verificar`: build, lint e testes. **Se algo falhar, nada é publicado**;
5. publica site, funções, regras e índices (`firebase deploy`) e confere no Cloud Run se cada função ficou no ar com a versão nova (as que não ficaram são publicadas de novo, só elas);
6. liga a **proteção contra exclusão**, a **recuperação pontual** e o **backup diário** do banco;
7. confere o site no ar (inclusive os cabeçalhos de segurança) e, no primeiro uso, mostra o código de instalação e abre a tela de configuração inicial.

A publicação não faz perguntas: cria o site do Hosting se faltar e aceita a limpeza automática das imagens antigas das funções. O índice do banco termina de ser criado alguns minutos depois; até lá, o filtro por funcionário pode avisar que o índice "está sendo criado".

**Cota de CPU.** Projetos novos têm 20 vCPU por região no Cloud Run, e cada cópia de função em execução reserva a sua parte (o deploy sobe uma cópia de cada função para testar). Por isso as funções usam CPU proporcional à memória (`gcf_gen1`, como as de 1ª geração) e poucas cópias (`maxInstances`); o teste `functions/src/cota.test.ts` garante que, mesmo com todas no máximo ao mesmo tempo, a soma cabe na cota. Para crescer além disso, peça mais "Total CPU allocation" do Cloud Run em Google Cloud > IAM e administrador > Cotas e só então aumente os `maxInstances`.

**Para atualizar o sistema depois de qualquer mudança, é o mesmo comando:** `npm run publicar`. Sem `--project`, os comandos do Firebase usam o projeto de testes `demo-ponto`, que só existe nos emuladores: nada vai para a nuvem por engano.

### 5. Primeiro acesso

1. Ao fim do `npm run publicar`, a tela **Configuração inicial** abre sozinha (ou abra `https://SEU-PROJETO.web.app/configuracao-inicial`).
2. Informe o **código de instalação** mostrado no terminal e crie a sua conta de administrador (só funciona uma vez). Faça isso logo depois da publicação.
3. Em **Empresas**, cadastre a primeira empresa.
4. Em **Usuários**, crie a conta da gestora e marque as empresas que ela pode acessar.
5. Em **Funcionários**, cadastre a equipe com matrícula e um **PIN provisório**. Entregue o PIN a cada pessoa: no primeiro uso do aparelho ela cria o PIN pessoal.

### 6. Coloque o aparelho na loja

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
- **Esqueceu o PIN ou foi bloqueado** (5 erros seguidos bloqueiam por 15 minutos; se repetir, 30 e depois 60): Funcionários → editar → **Redefinir o PIN**. O PIN volta a ser provisório e o funcionário cria um novo no aparelho.
- **Alertas de segurança:** a página **Hoje** mostra os bloqueios por PIN errado dos últimos 7 dias, com a foto de quem tentou. Se a verificação de integridade (automática, toda segunda-feira) encontrar marcação alterada ou apagada, uma faixa vermelha aparece no topo de todas as páginas.
- **Fechamento do mês** (no início do mês seguinte): **Fechamento mensal** → escolha o mês → **Fechar mês e enviar para assinatura**. Acompanhe quem assinou; quem contestou aparece com o motivo, e depois de corrigir você clica em **Reenviar**. O **CSV do mês** traz os totais de todos para a folha.
- **Consultar meses anteriores:** todas as telas aceitam qualquer período (Marcações, Espelho, Fechamento, Auditoria e Solicitações, com "carregar mais antigos"). Nada é apagado.
- **Algo mudou depois da assinatura:** o espelho avisa. No Fechamento mensal, use **Reabrir** com motivo: uma nova versão vai para assinatura e a assinada fica guardada.
- **Papel assinado:** Espelho de ponto → **Imprimir / PDF**. Se o funcionário já assinou no aparelho, a impressão sai com os dados da assinatura eletrônica. Para imprimir os espelhos de todos de uma vez: **Exportar dados → Espelhos para imprimir ou PDF**.
- **Arquivo para a contabilidade:** **Exportar dados** → Resumo por funcionário (totais) ou Espelho diário (dia a dia), no período e com os funcionários que quiser.
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

**Onde ficam os dados:** no **seu projeto Firebase** (Google Cloud), na região escolhida ao criar o banco (recomendado: São Paulo, `southamerica-east1`). Cada empresa tem a sua "pasta" separada, `empresas/{id}`, com funcionários, marcações, abonos, solicitações, espelhos fechados e auditoria. As fotos ficam no Cloud Storage, em `empresas/{id}/registros/AAAA-MM/`. Dá para ver tudo pelo painel ou, como administrador, no Console do Firebase (Firestore Database e Storage). O Google criptografa os dados armazenados.

**Baixar os dados de uma empresa:** página **Exportar dados** (escolha a empresa no topo, o tipo de arquivo, o período, os funcionários e os filtros). Também há exportações rápidas nas telas de Marcações (o que está filtrado na tela), Espelho de ponto (um funcionário) e Fechamento mensal (totais do mês).

- **Nada expira:** marcações, fotos, espelhos assinados (e suas versões anteriores), solicitações, abonos e auditoria ficam guardados sem prazo. Qualquer mês antigo pode ser consultado, fechado, assinado e impresso.
- **O que já protege os dados:** toda escrita passa pelo servidor com transações (sem registro pela metade ou duplicado), marcações nunca são apagadas, e a cadeia de hashes e a auditoria mostram qualquer alteração.
- **Backups do Firestore:** o `npm run publicar` já liga os três itens abaixo (dá para conferir no Console do Google Cloud → Firestore → **Disaster recovery**):
  1. **Proteção contra exclusão**: impede que o banco seja apagado por engano.
  2. **Recuperação pontual (PITR)**: permite voltar o banco a qualquer minuto dos últimos 7 dias.
  3. **Backups agendados**: um por dia, guardado por 14 semanas (98 dias).

  A proteção é gratuita. A recuperação e os backups custam centavos por mês no volume de uma loja.
- **Fotos:** os buckets novos do Storage guardam arquivos apagados por 7 dias (*soft delete*). Aumente esse prazo nas configurações do bucket, se quiser.
- **Custo de leitura:** a tela de Marcações traz no máximo 3.000 registros por consulta (os mais recentes) e avisa quando atinge o limite. Assim, um período longo não fica lento nem caro.

---

## Testar no computador, sem tocar na nuvem

Os emuladores do Firebase rodam tudo localmente (exigem **Java 21 ou mais novo**).

```
npm run emuladores
```

Em outro terminal, o site (fica rodando):

```
npm --prefix web run dev:emuladores
```

Para ter dados de exemplo, num terceiro terminal: `npm run dados:exemplo`.

Abra <http://localhost:5173>. Os dados somem quando os emuladores são fechados. Nos emuladores, o código de instalação é `TESTE-LOCAL` (arquivo `functions/.env.demo-ponto`).

**Comandos (na pasta raiz):**

| Comando | O que faz |
|---|---|
| `npm run verificar` | Build das funções e do site, lint (sem nenhum aviso permitido) e testes unitários: CPF, CNPJ, PIN, senhas, limpeza de textos, fusos, hash do PIN, limites de uso, cadeia de hashes, cálculo do espelho e textos do aparelho. O `npm run publicar` roda isto antes de publicar |
| `npm run testar:e2e` | 26 etapas de ponta a ponta com os emuladores: permissões de cada papel, código de instalação, PIN provisório e pessoal, registro com foto, NSR e cadeia de hashes, bloqueios (inclusive com tentativas em paralelo), fotos só pelo servidor, ajustes, abonos, solicitações, fechamento e assinatura, exportação, adulteração detectada, limites de uso, auditoria e desativação de aparelho |
| `npm run dados:exemplo` | Com os emuladores ligados, cria administrador, gestora, empresas, funcionários e o histórico do mês anterior, pronto para fechar e assinar (senha `ponto-teste-2026`; os PINs são provisórios) |
| `npm run logs` | Últimos registros das funções em produção |

No GitHub, cada envio roda o `npm run verificar`, a auditoria das dependências do backend e o teste de ponta a ponta (aba **Actions**). Essa verificação não tem acesso ao Firebase de produção.

---

## Segurança

**Dados e permissões**

- **O navegador nunca grava direto no banco.** Toda escrita passa pelas Cloud Functions, que validam cada campo, conferem a permissão e gravam a auditoria **na mesma transação** da alteração: não existe mudança sem rastro.
- **Leitura só para quem tem acesso à empresa.** Gestores veem apenas as empresas liberadas; o administrador vê todas e não consegue remover o próprio acesso. Usuário desativado perde o acesso na hora.
- **Aparelhos de ponto não leem nada do banco:** falam só com as funções, e cada um fica preso a uma empresa (no máximo 50 ativos por empresa).
- **Fotos sem link público.** O Storage não libera leitura para nenhum navegador; o painel recebe a foto pela função `obterFoto`, que confere o acesso e se o arquivo é o mesmo gravado na batida (aviso se tiver sido trocado).
- **Textos limpos:** caracteres invisíveis (que poderiam disfarçar nomes e motivos) são removidos, e o CSV neutraliza fórmulas do Excel.
- **Limites de uso por usuário** nas funções pesadas ou sensíveis (por hora: 30 exportações, 30 fechamentos, 10 verificações de integridade e 300 fotos abertas). Se uma conta for invadida, o estrago e o custo ficam contidos. Ajustáveis por projeto com `LIMITE_<AÇÃO>` no `functions/.env.SEU-PROJETO`.

**PIN e identificação no aparelho**

- **PIN pessoal:** o gestor só define um PIN provisório; o funcionário cria o dele no primeiro uso. Assim a empresa não conhece o PIN que bate o ponto e assina o espelho.
- **Guardado só como hash** (scrypt com sal), numa coleção que nenhum navegador lê. PINs óbvios (1234, 1111) são recusados.
- **Bloqueios:** 5 erros seguidos bloqueiam a matrícula por 15 minutos, depois 30, depois 1 hora; 25 erros em 15 minutos bloqueiam o aparelho. Cada tentativa é reservada numa transação **antes** de o PIN ser conferido, então disparar tentativas em paralelo não burla o limite. Todo bloqueio vai para a auditoria com a foto de quem tentou.
- **Sem pistas para quem tenta adivinhar:** matrícula inexistente e PIN errado dão a mesma resposta, no mesmo tempo.

**Marcações**

- **Horário do servidor:** mudar o relógio do tablet não altera a hora da batida.
- **Marcações imutáveis:** correções viram inclusões ou desconsiderações com justificativa. Nada é apagado.
- **NSR sequencial e cadeia de hashes (SHA-256)** por empresa: cada registro inclui o hash do anterior, da foto, da data e da hora. A **verificação de integridade** refaz a conta e aponta qualquer marcação apagada, inserida ou alterada, mesmo direto no banco. Ela roda **sozinha toda segunda-feira de madrugada** e também pode ser pedida na página Auditoria; se achar problema, o painel mostra uma faixa vermelha e a auditoria registra o alerta.
- **Sem batida duplicada:** intervalo mínimo entre batidas, e o reenvio automático após queda de internet nunca cria dois registros.

**Painel e logins**

- **Senhas de administradores e gestores:** mínimo de 8 caracteres, sem senhas comuns (12345678, senha123...) e sem o próprio e-mail.
- **"Manter conectado neste computador"** fica desmarcado por padrão: a sessão do painel termina quando o navegador fecha, o que protege computadores compartilhados. O aparelho de ponto continua sempre conectado.
- **Alertas de segurança** na página Hoje: bloqueios por PIN errado dos últimos 7 dias, com a foto de quem tentou.

**Site, publicação e código**

- **Política de segurança de conteúdo (CSP) estrita:** o site só carrega código dele mesmo e só se conecta ao Firebase; não pode ser embutido em outro site; a câmera só funciona nele.
- **Código de instalação** para criar o primeiro administrador.
- **Publicação conferida:** o `npm run publicar` só publica se build, lint e testes passarem, e o próprio deploy se recusa a publicar um site configurado para outro projeto ou para os emuladores.
- **Ferramentas fixadas:** o Firebase CLI tem versão fixa no `package.json` da raiz e as dependências vêm dos `package-lock.json` (`npm ci`).

**Configurações recomendadas no Console** (além das do passo 2):

- **Alerta de orçamento** no Google Cloud (ele avisa, não bloqueia).
- **Restrinja a chave da API** em Google Cloud → APIs e serviços → Credenciais → "Browser key": em "Restrições de aplicativos", escolha **Referenciadores HTTP** e informe `https://SEU-PROJETO.web.app/*` e `https://SEU-PROJETO.firebaseapp.com/*`. A chave aparece no site (é normal no Firebase), mas assim não serve em outro lugar.
- Senhas fortes para administradores e gestores: cada login dá acesso aos dados das empresas.

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
- **A foto não prova que a pessoa estava lá.** Não há detecção de vivacidade: uma foto de foto passaria. A foto serve de evidência para o gestor conferir.
- **Quem tem acesso físico a um computador usado como ponto** pode copiar a sessão do aparelho. Ainda assim, só consegue bater ponto com matrícula e PIN corretos (com os bloqueios acima). Prefira tablet em modo quiosque e desative aparelhos perdidos pelo painel.
- **O dono do projeto Firebase** tem acesso total ao banco pelo Console. A cadeia de hashes torna qualquer alteração visível na verificação de integridade, mas não a impede.
- **Próximos passos sugeridos:** arquivos AFD/AEJ (Portaria 671), banco de horas acumulado, envio do comprovante por e-mail, Firebase App Check, verificação em duas etapas (MFA) para gestores e alertas de solicitações pendentes por e-mail ou WhatsApp.
