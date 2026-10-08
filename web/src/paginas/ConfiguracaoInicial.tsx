import { browserSessionPersistence, setPersistence, signInWithEmailAndPassword } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { Fingerprint } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { api } from '../api'
import { Aviso, BotaoGoogle, Campo, Carregando } from '../componentes/Basicos'
import { auth, db, entrarComGoogle, NOME_SISTEMA } from '../firebase'
import { cancelouJanela, codigoErro, mensagemErro } from '../lib/erros'

// Primeiro acesso: cria o administrador principal, com senha ou para entrar com
// a conta Google. Depois de usada, esta tela apenas informa que o sistema já
// está configurado.
export default function ConfiguracaoInicial() {
  const navigate = useNavigate()
  const [configurado, setConfigurado] = useState<boolean | null>(null)
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [codigo, setCodigo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  // Administrador criado sem senha: falta entrar com a conta Google do e-mail informado.
  const [aguardandoGoogle, setAguardandoGoogle] = useState(false)

  useEffect(() => {
    getDoc(doc(db, 'sistema', 'estado'))
      .then((snap) => setConfigurado(snap.exists()))
      .catch((e) => {
        setErro(mensagemErro(e))
        setConfigurado(false)
      })
  }, [])

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setErro('')
    if (senha && senha.length < 8) return setErro('A senha precisa ter pelo menos 8 caracteres.')
    if (senha && senha !== confirmacao) return setErro('As senhas não conferem.')
    setEnviando(true)
    try {
      await api.configurarPrimeiroAdmin({ nome: nome.trim(), email: email.trim(), codigo: codigo.trim(), ...(senha ? { senha } : {}) })
      await setPersistence(auth, browserSessionPersistence)
      if (senha) {
        await signInWithEmailAndPassword(auth, email.trim(), senha)
        navigate('/admin', { replace: true })
      } else {
        // A janela do Google precisa de um clique novo: o navegador bloqueia a que abre sozinha.
        setAguardandoGoogle(true)
      }
    } catch (err) {
      setErro(mensagemErro(err))
    } finally {
      setEnviando(false)
    }
  }

  async function entrarGoogle() {
    setErro('')
    setEnviando(true)
    try {
      await entrarComGoogle()
      navigate('/admin', { replace: true })
    } catch (err) {
      if (codigoErro(err) === 'auth/account-exists-with-different-credential') {
        setErro('O Google não confirma este e-mail para login. Na tela de login, use "Criar ou redefinir senha" para criar uma senha.')
      } else if (!cancelouJanela(err)) {
        setErro(mensagemErro(err))
      }
    } finally {
      setEnviando(false)
    }
  }

  if (configurado === null) return <Carregando tela />

  return (
    <div className="tela-acesso">
      <form className="cartao-acesso" onSubmit={enviar}>
        <div className="marca-acesso">
          <Fingerprint size={36} aria-hidden />
          <h1>{NOME_SISTEMA}</h1>
          <p>Configuração inicial</p>
        </div>

        {configurado ? (
          <>
            <Aviso tipo="sucesso">O sistema já está configurado.</Aviso>
            <Link className="botao primario grande" to="/login">
              Ir para o login
            </Link>
          </>
        ) : aguardandoGoogle ? (
          <>
            <Aviso tipo="sucesso">
              Administrador criado. Agora entre com a conta Google de <strong>{email.trim()}</strong>.
            </Aviso>
            {erro && <Aviso tipo="erro">{erro}</Aviso>}
            <BotaoGoogle aoClicar={() => void entrarGoogle()} desativado={enviando} />
            <p className="campo-ajuda">Sem conta Google neste e-mail? Na tela de login, use "Criar ou redefinir senha".</p>
          </>
        ) : (
          <>
            <Aviso tipo="info">
              Crie a conta do <strong>administrador principal</strong>. Ele poderá cadastrar empresas, gestores e funcionários.
            </Aviso>
            <Campo rotulo="Código de instalação" ajuda="Aparece na janela de publicação do sistema. Só quem publicou o sistema tem.">
              <input
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.toUpperCase())}
                autoComplete="off"
                spellCheck={false}
                autoFocus
              />
            </Campo>
            <Campo rotulo="Seu nome">
              <input value={nome} onChange={(e) => setNome(e.target.value)} required minLength={3} />
            </Campo>
            <Campo rotulo="E-mail" ajuda="Para entrar com o Google, use o e-mail da sua conta Google.">
              <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Campo>
            <Campo
              rotulo="Senha (opcional)"
              ajuda="Deixe em branco para entrar com a conta Google. Com senha: mínimo de 8 caracteres; senhas comuns e com o próprio e-mail são recusadas."
            >
              <input type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
            </Campo>
            {senha && (
              <Campo rotulo="Confirme a senha">
                <input type="password" autoComplete="new-password" value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} />
              </Campo>
            )}
            {erro && <Aviso tipo="erro">{erro}</Aviso>}
            <button type="submit" className="botao primario grande" disabled={enviando}>
              {enviando ? 'Configurando...' : senha ? 'Criar administrador' : 'Criar administrador (entrar com Google)'}
            </button>
          </>
        )}
      </form>
    </div>
  )
}
