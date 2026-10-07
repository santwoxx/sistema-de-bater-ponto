import { onSnapshot, type DocumentSnapshot, type Query } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { mensagemErro } from '../lib/erros'

export interface EstadoColecao<T> {
  dados: T[]
  carregando: boolean
  erro: string | null
}

/**
 * Escuta uma consulta do Firestore em tempo real.
 * `chave` identifica a consulta: quando ela muda, a escuta é refeita.
 */
export function useColecao<T>(
  criarConsulta: () => Query | null,
  converter: (snap: DocumentSnapshot) => T,
  chave: string,
): EstadoColecao<T> {
  const [estado, setEstado] = useState<EstadoColecao<T>>({ dados: [], carregando: true, erro: null })

  useEffect(() => {
    const consulta = criarConsulta()
    if (!consulta) {
      // Sem consulta (ex.: nada selecionado): limpa o estado da consulta anterior.
      // oxlint-disable-next-line react/set-state-in-effect
      setEstado({ dados: [], carregando: false, erro: null })
      return
    }
    setEstado({ dados: [], carregando: true, erro: null })
    return onSnapshot(
      consulta,
      (snap) => setEstado({ dados: snap.docs.map(converter), carregando: false, erro: null }),
      (erro) => setEstado({ dados: [], carregando: false, erro: mensagemErro(erro) }),
    )
    // A consulta é recriada a cada render; `chave` é o que define quando trocar.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [chave])

  return estado
}

/** Atualiza o componente periodicamente (relógios, "há 5 min"). */
export function useAgora(intervaloMs = 1000): number {
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), intervaloMs)
    return () => clearInterval(id)
  }, [intervaloMs])
  return agora
}
