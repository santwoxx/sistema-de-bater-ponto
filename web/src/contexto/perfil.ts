import { doc, onSnapshot, type DocumentData } from 'firebase/firestore'
import { db } from '../banco'

/** Acompanha o perfil (usuarios/{uid}) de quem entrou no painel. Devolve a função que para. */
export function acompanharPerfil(uid: string, aoMudar: (dados: DocumentData | undefined) => void, aoFalhar: () => void): () => void {
  return onSnapshot(doc(db, 'usuarios', uid), (snap) => aoMudar(snap.data()), aoFalhar)
}
