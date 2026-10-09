# Ponto Digital: registro de ponto com foto para várias empresas

Sistema de controle de ponto para lojas e pequenas empresas. **Tudo roda no Firebase** (site, regras de negócio, banco, fotos e login) e é publicado com um comando: `npm run publicar`.

- **Aparelho de ponto na loja** (tablet, celular ou computador com câmera): o funcionário só **bate o ponto**. Digita o **CPF** e o **PIN de 4 números** criado pelo gestor (sem matrícula), a foto é tirada automaticamente e a hora registrada é a do momento da foto, vinda do **servidor** (não dá para adiantar ou atrasar mexendo no relógio do aparelho).
- **Painel do gestor** (navegador): escolha da empresa com busca por nome ou CNPJ, quem está em expediente agora, marcações com foto, espelho de ponto mensal com horas, saldo e faltas, além de funcionários, aparelhos, abonos e auditoria. **Ajustes, solicitações, faltas, atrasos e o fechamento do mês são só do gestor.**
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
- **Só bater o ponto:** o funcionário não pede inclusão de horário, não justifica atraso nem mexe no espelho. Mesmo quem chega atrasado registra com a foto, na hora em que chegou. Marcação esquecida, faltas, atrasos, abonos e o fechamento do mês ficam com o gestor, no painel.
- **CPF + PIN, sem matrícula:** o funcionário se identifica pelo CPF (que todo mundo sabe de cor) e confirma com um PIN de 4 números, definido pelo gestor no cadastro (o painel sugere um sorteado). Se o CPF tiver um erro de digitação, o aparelho avisa na hora. Esqueceu o PIN ou alguém descobriu: o gestor troca no painel.
- **Sem internet, o ponto continua:** a batida (com foto) fica guardada no aparelho, cifrada, e é enviada sozinha quando a conexão volta. O topo da tela mostra quantas estão guardadas; CPF e PIN são conferidos quando a batida chega ao servidor, e as recusadas (PIN errado, por exemplo) aparecem nos alertas do painel. Vale para até 72 horas sem internet.
- Relógio sincronizado com o servidor, aviso de "Sem internet", tela sempre acesa e tela cheia. Pode ser instalado como aplicativo (PWA).
- Funciona em tablet, computador e **celular** (em pé ou deitado): a moldura do rosto sempre cabe inteira na câmera e, no celular em pé, na hora da foto a câmera ocupa a tela toda.
- **Câmera feita para celular de todo tipo:** se a câmera frontal não abre em HD, usa uma resolução menor; se o pedido de permissão não aparece, mostra o botão **"Ligar a câmera"**; religa sozinha quando cai ou quando a tela volta; e, se estiver bloqueada, mostra o passo a passo para liberar no Android ou no iPhone (e liga sozinha quando liberada). O gestor vê o estado da câmera de cada aparelho no painel.
- **Atualização automática:** quando sai uma versão nova do sistema, o aparelho recarrega sozinho num momento sem ninguém usando.
- Ativado uma única vez por um gestor e desativável pelo painel a qualquer momento.
- **Celular pessoal:** o aparelho pode ser o celular de um funcionário. Aí só ele bate ponto nesse celular, digitando só o PIN (sem CPF), e a tela o cumprimenta: "Olá, Maria! Digite seu PIN". Outra pessoa é recusada, mesmo com o próprio CPF e PIN. O gestor escolhe o uso na ativação e pode mudar depois, no painel.

### No painel (`/admin`)

