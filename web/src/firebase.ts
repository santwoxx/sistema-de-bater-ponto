import { deleteApp, FirebaseError, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app'
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  browserSessionPersistence,
  connectAuthEmulator,
  deleteUser,
  getAdditionalUserInfo,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  inMemoryPersistence,
  initializeAuth,
  signInWithPopup,
  signOut,
  type Auth,
  type UserCredential,
} from 'firebase/auth'
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions'

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

/** Endereço dos emuladores, quando o site foi gerado para eles (o Firestore conecta em banco.ts). */
export const hostDoEmulador = usarEmuladores ? hostEmulador : null

function conectarEmuladores(servicos: { auth: Auth; functions: Functions }) {
  if (!usarEmuladores) return
  connectAuthEmulator(servicos.auth, `http://${hostEmulador}:9099`, { disableWarnings: true })
  connectFunctionsEmulator(servicos.functions, hostEmulador, 5001)
}

export const app = initializeApp(configuracao)
// Sem o módulo de popup no início: o script e o iframe do Google só são carregados
// no clique em "Entrar com Google" (ver entrarComGoogle). A tela do ponto e o
// resto do painel não carregam nada de fora.
// A sessão "só desta janela" (login sem "Manter conectado") fica no
// sessionStorage: ele precisa estar na lista para a sessão sobreviver a um F5.
export const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence] })
export const functions = getFunctions(app, REGIAO_FUNCOES)

conectarEmuladores({ auth, functions })

/**
 * Login com a conta Google numa janela (popup), na sessão informada: a do painel
 * ou a temporária do gestor no aparelho. Entra na conta cadastrada com o mesmo
 * e-mail. Conta Google sem cadastro não fica no sistema: se o Firebase acabou de
 * criá-la (criação de contas liberada no Console), ela é apagada na hora.
 */
export async function entrarComGoogle(alvo: Auth = auth): Promise<UserCredential> {
  const google = new GoogleAuthProvider()
  google.setCustomParameters({ prompt: 'select_account' })
  const resultado = await signInWithPopup(alvo, google, browserPopupRedirectResolver)
  if (getAdditionalUserInfo(resultado)?.isNewUser) {
    await deleteUser(resultado.user).catch(() => signOut(alvo))
    throw new FirebaseError('auth/admin-restricted-operation', 'Conta Google sem cadastro no sistema.')
  }
  return resultado
}

export interface SessaoTemporaria {
  /** Para ler o banco na ativação: bancoDe(app), em banco.ts. */
  app: FirebaseApp
  auth: Auth
  functions: Functions
  encerrar: () => Promise<void>
}

// Abre uma segunda conexão, só em memória, para que um gestor se identifique
// no aparelho de ponto (ativar/desativar) sem derrubar a sessão do aparelho.
export function criarSessaoTemporaria(): SessaoTemporaria {
  const appTemporario = initializeApp(configuracao, `temporario-${Date.now()}`)
  const sessao = {
    app: appTemporario,
    auth: initializeAuth(appTemporario, { persistence: inMemoryPersistence }),
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
