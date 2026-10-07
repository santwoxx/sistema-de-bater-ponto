// Publica o sistema inteiro no Firebase (site, funções, banco, regras e
// índices) e confere o resultado.
//
//   npm run publicar                     projeto "producao" do .firebaserc
//   npm run publicar -- --projeto outro  outro apelido ou ID de projeto
//   npm run publicar -- --sem-verificar  pula build, lint e testes (não recomendado)
//
// Etapas:
//  1. confere o login no Firebase CLI e o acesso ao projeto;
//  2. confere a configuração do site e gera o código de instalação, se faltar;
//  3. confere se o login por e-mail/senha está ativo no Authentication;
//  4. "npm run verificar" (build, lint e testes): se falhar, nada é publicado;
//  5. firebase deploy, sem perguntas (cria o site do Hosting se faltar e aceita os padrões),
//     e confere no Cloud Run se cada função ficou no ar (republica as que não ficaram);
//  6. liga a proteção contra exclusão, a recuperação pontual e o backup diário do banco;
//  7. confere o site no ar e, se o sistema ainda não foi configurado, mostra o código
//     de instalação e abre a tela de configuração inicial.

import { randomInt } from 'node:crypto'
import { spawn } from 'node:child_process'
import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { conferirConfiguracaoDoSite, cor, firebase, firebaseSaida, funcoesForaDoAr, idDoProjeto, lerEnv, npmRun, parar, RAIZ } from './lib.mjs'

const args = process.argv.slice(2)
const indiceProjeto = args.indexOf('--projeto')
const apelido = indiceProjeto >= 0 ? args[indiceProjeto + 1] : 'producao'
const verificar = !args.includes('--sem-verificar')
const projeto = idDoProjeto(apelido ?? '')
if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projeto)) parar(`Projeto inválido: "${apelido}". Use um apelido do .firebaserc ou um ID de projeto.`)
if (projeto.startsWith('demo-')) parar('Projetos "demo-" só existem nos emuladores: não há o que publicar.')

const site = `https://${projeto}.web.app`
const REGIAO_FUNCOES = 'southamerica-east1' // a mesma de functions/src/admin.ts
const etapa = (n, texto) => console.log(`\n${cor.titulo(`[${n}/7] ${texto}`)}`)

console.log(cor.titulo(`\nPublicar o Ponto Digital no Firebase: ${projeto}`))

// 1. Login e acesso ao projeto ---------------------------------------------------
etapa(1, 'Conta do Firebase')
const contas = () => JSON.parse(firebaseSaida(['login:list', '--json']).saida || '{}').result ?? []
if (contas().length === 0) {
  if (!process.stdin.isTTY) parar('Faça login antes, num terminal comum: npx firebase login')
  console.log('O navegador vai abrir: entre com a conta Google dona do projeto.')
  firebase(['login'])
  if (contas().length === 0) parar('O login não foi concluído. Rode "npx firebase login" num terminal comum e tente de novo.')
}
const listaProjetos = JSON.parse(firebaseSaida(['projects:list', '--json']).saida || '{}').result ?? []
if (!listaProjetos.some((p) => p.projectId === projeto)) {
  parar(`A conta ${contas()[0]?.user?.email ?? ''} não tem acesso ao projeto ${projeto}. Use "npx firebase login --reauth" com a conta certa.`)
}
console.log(cor.ok(`Conta ${contas()[0]?.user?.email ?? ''} com acesso ao projeto.`))

// 2. Configuração do site e código de instalação ---------------------------------
etapa(2, 'Configuração')
const envSite = conferirConfiguracaoDoSite(projeto)
console.log(cor.ok('web/.env confere com o projeto.'))