| Página | O que faz |
|---|---|
| **Hoje** | Quem está em expediente, quem saiu, quem está de férias ou atestado, marcações do dia em tempo real e aparelhos online |
| **Marcações** | Filtro por período e funcionário, foto de cada batida, inclusão manual com justificativa, desconsiderar ou restaurar uma batida, exportação CSV |
| **Solicitações** | Inclusão de marcação que faltou, registrada pelo gestor (o funcionário avisa e o gestor lança). Pode ficar pendente para outra pessoa aprovar; recusar exige motivo. Contador de pendentes no menu |
| **Espelho de ponto** | Qualquer mês, por funcionário: marcações, previsto, trabalhado, saldo, faltas e marcações ímpares. Lançamento de abonos. Mostra se o mês foi fechado e avisa se algo mudou depois. Impressão ou PDF (com linhas para o funcionário e a empresa assinarem) e CSV |
| **Fechamento mensal** | Congela o espelho de todos os funcionários de um mês (a versão oficial, para imprimir e assinar em papel), com os totais de cada um; CSV do mês para a folha. Mudou algo depois? Reabrir exige motivo e guarda a versão anterior |
| **Exportar dados** | Baixa os dados de ponto da empresa escolhida, com filtros de período (até 12 meses), funcionários, origem e situação: **marcações** (uma linha por batida), **espelho diário**, **resumo por funcionário** (CSV que abre no Excel) ou **espelhos para imprimir/PDF**, um por folha. Cada exportação fica na auditoria |
| **Funcionários** | CPF, matrícula, cargo, admissão, jornada de cada dia da semana e o PIN de 4 números (com "Gerar PIN"; mostra quem está sem PIN) |
| **Aparelhos de ponto** | Aparelhos ativados, último sinal, **câmera** (funcionando ou o problema, com o que fazer), último registro e desativação |
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
│       ├── identificacao.ts CPF + PIN no aparelho, com bloqueios por erro
│       ├── pin.ts           chave do PIN (HMAC com segredo do servidor)
│       ├── cadeia.ts        cálculo e verificação da cadeia de hashes
│       ├── integridade.ts   verificação de integridade (no painel e toda segunda-feira)
│       ├── fotos.ts         entrega da foto ao painel, com conferência do hash
│       ├── limites.ts       limite de uso por usuário nas funções pesadas
│       ├── solicitacoes.ts  marcação esquecida, lançada pelo gestor (registrar, aprovar, recusar)
│       ├── espelho.ts       cálculo do espelho (fonte única: servidor e painel usam o mesmo)
│       ├── fechamentos.ts   fechamento mensal (espelho congelado) e reabertura com motivo
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
  ├── credenciais/{funcionarioId}       chave do PIN, erros e bloqueios, última marcação (inacessível pelo navegador)
  ├── registros/{id}                    marcações (imutáveis)
  ├── abonos/{id}                       feriados, atestados, férias
  ├── solicitacoes/{id}                 marcações esquecidas lançadas pelo gestor (pendente/aprovada/recusada)
  ├── espelhos/{funcionarioId_AAAA-MM}  espelho fechado (congelado, com hash)
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
3. **Authentication**: "Vamos começar" → método **E-mail/senha** → ativar. Para entrar também com a conta Google: **Adicionar novo provedor → Google** → ativar → escolha o e-mail de suporte → salvar. Depois, em **Configurações → Ações do usuário**, desmarque **"Ativar criação (inscrição)"** e **"Ativar exclusão"**: as contas são criadas só pelo administrador, então ninguém precisa se cadastrar sozinho (vale também para o Google: conta Google sem cadastro não entra).
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
2. Informe o **código de instalação** mostrado no terminal e crie a sua conta de administrador (só funciona uma vez). Faça isso logo depois da publicação. **Deixe a senha em branco para entrar com a conta Google** (use o e-mail dela): é o mais seguro, com a verificação em duas etapas do Google e nenhuma senha guardada no sistema.
3. Em **Empresas**, cadastre a primeira empresa.
4. Em **Usuários**, crie a conta da gestora e marque as empresas que ela pode acessar. Sem senha inicial, ela entra com a conta Google do e-mail cadastrado ou cria a própria senha no login ("Criar ou redefinir senha"), sem que você a conheça.

**Login com Google.** O botão "Entrar com Google" aparece no login do painel e na ativação/desativação do aparelho. Ele entra na conta já cadastrada com o mesmo e-mail (mesmo papel e mesmas empresas); conta Google sem cadastro é recusada. Se a pessoa tinha senha, o Firebase a desliga no primeiro acesso pelo Google (o Google passa a ser o único jeito de entrar); o administrador pode definir uma senha de novo em Usuários. Em conta Google com e-mail de outro provedor (ex.: Hotmail), o Google não confirma o e-mail: a tela pede a senha uma vez e liga as duas formas de entrar. Em computador compartilhado, lembre que sair do painel não sai da conta Google.
5. Em **Funcionários**, cadastre a equipe com matrícula e o **PIN de 4 números** de cada um (o painel sugere um; dá para trocar). Entregue o PIN a cada pessoa: no aparelho ela digita o CPF e o PIN.

### 6. Coloque o aparelho na loja

