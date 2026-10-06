import { deleteApp, initializeApp, type FirebaseOptions } from 'firebase/app'
import { connectAuthEmulator, getAuth, inMemoryPersistence, initializeAuth, type Auth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions'
import { connectStorageEmulator, getStorage } from 'firebase/storage'

const env = import.meta.env

export const NOME_SISTEMA = env.VITE_NOME_SISTEMA || 'Ponto Digital'
export const REGIAO_FUNCOES = 'southamerica-east1'

const configuracao: FirebaseOptions = {
  // "faltando" evita que o SDK quebre ao carregar; a tela avisa que falta configurar.
  apiKey: env.VITE_FIREBASE_API_KEY || 'faltando',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
}

export const configuracaoOk = Boolean(env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID)

const usarEmuladores = env.VITE_USAR_EMULADORES === 'true'
const hostEmulador = env.VITE_HOST_EMULADOR || '127.0.0.1'

function conectarEmuladores(servicos: { auth: Auth; db?: Firestore; functions: Functions }) {
  if (!usarEmuladores) return
  connectAuthEmulator(servicos.auth, `http://${hostEmulador}:9099`, { disableWarnings: true })
  connectFunctionsEmulator(servicos.functions, hostEmulador, 5001)
  if (servicos.db) connectFirestoreEmulator(servicos.db, hostEmulador, 8080)
}

export const app = initializeApp(configuracao)
export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)
export const functions = getFunctions(app, REGIAO_FUNCOES)

conectarEmuladores({ auth, db, functions })
if (usarEmuladores) connectStorageEmulator(storage, hostEmulador, 9199)

export interface SessaoTemporaria {
  auth: Auth
  db: Firestore
  functions: Functions
  encerrar: () => Promise<void>
}

// Abre uma segunda conexão, só em memória, para que um gestor se identifique
// no aparelho de ponto (ativar/desativar) sem derrubar a sessão do aparelho.
export function criarSessaoTemporaria(): SessaoTemporaria {
  const appTemporario = initializeApp(configuracao, `temporario-${Date.now()}`)
  const sessao = {
    auth: initializeAuth(appTemporario, { persistence: inMemoryPersistence }),
    db: getFirestore(appTemporario),
    functions: getFunctions(appTemporario, REGIAO_FUNCOES),
  }
  conectarEmuladores(sessao)
  return {
    ...sessao,
    encerrar: async () => {
      await deleteApp(appTemporario).catch(() => undefined)
    },
  }
}
