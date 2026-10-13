import type { FirebaseApp } from 'firebase/app'
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore'
import { app, hostDoEmulador } from './firebase'

// Firestore: só o painel e a ativação do aparelho leem o banco. A tela do ponto
// não lê nada (fala só com as funções), então o SDK do Firestore, que é boa parte
// do site, fica fora do que o aparelho baixa ao abrir. Importe daqui, nunca de
// firebase.ts.

function conectar(db: Firestore): Firestore {
  if (hostDoEmulador) connectFirestoreEmulator(db, hostDoEmulador, 8080)
  return db
}

export const db = conectar(getFirestore(app))

/** Firestore da sessão temporária do gestor no aparelho (ativação). */
export function bancoDe(appTemporario: FirebaseApp): Firestore {
  return conectar(getFirestore(appTemporario))
}
