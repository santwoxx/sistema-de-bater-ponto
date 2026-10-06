import { useEffect } from 'react'
import { Carregando } from '../../componentes/Basicos'
import { useSessao } from '../../contexto/Sessao'
import Ativacao from './Ativacao'
import Terminal from './Terminal'

export default function Ponto() {
  const sessao = useSessao()

  useEffect(() => {
    document.documentElement.classList.add('modo-ponto')
    return () => document.documentElement.classList.remove('modo-ponto')
  }, [])

  if (sessao.tipo === 'carregando') return <Carregando tela texto="Abrindo o ponto..." />
  if (sessao.tipo === 'dispositivo') return <Terminal empresaId={sessao.empresaId} />
  return <Ativacao />
}