// O código de instalação protege a tela que cria o primeiro administrador.
// Fica em functions/.env.<projeto> (fora do Git) e o deploy o entrega às funções.
const arquivoCodigo = join(RAIZ, 'functions', `.env.${projeto}`)
let codigoInstalacao = lerEnv(arquivoCodigo)?.CODIGO_INSTALACAO
if (!codigoInstalacao) {
  // 12 caracteres de um alfabeto de 32 (sem 0/O nem 1/I): 60 bits, impossível de adivinhar.
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const blocos = [0, 1, 2].map(() => Array.from({ length: 4 }, () => alfabeto[randomInt(alfabeto.length)]).join(''))
  codigoInstalacao = blocos.join('-')
  const linha = `CODIGO_INSTALACAO=${codigoInstalacao}\n`
  if (lerEnv(arquivoCodigo)) appendFileSync(arquivoCodigo, `\n${linha}`)
  else writeFileSync(arquivoCodigo, `# Codigo de instalacao do sistema (gerado pelo npm run publicar; fora do Git).\n${linha}`)
  console.log(cor.ok(`Código de instalação criado em functions/.env.${projeto}.`))
} else {
  console.log(cor.ok('Código de instalação já definido.'))
}

// 3. Login por e-mail/senha no Authentication ------------------------------------
etapa(3, 'Authentication')
// Entrar com uma conta que não existe: "credencial inválida" mostra que o login
// por e-mail/senha está ativo. O Referer permite usar a chave já restrita ao site.
const estadoAuth = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${envSite.VITE_FIREBASE_API_KEY}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Referer: `${site}/` },
  body: JSON.stringify({ email: 'verificacao.publicacao@example.com', password: 'verificacao-123456', returnSecureToken: true }),
})
  .then((r) => r.text())
  .catch((e) => String(e))
if (/CONFIGURATION_NOT_FOUND|PASSWORD_LOGIN_DISABLED|OPERATION_NOT_ALLOWED/.test(estadoAuth)) {
  parar(
    'O login por e-mail/senha não está ativo. No Console do Firebase: Authentication > Vamos começar > ' +
      `E-mail/senha > Ativar > Salvar.\n  https://console.firebase.google.com/project/${projeto}/authentication/providers`,
  )
} else if (/INVALID_LOGIN_CREDENTIALS|EMAIL_NOT_FOUND|INVALID_PASSWORD/.test(estadoAuth)) {
  console.log(cor.ok('Login por e-mail/senha ativo.'))
} else {
  console.log(cor.aviso(`Não consegui conferir o Authentication (${estadoAuth.slice(0, 120)}). Seguindo mesmo assim.`))
}

// 4. Verificações ----------------------------------------------------------------
etapa(4, 'Verificações (build, lint e testes)')
if (verificar) {
  if (npmRun('verificar') !== 0) parar('As verificações falharam: nada foi publicado. Corrija e rode de novo.')
} else {
  console.log(cor.aviso('Pulado (--sem-verificar).'))
}

// 5. Deploy ------------------------------------------------------------------------
etapa(5, 'Publicando site, funções, banco, regras e índices')
// O site padrão do Hosting (mesmo nome do projeto) só existe depois do primeiro deploy,
// e o CLI pergunta o nome dele; criamos antes para não depender de pergunta.
if (firebaseSaida(['hosting:sites:get', projeto, '--project', apelido]).status !== 0) {
  if (firebase(['hosting:sites:create', projeto, '--project', apelido]) !== 0) {
    parar(`Não consegui criar o site ${projeto}.web.app no Hosting. Veja a mensagem acima.`)
  }
}
// O repositório é a fonte da verdade: --force aceita as respostas padrão do CLI
// (limpeza automática das imagens antigas das funções) e remove funções que não
// existem mais no código. Assim a publicação não depende de perguntas no terminal.
if (firebase(['deploy', '--project', apelido, '--force']) !== 0) {
  parar(
    'O deploy não terminou. Veja a mensagem acima:\n' +
      '  - "Blaze" ou "billing": o projeto precisa do plano Blaze.\n' +
      '  - "Storage has not been set up": falta o "Vamos começar" do Storage no Console.\n' +
      '  - "Quota exceeded for total allowable CPU": veja "Cota de CPU" no README.\n' +
      '  - Logo depois de ativar o Blaze, o Google pode levar alguns minutos para liberar tudo.\n' +
      'Depois, rode "npm run publicar" de novo: o que já subiu não é duplicado.',
  )
}

