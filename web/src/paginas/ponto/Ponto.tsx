import { lazy, Suspense, useEffect } from 'react'
import { Carregando } from '../../componentes/Basicos'
import { useSessao } from '../../contexto/Sessao'
import Terminal from './Terminal'

// A ativação lê o banco (empresas e funcionários do gestor): só quem vai ativar baixa isso.
const Ativacao = lazy(() => import('./Ativacao'))

export default function Ponto() {
  const sessao = useSessao()

  useEffect(() => {
    document.documentElement.classList.add('modo-ponto')
    return () => document.documentElement.classList.remove('modo-ponto')
  }, [])

  if (sessao.tipo === 'carregando') return <Carregando tela texto="Abrindo o ponto..." />
  if (sessao.tipo === 'dispositivo') return <Terminal empresaId={sessao.empresaId} />
  return (
    <Suspense fallback={<Carregando tela texto="Abrindo o ponto..." />}>
      <Ativacao />
    </Suspense>
  )
}
