import type { FirebaseError } from 'firebase/app'
import {
  browserSessionPersistence,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  linkWithCredential,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type OAuthCredential,
} from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { Fingerprint } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation } from 'react-router'
import { Aviso, BotaoGoogle, Campo, Carregando } from '../componentes/Basicos'
import { useSessao } from '../contexto/Sessao'
import { auth, db, entrarComGoogle, NOME_SISTEMA } from '../firebase'
import { cancelouJanela, codigoErro, mensagemErro } from '../lib/erros'
import { gravarLocal, lerLocal } from '../lib/util'

const CHAVE_LEMBRAR = 'ponto.lembrarLogin'

/** Conta Google que espera um login com senha para ser ligada ao mesmo e-mail. */
interface GooglePendente {
  credencial: OAuthCredential
  email: string
}

export default function Login() {
  const sessao = useSessao()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [lembrar, setLembrar] = useState(() => lerLocal(CHAVE_LEMBRAR) === 'sim')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [info, setInfo] = useState('')
  const [sistemaConfigurado, setSistemaConfigurado] = useState<boolean | null>(null)
  const [googlePendente, setGooglePendente] = useState<GooglePendente | null>(null)

  useEffect(() => {
    getDoc(doc(db, 'sistema', 'estado'))
      .then((snap) => setSistemaConfigurado(snap.exists()))
      .catch(() => setSistemaConfigurado(true))
  }, [])

  if (sessao.tipo === 'carregando') return <Carregando tela />
  if (sessao.tipo === 'usuario') {
    const destino = (location.state as { de?: string } | null)?.de ?? '/admin'
    return <Navigate to={destino.startsWith('/admin') ? destino : '/admin'} replace />
  }
  if (sessao.tipo === 'dispositivo') return <Navigate to="/ponto" replace />

  async function prepararSessao() {
    // Sem "manter conectado", a sessão acaba quando o navegador é fechado (computador compartilhado).
    await setPersistence(auth, lembrar ? indexedDBLocalPersistence : browserSessionPersistence)
    gravarLocal(CHAVE_LEMBRAR, lembrar ? 'sim' : null)
  }

  async function entrar(e: FormEvent) {
    e.preventDefault()
    setErro('')
    setInfo('')
    setEnviando(true)
    try {
      await prepararSessao()
      const { user } = await signInWithEmailAndPassword(auth, email.trim(), senha)
      // Veio do botão do Google com este mesmo e-mail: a conta Google fica ligada a este usuário.
      if (googlePendente && googlePendente.email === user.email?.toLowerCase()) {
        await linkWithCredential(user, googlePendente.credencial)
      }
    } catch (err) {
      setErro(mensagemErro(err))
    } finally {
      setEnviando(false)
    }
  }

  async function entrarGoogle() {
    setErro('')
    setInfo('')
    setEnviando(true)
    try {
      await prepararSessao()
      await entrarComGoogle()
    } catch (err) {
      // O Google não responde por este e-mail (conta Google com e-mail de outro provedor):
      // o Firebase só liga as contas depois de um login com a senha deste e-mail.
      const pendente =
        codigoErro(err) === 'auth/account-exists-with-different-credential' ? GoogleAuthProvider.credentialFromError(err as FirebaseError) : null
      const emailGoogle = (err as FirebaseError | null)?.customData?.email
      if (pendente && typeof emailGoogle === 'string') {
        setGooglePendente({ credencial: pendente, email: emailGoogle.toLowerCase() })
        setEmail(emailGoogle)
        setInfo('Este e-mail já tem senha no sistema. Entre com a senha uma vez para ligar a sua conta Google; depois, basta o botão do Google.')
      } else if (!cancelouJanela(err)) {
        setErro(mensagemErro(err))
      }
    } finally {
      setEnviando(false)
    }
  }

  async function recuperarSenha() {
    setErro('')
    setInfo('')
    if (!email.trim()) {
      setErro('Digite seu e-mail acima para receber o link de criação de senha.')
      return
    }
    try {
      await sendPasswordResetEmail(auth, email.trim())
      setInfo('Se este e-mail estiver cadastrado, você receberá um link para criar uma nova senha.')
    } catch (err) {
      setErro(mensagemErro(err))
    }
  }

  return (
    <div className="tela-acesso">
      <form className="cartao-acesso" onSubmit={entrar}>
        <div className="marca-acesso">
          <Fingerprint size={36} aria-hidden />
          <h1>{NOME_SISTEMA}</h1>
          <p>Painel do gestor</p>
        </div>

        {sessao.tipo === 'sem-acesso' && (
          <Aviso tipo="alerta">
            A conta <strong>{sessao.usuario.email}</strong> não tem acesso ao painel. Fale com o administrador.{' '}
            <button type="button" className="link" onClick={() => signOut(auth)}>
              Sair desta conta
            </button>
          </Aviso>
        )}
        {sistemaConfigurado === false && (
          <Aviso tipo="info">
            Primeiro acesso? <Link to="/configuracao-inicial">Configure o sistema e crie o administrador</Link>.
          </Aviso>
        )}

        <Campo rotulo="E-mail">
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Campo>
        <Campo rotulo="Senha">
          <input type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
        </Campo>
        <label className="caixa-marcar">
          <input type="checkbox" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)} />
          Manter conectado neste computador (deixe desmarcado em computador compartilhado)
        </label>

        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {info && <Aviso tipo="sucesso">{info}</Aviso>}

        <button type="submit" className="botao primario grande" disabled={enviando}>
          {enviando ? 'Entrando...' : 'Entrar'}
        </button>
        <div className="separador-ou">ou</div>
        <BotaoGoogle aoClicar={() => void entrarGoogle()} desativado={enviando} />
        <p className="campo-ajuda">Use a conta Google do e-mail cadastrado. Depois de entrar com o Google, use sempre o Google.</p>
        <div className="links-acesso">
          <button type="button" className="link" onClick={recuperarSenha}>
            Criar ou redefinir senha
          </button>
          <Link to="/ponto">Abrir o ponto neste aparelho</Link>
        </div>
      </form>
    </div>
  )
}