// Confere no Cloud Run se cada função está com a versão nova no ar; as que não
// estiverem são publicadas de novo, só elas (com --only o CLI não as pula).
const conferirFuncoes = () =>
  funcoesForaDoAr(projeto, REGIAO_FUNCOES).catch((e) => {
    console.log(cor.aviso(`Não consegui conferir as funções no Cloud Run (${e.message}).`))
    return []
  })
const listarFuncoes = (lista) => lista.map((f) => `  - ${f.nome}: ${f.motivo}`).join('\n')
let foraDoAr = await conferirFuncoes()
if (foraDoAr.length > 0) {
  console.log(cor.aviso(`Estas funções ficaram sem a versão nova no ar; publicando de novo só elas:\n${listarFuncoes(foraDoAr)}`))
  firebase(['deploy', '--only', foraDoAr.map((f) => `functions:${f.nome}`).join(','), '--project', apelido, '--force'])
  foraDoAr = await conferirFuncoes()
  if (foraDoAr.length > 0) {
    parar(`Estas funções não ficaram no ar:\n${listarFuncoes(foraDoAr)}\nSe o motivo for "Quota exceeded", veja "Cota de CPU" no README.`)
  }
}
console.log(cor.ok('Todas as funções estão no ar com a versão nova.'))

// 6. Proteção do banco -----------------------------------------------------------
etapa(6, 'Proteção e backups do banco')
const protecao = firebase([
  'firestore:databases:update', '(default)',
  '--delete-protection', 'ENABLED',
  '--point-in-time-recovery', 'ENABLED',
  '--project', apelido,
])
if (protecao !== 0) console.log(cor.aviso('Não consegui ligar a proteção do banco; ligue em Google Cloud > Firestore > Disaster recovery.'))
const agendas = JSON.parse(firebaseSaida(['firestore:backups:schedules:list', '--project', apelido, '--json']).saida || '{}').result ?? []
if (agendas.some((a) => a.dailyRecurrence)) {
  console.log(cor.ok('Backup diário já agendado.'))
} else if (firebase(['firestore:backups:schedules:create', '--recurrence', 'DAILY', '--retention', '98d', '--project', apelido]) !== 0) {
  console.log(cor.aviso('Não consegui agendar o backup diário; crie em Google Cloud > Firestore > Disaster recovery.'))
}

// 7. Conferência ------------------------------------------------------------------
etapa(7, 'Conferindo o site no ar')
const resposta = await fetch(site).catch(() => null)
if (!resposta?.ok) {
  console.log(cor.aviso(`O site ainda não respondeu (${resposta?.status ?? 'sem conexão'}). Tente abrir ${site} em alguns minutos.`))
} else {
  console.log(cor.ok(`Site no ar: ${site}`))
  console.log(
    resposta.headers.get('content-security-policy')
      ? cor.ok('Cabeçalhos de segurança ativos (CSP e proteção contra moldura).')
      : cor.aviso('O site respondeu sem a política de segurança (CSP): confira os "headers" do firebase.json.'),
  )
}

// sistema/estado é público para leitura: diz só se o primeiro administrador já existe.
const estado = await fetch(
  `https://firestore.googleapis.com/v1/projects/${projeto}/databases/(default)/documents/sistema/estado?key=${envSite.VITE_FIREBASE_API_KEY}`,
  { headers: { Referer: `${site}/` } },
).catch(() => null)
console.log(`\n${cor.ok('Pronto! O sistema está no ar.')}\n  Painel:           ${site}/admin\n  Aparelho da loja: ${site}/ponto`)
if (estado?.status === 404) {
  const url = `${site}/configuracao-inicial`
  console.log(`\nCrie agora o administrador em ${url}\nA tela pede este código de instalação (vale uma vez só):\n\n      ${cor.destaque(codigoInstalacao)}\n`)
  const abridor = { win32: 'explorer', darwin: 'open' }[process.platform] ?? 'xdg-open'
  spawn(abridor, [url], { stdio: 'ignore', detached: true }).on('error', () => undefined).unref()
}
