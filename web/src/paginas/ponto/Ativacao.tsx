import { indexedDBLocalPersistence, setPersistence, signInWithEmailAndPassword, type Auth, type UserCredential } from 'firebase/auth'
import { collection, doc, getDoc, getDocs } from 'firebase/firestore'
import { Fingerprint, Tablet } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api } from '../../api'
import { Aviso, BotaoGoogle, Campo } from '../../componentes/Basicos'
import UsoDoAparelho from '../../componentes/UsoDoAparelho'
import { CHAVE_APARELHO, useSessao } from '../../contexto/Sessao'
import { auth, criarSessaoTemporaria, entrarComGoogle, NOME_SISTEMA, type SessaoTemporaria } from '../../firebase'
import { cancelouJanela, mensagemErro } from '../../lib/erros'
import { formatarCnpj } from '../../lib/formatos'
import { gravarLocal } from '../../lib/util'
import { ordenarPorNome, paraEmpresa, paraFuncionario, type Empresa, type Funcionario } from '../../tipos'
import { primeiroNome } from './terminal/textos'

class ErroAcesso extends Error {}

// Ativa este navegador como aparelho de ponto de UMA empresa. O gestor se
// identifica numa sessão temporária; o aparelho recebe uma conta própria.
export default function Ativacao() {
  const sessao = useSessao()
  const [etapa, setEtapa] = useState<'login' | 'empresa'>('login')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [empresaId, setEmpresaId] = useState('')
  const [nome, setNome] = useState('')
  // Celular pessoal: id do funcionário dono ('' = aparelho da loja).
  const [donoId, setDonoId] = useState('')
  const nomeSugerido = useRef('')
  const [carregados, setCarregados] = useState<{ empresaId: string; funcionarios: Funcionario[]; erro: string } | null>(null)
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const temporaria = useRef<SessaoTemporaria | null>(null)

  useEffect(
    () => () => {
      void temporaria.current?.encerrar()
    },
    [],
  )

  // Funcionários da empresa escolhida, para o caso de ser o celular pessoal de um deles.
  const funcionarios = carregados?.empresaId === empresaId ? carregados.funcionarios : []
  const erroFuncionarios = carregados?.empresaId === empresaId ? carregados.erro : ''
  const dono = funcionarios.find((f) => f.id === donoId && f.ativo) ?? null
  useEffect(() => {
    const sessaoGestor = temporaria.current
    if (etapa !== 'empresa' || !empresaId || !sessaoGestor) return
    let cancelado = false
    getDocs(collection(sessaoGestor.db, 'empresas', empresaId, 'funcionarios'))
      .then((snap) => {
        if (!cancelado) setCarregados({ empresaId, funcionarios: snap.docs.map(paraFuncionario), erro: '' })
      })
      .catch((err) => {
        const erro = `Não foi possível carregar os funcionários: ${mensagemErro(err)}`
        if (!cancelado) setCarregados({ empresaId, funcionarios: [], erro })
      })
    return () => {
      cancelado = true
    }
  }, [etapa, empresaId])

  // Ao escolher o dono, sugere o nome do aparelho (sem apagar um nome digitado).
  function escolherDono(id: string) {
    setDonoId(id)
    const escolhido = funcionarios.find((f) => f.id === id)
    sugerirNome(escolhido ? `Celular de ${primeiroNome(escolhido.nome)}` : '')
  }

  function sugerirNome(sugestao: string) {
    if (nome.trim() === '' || nome === nomeSugerido.current) setNome(sugestao)
    nomeSugerido.current = sugestao
  }

  function escolherEmpresa(id: string) {
    setEmpresaId(id)
    setDonoId('')
    sugerirNome('')
  }

  // O gestor se identifica com e-mail e senha ou com a conta Google.
  async function identificar(fazerLogin: (alvo: Auth) => Promise<UserCredential>) {
    setErro('')
    setOcupado(true)
    try {
      await temporaria.current?.encerrar()
      const sessaoGestor = criarSessaoTemporaria()
      temporaria.current = sessaoGestor
      const { user } = await fazerLogin(sessaoGestor.auth)
      const perfil = (await getDoc(doc(sessaoGestor.db, 'usuarios', user.uid))).data()
      if (!perfil || perfil.ativo !== true) throw new ErroAcesso('Este usuário não tem acesso ao painel.')

      let lista: Empresa[]
      if (perfil.papel === 'admin') {
        lista = (await getDocs(collection(sessaoGestor.db, 'empresas'))).docs.map(paraEmpresa)
      } else {
        const ids: string[] = Array.isArray(perfil.empresas) ? perfil.empresas : []
        const snaps = await Promise.all(ids.map((id) => getDoc(doc(sessaoGestor.db, 'empresas', id))))
        lista = snaps.filter((s) => s.exists()).map(paraEmpresa)
      }
      lista = ordenarPorNome(lista.filter((empresa) => empresa.ativo))
      if (lista.length === 0) throw new ErroAcesso('Não há empresa ativa liberada para este usuário.')

      setEmpresas(lista)
      setEmpresaId(lista[0].id)
      setSenha('')
      setEtapa('empresa')
    } catch (err) {
      if (!cancelouJanela(err)) setErro(err instanceof ErroAcesso ? err.message : mensagemErro(err))
    } finally {
      setOcupado(false)
    }
  }

  function entrar(e: FormEvent) {
    e.preventDefault()
    void identificar((alvo) => signInWithEmailAndPassword(alvo, email.trim(), senha))
  }

  async function ativar(e: FormEvent) {
    e.preventDefault()
    if (!temporaria.current) return
    if (nome.trim().length < 2) {
      setErro('Dê um nome ao aparelho (ex.: Tablet do caixa).')
      return
    }
    setErro('')
    setOcupado(true)
    try {
      const credenciais = await api.ativarDispositivo(
        { empresaId, nome: nome.trim(), funcionarioId: dono?.id ?? null },
        temporaria.current.functions,
      )
      // O aparelho fica sempre conectado (a sessão do painel pode ser só desta janela).
      await setPersistence(auth, indexedDBLocalPersistence)
      const { user } = await signInWithEmailAndPassword(auth, credenciais.email, credenciais.senha)
      gravarLocal(CHAVE_APARELHO, JSON.stringify({ uid: user.uid, empresaId }))
      await temporaria.current.encerrar()
      temporaria.current = null
      // A sessão passa a ser do aparelho e a tela do ponto aparece sozinha.
    } catch (err) {
      setErro(mensagemErro(err))
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="tela-acesso escuro">
      <div className="cartao-acesso">
        <div className="marca-acesso">
          <Fingerprint size={36} aria-hidden />
          <h1>{NOME_SISTEMA}</h1>
          <p>Ativar este aparelho como ponto</p>
        </div>

        {etapa === 'login' ? (
          <form onSubmit={entrar} className="formulario">
            <Aviso tipo="info">
              Um <strong>gestor</strong> precisa autorizar este aparelho uma única vez. Depois disso, ele fica no modo ponto e os
              funcionários registram com matrícula, PIN e foto.
            </Aviso>
            {sessao.tipo === 'usuario' && (
              <Aviso tipo="alerta">
                Você está conectado ao painel como {sessao.perfil.nome}. Ao ativar, este navegador passa a ser um ponto e sai do painel.
              </Aviso>
            )}
            <Campo rotulo="E-mail do gestor">
              <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </Campo>
            <Campo rotulo="Senha">
              <input type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
            </Campo>
            {erro && <Aviso tipo="erro">{erro}</Aviso>}
            <button type="submit" className="botao primario grande" disabled={ocupado}>
              {ocupado ? 'Verificando...' : 'Continuar'}
            </button>
            <div className="separador-ou">ou</div>
            <BotaoGoogle aoClicar={() => void identificar(entrarComGoogle)} desativado={ocupado} />
          </form>
        ) : (
          <form onSubmit={ativar} className="formulario">
            <Campo rotulo="Empresa deste aparelho">
              <select value={empresaId} onChange={(e) => escolherEmpresa(e.target.value)}>
                {empresas.map((empresa) => (
                  <option key={empresa.id} value={empresa.id}>
                    {empresa.nome}
                    {empresa.cnpj ? ` · ${formatarCnpj(empresa.cnpj)}` : ''}
                  </option>
                ))}
              </select>
            </Campo>
            <UsoDoAparelho funcionarios={funcionarios} valor={dono?.id ?? ''} aoMudar={escolherDono} />
            {erroFuncionarios && <Aviso tipo="alerta">{erroFuncionarios}</Aviso>}
            <Campo rotulo="Nome do aparelho" ajuda="Aparece no painel e em cada marcação.">
              <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Tablet do caixa" maxLength={60} />
            </Campo>
            {erro && <Aviso tipo="erro">{erro}</Aviso>}
            <button type="submit" className="botao primario grande" disabled={ocupado}>
              <Tablet size={18} aria-hidden /> {ocupado ? 'Ativando...' : 'Ativar ponto neste aparelho'}
            </button>
            <button
              type="button"
              className="link"
              onClick={() => {
                setEtapa('login')
                setErro('')
              }}
            >
              Voltar
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
