import { collection, doc, onSnapshot } from 'firebase/firestore'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { db } from '../firebase'
import { gravarLocal, lerLocal } from '../lib/util'
import { ordenarPorNome, paraEmpresa, type Empresa } from '../tipos'
import { usePerfil } from './Sessao'

// Empresas que o usuário logado pode acessar e a empresa selecionada no topo
// do painel. Admin enxerga todas; gestor, só as liberadas no seu cadastro.

interface ContextoEmpresa {
  empresas: Empresa[]
  carregando: boolean
  empresa: Empresa | null
  selecionar: (id: string) => void
}

const Contexto = createContext<ContextoEmpresa | null>(null)
const CHAVE = 'ponto.empresaSelecionada'

export function EmpresaProvider({ children }: { children: ReactNode }) {
  const perfil = usePerfil()
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [carregando, setCarregando] = useState(true)
  const [selecionadaId, setSelecionadaId] = useState<string | null>(() => lerLocal(CHAVE))
  const chaveAcesso = `${perfil.papel}:${perfil.empresas.join(',')}`

  useEffect(() => {
    setCarregando(true)
    if (perfil.papel === 'admin') {
      return onSnapshot(
        collection(db, 'empresas'),
        (snap) => {
          setEmpresas(ordenarPorNome(snap.docs.map(paraEmpresa)))
          setCarregando(false)
        },
        () => setCarregando(false),
      )
    }

    if (perfil.empresas.length === 0) {
      setEmpresas([])
      setCarregando(false)
      return
    }

    const encontradas = new Map<string, Empresa>()
    const responderam = new Set<string>()
    const atualizar = () => {
      setEmpresas(ordenarPorNome([...encontradas.values()]))
      if (responderam.size === perfil.empresas.length) setCarregando(false)
    }
    const paradas = perfil.empresas.map((id) =>
      onSnapshot(
        doc(db, 'empresas', id),
        (snap) => {
          responderam.add(id)
          if (snap.exists()) encontradas.set(id, paraEmpresa(snap))
          else encontradas.delete(id)
          atualizar()
        },
        () => {
          responderam.add(id)
          encontradas.delete(id)
          atualizar()
        },
      ),
    )
    return () => paradas.forEach((parar) => parar())
    // chaveAcesso resume perfil.papel + perfil.empresas
  }, [chaveAcesso])

  const selecionar = useCallback((id: string) => {
    setSelecionadaId(id)
    gravarLocal(CHAVE, id)
  }, [])

  const valor = useMemo<ContextoEmpresa>(() => {
    const empresa = empresas.find((e) => e.id === selecionadaId) ?? empresas.find((e) => e.ativo) ?? empresas[0] ?? null
    return { empresas, carregando, empresa, selecionar }
  }, [empresas, carregando, selecionadaId, selecionar])

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export function useEmpresas(): ContextoEmpresa {
  const contexto = useContext(Contexto)
  if (!contexto) throw new Error('useEmpresas usado fora do EmpresaProvider')
  return contexto
}

/** Empresa selecionada no topo do painel (as páginas só abrem quando há uma). */
export function useEmpresaAtual(): Empresa {
  const { empresa } = useEmpresas()
  if (!empresa) throw new Error('Nenhuma empresa selecionada')
  return empresa
}
