import { signInWithEmailAndPassword, signOut, type Auth } from 'firebase/auth'
import { useState, type FormEvent } from 'react'
import { api } from '../../../api'
import { Aviso, BotaoGoogle, Campo } from '../../../componentes/Basicos'
import Modal from '../../../componentes/Modal'
import { CHAVE_APARELHO } from '../../../contexto/Sessao'
import { auth, criarSessaoTemporaria, entrarComGoogle } from '../../../firebase'
import { cancelouJanela, mensagemErro } from '../../../lib/erros'
import { gravarLocal } from '../../../lib/util'
import { CHAVE_REFERENCIA, esvaziarFila } from './semInternet'
import { CHAVE_INFO, type InfoAparelho } from './useSincronizacao'

// Ciclo de vida do aparelho: desativação (exige um gestor) e a tela de
// aparelho desativado. Sair apaga o que o aparelho guardou localmente,
// inclusive batidas sem internet que não chegaram a ser enviadas.

async function sairDoAparelho() {
  gravarLocal(CHAVE_APARELHO, null)
  gravarLocal(CHAVE_INFO, null)
  gravarLocal(CHAVE_REFERENCIA, null)
  await esvaziarFila().catch(() => undefined)
  await signOut(auth)
}

export function ConfiguracoesAparelho({
  empresaId,
  info,
  guardadas,
  aoFechar,
}: {
  empresaId: string
  info: InfoAparelho | null
  guardadas: number
  aoFechar: () => void
}) {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)

  // O gestor se identifica (e-mail e senha ou conta Google) numa sessão só em
  // memória: a do aparelho não é afetada.
  async function desativar(fazerLogin: (alvo: Auth) => Promise<unknown>) {
    const dispositivoId = auth.currentUser?.uid
    if (!dispositivoId) return
    setErro('')
    setOcupado(true)
    const temporaria = criarSessaoTemporaria()
    try {
      await fazerLogin(temporaria.auth)
      await api.desativarDispositivo({ empresaId, dispositivoId }, temporaria.functions)
      await sairDoAparelho()
    } catch (err) {
      if (!cancelouJanela(err)) setErro(mensagemErro(err))
    } finally {
      await temporaria.encerrar()
      setOcupado(false)
    }
  }

  function desativarComSenha(e: FormEvent) {
    e.preventDefault()
    void desativar((alvo) => signInWithEmailAndPassword(alvo, email.trim(), senha))
  }

  return (
    <Modal titulo="Configurações do aparelho" aoFechar={aoFechar} largura="pequena">
      <dl className="lista-dados">
        <dt>Empresa</dt>
        <dd>{info?.empresa.nome ?? '—'}</dd>
        <dt>Aparelho</dt>
        <dd>{info?.dispositivo.nome ?? '—'}</dd>
        <dt>Uso</dt>
        <dd>{info?.dispositivo.funcionario ? `Celular pessoal de ${info.dispositivo.funcionario.nome}` : 'Aparelho da loja (todos os funcionários)'}</dd>
      </dl>
      <div className="acoes-detalhe">
        <button type="button" className="botao" onClick={() => window.location.reload()}>
          Recarregar a tela
        </button>
      </div>
      <form onSubmit={desativarComSenha} className="formulario">
        <h3>Desativar este aparelho</h3>
        <p className="texto-suave">Exige um gestor da empresa: e-mail e senha ou a conta Google.</p>
        {guardadas > 0 && (
          <Aviso tipo="alerta">
            {guardadas === 1
              ? 'Há 1 batida feita sem internet que ainda não foi enviada.'
              : `Há ${guardadas} batidas feitas sem internet que ainda não foram enviadas.`}{' '}
            Se desativar agora, elas se perdem: deixe o aparelho com internet por alguns minutos antes.
          </Aviso>
        )}
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
        <div className="separador-ou">ou</div>
        <BotaoGoogle texto="Desativar com a conta Google" aoClicar={() => void desativar(entrarComGoogle)} desativado={ocupado} />
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
