// Funções comuns dos scripts do projeto (só Node, sem dependências).
// Os comandos são executados sem shell: argumentos nunca são reinterpretados.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Firebase CLI fixado no package.json da raiz (npm install na raiz). */
const CLI_FIREBASE = join(RAIZ, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js')

/** Lê um arquivo .env simples (CHAVE=valor, # comentário). Devolve null se não existir. */
export function lerEnv(caminho) {
  if (!existsSync(caminho)) return null
  const valores = {}
  for (const linha of readFileSync(caminho, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    if (linha.trimStart().startsWith('#')) continue
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(linha)
    if (m) valores[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return valores
}

/**
 * Confere se o web/.env é do projeto informado (e não dos emuladores).
 * Para com erro explicando o que corrigir; devolve as variáveis do site.
 */
export function conferirConfiguracaoDoSite(projeto) {
  const env = lerEnv(join(RAIZ, 'web', '.env'))
  if (!env) parar('Falta o arquivo web/.env com a configuração do Firebase. Copie web/.env.example e preencha (veja o README).')
  if (env.VITE_USAR_EMULADORES === 'true') {
    parar('web/.env aponta para os emuladores (VITE_USAR_EMULADORES=true). Use a configuração do projeto de produção.')
  }
  for (const chave of ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID']) {
    if (!env[chave]) parar(`web/.env está sem ${chave}.`)
  }
  if (env.VITE_FIREBASE_PROJECT_ID !== projeto) {
    parar(
      `O site está configurado para o projeto "${env.VITE_FIREBASE_PROJECT_ID}" (web/.env), ` +
        `mas a publicação é para "${projeto}". Corrija o web/.env ou o projeto escolhido.`,
    )
  }
  return env
}

/** Resolve um apelido do .firebaserc (ex.: "producao") para o ID do projeto. */
export function idDoProjeto(apelidoOuId) {
  const projetos = JSON.parse(readFileSync(join(RAIZ, '.firebaserc'), 'utf8')).projects ?? {}
  return projetos[apelidoOuId] ?? apelidoOuId
}

function exigirCli() {
  if (!existsSync(CLI_FIREBASE)) parar('Firebase CLI não instalado. Rode "npm install" na pasta raiz do projeto.')
}

/** Roda o Firebase CLI mostrando a saída e as perguntas no terminal. Devolve o código de saída. */
export function firebase(args) {
  exigirCli()
  return spawnSync(process.execPath, [CLI_FIREBASE, ...args], { cwd: RAIZ, stdio: 'inherit' }).status ?? 1
}

/** Roda o Firebase CLI e devolve o que ele escreveu (para comandos com --json). */
export function firebaseSaida(args) {
  exigirCli()
  const r = spawnSync(process.execPath, [CLI_FIREBASE, ...args], { cwd: RAIZ, encoding: 'utf8' })
  return { status: r.status ?? 1, saida: r.stdout ?? '' }
}

/**
 * Funções cuja versão mais recente não está no ar no Cloud Run. O deploy pode
 * terminar sem erro deixando uma função sem revisão pronta (ex.: falta de cota
 * de CPU): o Cloud Functions continua dizendo ACTIVE, e o CLI a pula no deploy
 * seguinte por não ver mudança. Usa a conta já logada no Firebase CLI.
 */
export async function funcoesForaDoAr(projeto, regiao) {
  exigirCli()
  const cli = createRequire(CLI_FIREBASE)
  const { configstore } = cli('../configstore')
  const { requireAuth } = cli('../requireAuth')
  const { Client } = cli('../apiv2')
  await requireAuth({ user: configstore.get('user'), tokens: configstore.get('tokens') })
  const listar = (api, recurso) =>
    new Client({ urlPrefix: `https://${api}.googleapis.com`, apiVersion: 'v2', auth: true })
      .get(`/projects/${projeto}/locations/${regiao}/${recurso}`, { queryParams: { pageSize: 500 } })
      .then((r) => r.body[recurso] ?? [])
  const [funcoes, servicos] = await Promise.all([listar('cloudfunctions', 'functions'), listar('run', 'services')])
  const ultimo = (nome) => nome?.split('/').pop()
  const servicoPorId = new Map(servicos.map((s) => [ultimo(s.name), s]))
  return funcoes
    .filter((f) => f.environment !== 'GEN_1')
    .flatMap((f) => {
      const s = servicoPorId.get(ultimo(f.serviceConfig?.service))
      if (s?.latestReadyRevision && s.latestReadyRevision === s.latestCreatedRevision) return []
      const motivo = (s?.terminalCondition?.message ?? `estado ${f.state}`).split('\n')[0].slice(0, 200)
      return [{ nome: ultimo(f.name), motivo }]
    })
}

/** Roda um script do package.json da raiz (ex.: "verificar"). */
export function npmRun(script) {
  if (!/^[a-z:-]+$/.test(script)) throw new Error(`Script inválido: ${script}`)
  // Dentro do "npm run", npm_execpath aponta para o npm em uso; fora dele, o npm do PATH.
  const npmCli = process.env.npm_execpath
  const r = npmCli
    ? spawnSync(process.execPath, [npmCli, 'run', script], { cwd: RAIZ, stdio: 'inherit' })
    : spawnSync(`npm run ${script}`, { cwd: RAIZ, stdio: 'inherit', shell: true })
  return r.status ?? 1
}

export const cor = {
  titulo: (t) => `\x1b[36m\x1b[1m${t}\x1b[0m`,
  ok: (t) => `\x1b[32m${t}\x1b[0m`,
  aviso: (t) => `\x1b[33m${t}\x1b[0m`,
  erro: (t) => `\x1b[31m${t}\x1b[0m`,
  destaque: (t) => `\x1b[1m\x1b[42m\x1b[97m ${t} \x1b[0m`,
}

export function parar(mensagem) {
  console.error(`\n${cor.erro('✖')} ${mensagem}\n`)
  process.exit(1)
}
