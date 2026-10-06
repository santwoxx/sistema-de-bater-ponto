import { onAuthStateChanged, type User } from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { auth, db } from '../firebase'
import { lerLocal } from '../lib/util'
import type { Perfil } from '../tipos'

export type Sessao =
  | { tipo: 'carregando' }
  | { tipo: 'anonimo' }
  | { tipo: 'dispositivo'; usuario: User; empresaId: string }
  | { tipo: 'usuario'; usuario: User; perfil: Perfil }
  | { tipo: 'sem-acesso'; usuario: User }

/** Guardado na ativação para o aparelho continuar se identificando mesmo sem internet. */
export const CHAVE_APARELHO = 'ponto.aparelho'

const ContextoSessao = createContext<Sessao>({ tipo: 'carregando' })

export function SessaoProvider({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<Sessao>({ tipo: 'carregando' })

  useEffect(() => {
    let pararPerfil: (() => void) | undefined
    let geracao = 0

    const pararAuth = onAuthStateChanged(auth, async (usuario) => {
      const atual = ++geracao
      pararPerfil?.()
      pararPerfil = undefined
      if (!usuario) {
        setSessao({ tipo: 'anonimo' })
        return
      }
      setSessao({ tipo: 'carregando' })

      let empresaAparelho: string | null = null
      try {
        const token = await usuario.getIdTokenResult()
        if (token.claims.papel === 'dispositivo' && typeof token.claims.empresaId === 'string') {
          empresaAparelho = token.claims.empresaId
        }
      } catch {
        const salvo = JSON.parse(lerLocal(CHAVE_APARELHO) ?? 'null') as { uid: string; empresaId: string } | null
        if (salvo?.uid === usuario.uid) empresaAparelho = salvo.empresaId
      }
      if (atual !== geracao) return

      if (empresaAparelho) {
        setSessao({ tipo: 'dispositivo', usuario, empresaId: empresaAparelho })
        return
      }

      pararPerfil = onSnapshot(
        doc(db, 'usuarios', usuario.uid),
        (snap) => {
          const dados = snap.data()
          if (!dados || dados.ativo !== true) {
            setSessao({ tipo: 'sem-acesso', usuario })
            return
          }
          setSessao({
            tipo: 'usuario',
            usuario,
            perfil: {
              uid: usuario.uid,
              nome: dados.nome ?? '',
              email: dados.email ?? '',
              papel: dados.papel === 'admin' ? 'admin' : 'gestor',
              empresas: Array.isArray(dados.empresas) ? dados.empresas : [],
              ativo: true,
            },
          })
        },
        () => setSessao({ tipo: 'sem-acesso', usuario }),
      )
    })

    return () => {
      pararAuth()
      pararPerfil?.()
    }
  }, [])

  return <ContextoSessao.Provider value={sessao}>{children}</ContextoSessao.Provider>
}

export function useSessao(): Sessao {
  return useContext(ContextoSessao)
}

export function usePerfil(): Perfil {
  const sessao = useSessao()
  if (sessao.tipo !== 'usuario') throw new Error('usePerfil usado fora de uma sessão de usuário')
  return sessao.perfil
}