1. No tablet ou celular, abra `https://SEU-PROJETO.web.app/ponto`.
2. Entre com o e-mail e a senha de um gestor (ou a conta Google), escolha a empresa, diga se é o **aparelho da loja** (cada um digita o CPF e o PIN) ou o **celular pessoal** de um funcionário (só ele bate ponto, digitando só o PIN) e dê um nome ao aparelho (ex.: "Tablet do caixa" ou "Celular da Maria").
3. **Permita a câmera** quando o navegador pedir.
4. Deixe o aparelho em modo quiosque:
   - **Android**: no Chrome, menu ⋮ → **Instalar app** (ou "Adicionar à tela inicial") → abra pelo ícone. Depois ative a **Fixação de app** (Configurações → Segurança) para ninguém sair da tela.
   - **iPad/iPhone**: no Safari, **Compartilhar → Adicionar à Tela de Início** e ative o **Acesso Guiado** (Ajustes → Acessibilidade).
   - **Computador com webcam**: Chrome ou Edge em tela cheia (F11).
5. Deixe o aparelho na tomada, com o rosto do funcionário na altura da câmera e boa iluminação.

---

## Uso no dia a dia

**Funcionário (só isto):** digita o CPF → ✓ → digita o PIN de 4 números → ✓ → olha para a câmera → vê o comprovante (no celular pessoal, só o PIN). A 1ª batida do dia é Entrada, a 2ª Saída, a 3ª Entrada, e assim por diante. Esqueceu de bater, chegou atrasado ou faltou? Avisa o gestor: só ele lança ou justifica no painel.

**Gestora:**

- Escolha a empresa no topo da tela (busca por nome ou CNPJ).
- **Funcionário avisou que esqueceu:** Solicitações → **Nova solicitação** → marque "Aprovar e incluir a marcação agora" (ou deixe pendente para outra pessoa analisar). Também dá para incluir direto pelo Espelho de ponto → botão **+** no dia.
- **Solicitações pendentes** (o número ao lado do menu): veja as marcações que já existem no dia e **Aprove** (a marcação é incluída) ou **Recuse** (com motivo).
- **Faltas e atrasos:** o espelho mostra sozinho (dia útil sem marcação é falta; atraso aparece como saldo negativo do dia). Para justificar, use abono; para corrigir, inclua ou desconsidere a marcação com motivo.
- **Batida duplicada ou errada:** abra a marcação → **Desconsiderar** (com motivo). A original continua guardada.
- **Feriado, atestado ou férias:** Espelho de ponto → **Lançar abono** (ou o ícone de calendário no dia).
- **Esqueceu o PIN, alguém descobriu ou foi bloqueado** (5 erros seguidos bloqueiam o PIN por 15 minutos; se repetir, 30 e depois 60): Funcionários → editar → **Trocar o PIN** (ou "Gerar PIN") → salvar, e passe o novo PIN para ele. O antigo deixa de valer na hora, e o bloqueio acaba.
- **Alertas de segurança:** a página **Hoje** mostra os bloqueios por PIN errado dos últimos 7 dias, com a foto de quem tentou. Se a verificação de integridade (automática, toda segunda-feira) encontrar marcação alterada ou apagada, uma faixa vermelha aparece no topo de todas as páginas.
- **Fechamento do mês** (no início do mês seguinte): **Fechamento mensal** → escolha o mês → **Fechar mês**. O espelho de cada um fica congelado (a versão oficial). Depois, **Imprimir espelhos** (Exportar dados → Espelhos para imprimir ou PDF) para cada funcionário assinar em papel. O **CSV do mês** traz os totais de todos para a folha.
- **Consultar meses anteriores:** todas as telas aceitam qualquer período (Marcações, Espelho, Fechamento, Auditoria e Solicitações, com "carregar mais antigos"). Nada é apagado.
- **Algo mudou depois do fechamento:** o espelho avisa. No Fechamento mensal (ou no Espelho de ponto), use **Reabrir** com motivo: uma nova versão é gerada, a anterior fica guardada, e você imprime de novo para assinatura.
- **Imprimir um espelho:** Espelho de ponto → **Imprimir / PDF** (sai com as linhas para o funcionário e a empresa assinarem). Para imprimir os de todos de uma vez: **Exportar dados → Espelhos para imprimir ou PDF**.
- **Arquivo para a contabilidade:** **Exportar dados** → Resumo por funcionário (totais) ou Espelho diário (dia a dia), no período e com os funcionários que quiser.
- **Aparelho perdido ou trocado:** Aparelhos de ponto → **Desativar**. Ele para de registrar na hora.
- **Celular pessoal ou aparelho da loja:** Aparelhos de ponto → coluna **Uso** → **Mudar**. Não precisa ativar de novo: o servidor passa a valer na hora e a tela do aparelho muda em até 5 minutos (ou na hora, recarregando a tela). Se o dono for desativado, ninguém bate ponto naquele celular até você mudar o uso.

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

