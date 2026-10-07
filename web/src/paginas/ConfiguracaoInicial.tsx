import { browserSessionPersistence, setPersistence, signInWithEmailAndPassword } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { Fingerprint } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { api } from '../api'
import { Aviso, Campo, Carregando } from '../componentes/Basicos'
import { auth, db, NOME_SISTEMA } from '../firebase'
import { mensagemErro } from '../lib/erros'

// Primeiro acesso: cria o administrador principal. Depois de usada, esta
// tela apenas informa que o sistema já está configurado.
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
    if (senha.length < 8) return setErro('A senha precisa ter pelo menos 8 caracteres.')
    if (senha !== confirmacao) return setErro('As senhas não conferem.')
    setEnviando(true)
    try {
      await api.configurarPrimeiroAdmin({ nome: nome.trim(), email: email.trim(), senha, codigo: codigo.trim() })
      await setPersistence(auth, browserSessionPersistence)
      await signInWithEmailAndPassword(auth, email.trim(), senha)
      navigate('/admin', { replace: true })
    } catch (err) {
      setErro(mensagemErro(err))
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
            <Campo rotulo="E-mail">
              <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Campo>
            <Campo rotulo="Senha" ajuda="Mínimo de 8 caracteres. Senhas comuns (12345678, senha123) e com o próprio e-mail são recusadas.">
              <input type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
            </Campo>
            <Campo rotulo="Confirme a senha">
              <input
                type="password"
                autoComplete="new-password"
                value={confirmacao}
                onChange={(e) => setConfirmacao(e.target.value)}
                required
              />
            </Campo>
            {erro && <Aviso tipo="erro">{erro}</Aviso>}
            <button type="submit" className="botao primario grande" disabled={enviando}>
              {enviando ? 'Configurando...' : 'Criar administrador'}
            </button>
          </>
        )}
      </form>
    </div>
  )
}
