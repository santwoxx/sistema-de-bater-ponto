import { signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { useState, type FormEvent } from 'react'
import { api } from '../../../api'
import { Aviso, Campo } from '../../../componentes/Basicos'
import Modal from '../../../componentes/Modal'
import { CHAVE_APARELHO } from '../../../contexto/Sessao'
import { auth, criarSessaoTemporaria } from '../../../firebase'
import { mensagemErro } from '../../../lib/erros'
import { gravarLocal } from '../../../lib/util'
import { CHAVE_INFO, type InfoAparelho } from './useSincronizacao'

// Ciclo de vida do aparelho: desativação (exige um gestor) e a tela de
// aparelho desativado. Sair apaga o que o aparelho guardou localmente.

async function sairDoAparelho() {
  gravarLocal(CHAVE_APARELHO, null)
  gravarLocal(CHAVE_INFO, null)
  await signOut(auth)
}

export function ConfiguracoesAparelho({ empresaId, info, aoFechar }: { empresaId: string; info: InfoAparelho | null; aoFechar: () => void }) {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)

  async function desativar(e: FormEvent) {
    e.preventDefault()
    const dispositivoId = auth.currentUser?.uid
    if (!dispositivoId) return
    setErro('')
    setOcupado(true)
    // O gestor se identifica numa sessão só em memória: a do aparelho não é afetada.
    const temporaria = criarSessaoTemporaria()
    try {
      await signInWithEmailAndPassword(temporaria.auth, email.trim(), senha)
      await api.desativarDispositivo({ empresaId, dispositivoId }, temporaria.functions)
      await sairDoAparelho()
    } catch (err) {
      setErro(mensagemErro(err))
    } finally {
      await temporaria.encerrar()
      setOcupado(false)
    }
  }

  return (
    <Modal titulo="Configurações do aparelho" aoFechar={aoFechar} largura="pequena">
      <dl className="lista-dados">
        <dt>Empresa</dt>
        <dd>{info?.empresa.nome ?? '—'}</dd>
        <dt>Aparelho</dt>
        <dd>{info?.dispositivo.nome ?? '—'}</dd>
      </dl>
      <div className="acoes-detalhe">
        <button type="button" className="botao" onClick={() => window.location.reload()}>
          Recarregar a tela
        </button>
      </div>
      <form onSubmit={desativar} className="formulario">
        <h3>Desativar este aparelho</h3>
        <p className="texto-suave">Exige e-mail e senha de um gestor da empresa.</p>
        <Campo rotulo="E-mail do gestor">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" required />
        </Campo>
        <Campo rotulo="Senha">
          <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="off" required />
        </Campo>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <button type="submit" className="botao perigo" disabled={ocupado}>
          {ocupado ? 'Desativando...' : 'Desativar aparelho'}
        </button>
      </form>
    </Modal>
  )
}

export function AparelhoDesativado() {
  return (
    <div className="tela-acesso escuro">
      <div className="cartao-acesso">
        <h1>Aparelho desativado</h1>
        <Aviso tipo="alerta">Este aparelho foi desativado pelo gestor e não registra mais ponto.</Aviso>
        <button type="button" className="botao primario grande" onClick={() => void sairDoAparelho()}>
          Ativar novamente
        </button>
      </div>
    </div>
  )
}