- **Nada expira:** marcações, fotos, espelhos fechados (e suas versões anteriores), solicitações, abonos e auditoria ficam guardados sem prazo. Qualquer mês antigo pode ser consultado, fechado e impresso.
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
| `npm run verificar` | Build das funções e do site, lint (sem nenhum aviso permitido) e testes unitários: CPF, CNPJ, PIN, senhas, limpeza de textos, fusos, limites de uso, cadeia de hashes, cálculo do espelho e textos do aparelho. O `npm run publicar` roda isto antes de publicar |
| `npm run testar:e2e` | 29 etapas de ponta a ponta com os emuladores: permissões de cada papel, código de instalação, login com Google (mesma conta do e-mail, ligação com senha, conta sem cadastro), batida sem internet (cifrada, horário conferido, recusas e cadeia íntegra), CPF + PIN de 4 números (sem matrícula, troca só pelo gestor), registro com foto, NSR e cadeia de hashes, bloqueios do PIN e do aparelho (inclusive com tentativas em paralelo), fotos só pelo servidor, ajustes, abonos, solicitações só pelo gestor, fechamento e reabertura com motivo, exportação, adulteração detectada, limites de uso, auditoria, celular pessoal e desativação de aparelho |
| `npm run dados:exemplo` | Com os emuladores ligados, cria administrador, gestora, empresas, funcionários e o histórico do mês anterior, pronto para fechar (senha `ponto-teste-2026`; o resumo no fim mostra o CPF e o PIN de cada funcionário) |
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

- **CPF identifica, PIN confirma:** no aparelho da loja, o funcionário digita o CPF e o PIN de 4 números; no celular pessoal, o aparelho já sabe quem é o dono e o CPF, se vier, é ignorado. Quem define o PIN é o gestor (a empresa conhece o PIN; a foto de cada batida é a prova de quem bateu). PINs óbvios (1234, 1111) são recusados.
- **O PIN não é gravado:** fica só a chave HMAC-SHA256 do PIN (com um segredo do servidor e o id do funcionário), numa coleção que nenhum navegador lê; o segredo também não. Quem copiar o banco sem o segredo não consegue testar os 10 mil PINs possíveis.
- **O aparelho só bate o ponto:** as funções de pedir marcação, consultar ou assinar espelho e de trocar o PIN pelo aparelho não existem no servidor. Uma conta de aparelho (ou alguém com o PIN de um colega) não consegue incluir horário nem mexer no espelho.
- **Bloqueios:** 5 erros seguidos bloqueiam o PIN do funcionário por 15 minutos, depois 30, depois 1 hora; 25 erros em 15 minutos bloqueiam o aparelho. Cada tentativa é reservada numa transação **antes** de o PIN ser conferido, então disparar tentativas em paralelo não burla o limite. Todo bloqueio vai para a auditoria com a foto de quem tentou.
- **Sem pistas para quem tenta adivinhar:** CPF que não é de funcionário ativo e PIN errado dão a mesma resposta. CPF e PIN nunca vão para o log.

**Marcações**

- **Horário do servidor:** mudar o relógio do tablet não altera a hora da batida.
- **Marcações imutáveis:** correções viram inclusões ou desconsiderações com justificativa. Nada é apagado.
- **NSR sequencial e cadeia de hashes (SHA-256)** por empresa: cada registro inclui o hash do anterior, da foto, da data e da hora. A **verificação de integridade** refaz a conta e aponta qualquer marcação apagada, inserida ou alterada, mesmo direto no banco. Ela roda **sozinha toda segunda-feira de madrugada** e também pode ser pedida na página Auditoria; se achar problema, o painel mostra uma faixa vermelha e a auditoria registra o alerta.
- **Sem batida duplicada:** intervalo mínimo entre batidas, e o reenvio automático após queda de internet nunca cria dois registros.
- **Batida sem internet, sem abrir brecha:**
  - O que fica guardado no aparelho (CPF, PIN e foto) vai cifrado com a chave pública do servidor (RSA-OAEP 3072 + AES-256-GCM): quem mexer no tablet não lê nada. A chave privada fica num documento que nenhum navegador acessa.
  - CPF e PIN são conferidos quando a batida chega, com os mesmos bloqueios de sempre: testar PINs sem internet não é mais rápido do que com internet. Fora do pacote cifrado, o aparelho guarda só o id e o horário de cada batida (no máximo 300).
  - Horário: a cada sincronização o servidor entrega uma âncora assinada com a hora dele; sem internet, o aparelho conta o tempo decorrido com um relógio que não muda quando alguém mexe no relógio do tablet. O servidor só aceita horários entre a última conexão e a chegada da batida (até 72 h).
  - Se o relógio do tablet não bater com o tempo decorrido (relógio mudado, aparelho reiniciado ou em repouso), a batida entra marcada **"conferir horário"**, com os dois horários, e vai para os alertas.
  - A marca "sem internet" entra na cadeia de hashes: apagá-la direto no banco aparece na verificação de integridade.
  - Limite conhecido: um aparelho adulterado por alguém com acesso técnico a ele ainda escolhe o horário, mas só dentro da janela entre a última conexão e o envio.

