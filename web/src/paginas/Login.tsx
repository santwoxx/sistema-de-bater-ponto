import { sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { Fingerprint } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation } from 'react-router'
import { Aviso, Campo, Carregando } from '../componentes/Basicos'
import { useSessao } from '../contexto/Sessao'
import { auth, db, NOME_SISTEMA } from '../firebase'
import { mensagemErro } from '../lib/erros'

export default function Login() {
  const sessao = useSessao()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [info, setInfo] = useState('')
  const [sistemaConfigurado, setSistemaConfigurado] = useState<boolean | null>(null)

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

  async function entrar(e: FormEvent) {
    e.preventDefault()
    setErro('')
    setInfo('')
    setEnviando(true)
    try {
      await signInWithEmailAndPassword(auth, email.trim(), senha)
    } catch (err) {
      setErro(mensagemErro(err))
    } finally {
      setEnviando(false)
    }
  }

  async function recuperarSenha() {
    setErro('')
    setInfo('')
    if (!email.trim()) {
      setErro('Digite seu e-mail acima para receber o link de redefinição de senha.')
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

        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {info && <Aviso tipo="sucesso">{info}</Aviso>}

        <button type="submit" className="botao primario grande" disabled={enviando}>
          {enviando ? 'Entrando...' : 'Entrar'}
        </button>
        <div className="links-acesso">
          <button type="button" className="link" onClick={recuperarSenha}>
            Esqueci minha senha
          </button>
          <Link to="/ponto">Abrir o ponto neste aparelho</Link>
        </div>
      </form>
    </div>
  )
}
