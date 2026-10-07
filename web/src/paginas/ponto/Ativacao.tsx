import { indexedDBLocalPersistence, setPersistence, signInWithEmailAndPassword } from 'firebase/auth'
import { collection, doc, getDoc, getDocs } from 'firebase/firestore'
import { Fingerprint, Tablet } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api } from '../../api'
import { Aviso, Campo } from '../../componentes/Basicos'
import { CHAVE_APARELHO, useSessao } from '../../contexto/Sessao'
import { auth, criarSessaoTemporaria, NOME_SISTEMA, type SessaoTemporaria } from '../../firebase'
import { mensagemErro } from '../../lib/erros'
import { formatarCnpj } from '../../lib/formatos'
import { gravarLocal } from '../../lib/util'
import { ordenarPorNome, paraEmpresa, type Empresa } from '../../tipos'

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
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const temporaria = useRef<SessaoTemporaria | null>(null)

  useEffect(
    () => () => {
      void temporaria.current?.encerrar()
    },
    [],
  )

  async function entrar(e: FormEvent) {
    e.preventDefault()
    setErro('')
    setOcupado(true)
    try {
      await temporaria.current?.encerrar()
      const sessaoGestor = criarSessaoTemporaria()
      temporaria.current = sessaoGestor
      const { user } = await signInWithEmailAndPassword(sessaoGestor.auth, email.trim(), senha)
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
      setErro(err instanceof ErroAcesso ? err.message : mensagemErro(err))
    } finally {
      setOcupado(false)
    }
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
      const credenciais = await api.ativarDispositivo({ empresaId, nome: nome.trim() }, temporaria.current.functions)
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
          </form>
        ) : (
          <form onSubmit={ativar} className="formulario">
            <Campo rotulo="Empresa deste aparelho">
              <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)}>
                {empresas.map((empresa) => (
                  <option key={empresa.id} value={empresa.id}>
                    {empresa.nome}
                    {empresa.cnpj ? ` · ${formatarCnpj(empresa.cnpj)}` : ''}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo rotulo="Nome do aparelho" ajuda="Aparece no painel e em cada marcação.">
              <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Tablet do caixa" maxLength={60} autoFocus />
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