**Painel e logins**

- **Login com Google** (recomendado para o administrador): verificação em duas etapas do Google e nenhuma senha guardada no sistema. Só entra quem tem cadastro: uma conta Google desconhecida é recusada e, se o Firebase chegar a criá-la, o site a apaga na hora.
- **Senha opcional no cadastro:** sem senha inicial, a pessoa entra pelo Google ou cria a própria senha pelo e-mail; o administrador não precisa conhecer nem enviar senhas.
- **Senhas de administradores e gestores:** mínimo de 8 caracteres, sem senhas comuns (12345678, senha123...) e sem o próprio e-mail.
- **"Manter conectado neste computador"** fica desmarcado por padrão: a sessão do painel termina quando o navegador fecha, o que protege computadores compartilhados. O aparelho de ponto continua sempre conectado.
- **Alertas de segurança** na página Hoje: bloqueios por PIN errado dos últimos 7 dias, com a foto de quem tentou.

**Site, publicação e código**

- **Política de segurança de conteúdo (CSP) estrita:** o site só carrega código dele mesmo e só se conecta ao Firebase; não pode ser embutido em outro site; a câmera só funciona nele. A única exceção é o login com Google: o script do Google (`apis.google.com`) e o iframe do Firebase (`*.firebaseapp.com`) são permitidos, mas só são carregados no clique em "Entrar com Google" (a tela do ponto nunca os carrega). Pelo mesmo motivo, o `Cross-Origin-Opener-Policy` é `same-origin-allow-popups`, que deixa a janela do Google responder ao site.
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
- O sistema já tem a base que essas regras pedem: horário do servidor, NSR sequencial, marcações imutáveis, ajustes justificados, trilha de auditoria, comprovante na tela e espelho mensal congelado. **Ainda faltam** os arquivos AFD/AEJ, a assinatura digital com certificado (ICP-Brasil) dos arquivos, o comprovante enviado ao trabalhador e o registro no INPI.
- **Assinatura do espelho:** é feita em papel, no espelho impresso pelo painel (versão congelada no fechamento). Guarde as folhas assinadas.
- **LGPD:** a foto é dado pessoal. O sistema a usa só como prova visual da batida e não faz reconhecimento facial (que seria dado biométrico sensível). Informe os funcionários por escrito sobre a coleta, a finalidade e o prazo de guarda. Mantenha os registros por pelo menos 5 anos (prazo de prescrição trabalhista).

---

## Limitações conhecidas e próximos passos

- **Sem internet, a batida é guardada** e enviada depois (até 72 horas). Como o aparelho não confere CPF e PIN sem internet, uma batida com PIN errado só é recusada quando chega, e o gestor vê o alerta.
- **Turnos que atravessam a meia-noite** contam no dia de cada marcação. Para turnos noturnos, o espelho precisaria do conceito de "dia de trabalho".
- **Escalas (12x36 etc.)** não são calculadas automaticamente: a jornada é por dia da semana. Use folgas e abonos para ajustar.
- **Horas extras e adicional noturno** aparecem como saldo, sem percentuais (50%, 100%).
- **Banco de horas** é calculado mês a mês; o saldo de um mês ainda não é levado automaticamente para o seguinte.
- **A foto não prova que a pessoa estava lá.** Não há detecção de vivacidade: uma foto de foto passaria. A foto serve de evidência para o gestor conferir.
- **Quem tem acesso físico a um computador usado como ponto** pode copiar a sessão do aparelho. Ainda assim, só consegue bater ponto com CPF e PIN certos (com os bloqueios acima). Prefira tablet em modo quiosque e desative aparelhos perdidos pelo painel.
- **O dono do projeto Firebase** tem acesso total ao banco pelo Console. A cadeia de hashes torna qualquer alteração visível na verificação de integridade, mas não a impede.
- **Próximos passos sugeridos:** arquivos AFD/AEJ (Portaria 671), banco de horas acumulado, envio do comprovante por e-mail, Firebase App Check, verificação em duas etapas (MFA) para quem entra com senha e alerta de solicitações pendentes por e-mail ou WhatsApp.
