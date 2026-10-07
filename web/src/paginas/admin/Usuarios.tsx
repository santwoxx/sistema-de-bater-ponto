import { collection, type DocumentSnapshot } from 'firebase/firestore'
import { Pencil, Search, UserCog, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../api'
import { Aviso, CabecalhoPagina, Campo, Carregando, Selo, Vazio } from '../../componentes/Basicos'
import Modal from '../../componentes/Modal'
import { useNotificar } from '../../componentes/Notificacoes'
import { useEmpresas } from '../../contexto/Empresa'
import { usePerfil } from '../../contexto/Sessao'
import { db } from '../../firebase'
import { useColecao } from '../../hooks/useColecao'
import { mensagemErro } from '../../lib/erros'
import { normalizarBusca } from '../../lib/formatos'
import { ordenarPorNome, type Empresa, type Perfil } from '../../tipos'

function paraPerfil(snap: DocumentSnapshot): Perfil {
  const d = snap.data() ?? {}
  return {
    uid: snap.id,
    nome: d.nome ?? '',
    email: d.email ?? '',
    papel: d.papel === 'admin' ? 'admin' : 'gestor',
    empresas: Array.isArray(d.empresas) ? d.empresas : [],
    ativo: d.ativo === true,
  }
}

export default function Usuarios() {
  const eu = usePerfil()
  const { empresas } = useEmpresas()
  const usuarios = useColecao(() => collection(db, 'usuarios'), paraPerfil, 'usuarios')
  const [editando, setEditando] = useState<Perfil | 'novo' | null>(null)
  const nomesEmpresas = new Map(empresas.map((e) => [e.id, e.nome]))

  return (
    <>
      <CabecalhoPagina
        titulo="Usuários"
        descricao="Quem acessa o painel. Gestores veem apenas as empresas liberadas para eles."
        acoes={
          <button type="button" className="botao primario" onClick={() => setEditando('novo')}>
            <UserPlus size={16} aria-hidden /> Novo usuário
          </button>
        }
      />

      {usuarios.erro && <Aviso tipo="erro">{usuarios.erro}</Aviso>}

      <section className="cartao sem-preenchimento">
        {usuarios.carregando ? (
          <Carregando />
        ) : usuarios.dados.length === 0 ? (
          <Vazio icone={UserCog} titulo="Nenhum usuário" />
        ) : (
          <div className="tabela-rolagem">
            <table className="tabela clicavel">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>E-mail</th>
                  <th>Papel</th>
                  <th>Empresas</th>
                  <th>Situação</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {ordenarPorNome(usuarios.dados).map((u) => (
                  <tr key={u.uid} onClick={() => setEditando(u)}>
                    <td>
                      <strong>{u.nome}</strong>
                      {u.uid === eu.uid && <small className="bloco">você</small>}
                    </td>
                    <td>{u.email}</td>
                    <td>{u.papel === 'admin' ? 'Administrador' : 'Gestor'}</td>
                    <td>
                      {u.papel === 'admin'
                        ? 'Todas'
                        : u.empresas.length === 0
                          ? '—'
                          : u.empresas.map((id) => nomesEmpresas.get(id) ?? 'empresa removida').join(', ')}
                    </td>
                    <td>{u.ativo ? <Selo cor="verde">Ativo</Selo> : <Selo>Inativo</Selo>}</td>
                    <td>
                      <button type="button" className="botao-icone" aria-label={`Editar ${u.nome}`}>
                        <Pencil size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editando && (
        <FormUsuario
          usuario={editando === 'novo' ? null : editando}
          eu={eu}
          empresas={empresas}
          aoFechar={() => setEditando(null)}
        />
      )}
    </>
  )
}

function FormUsuario({ usuario, eu, empresas, aoFechar }: { usuario: Perfil | null; eu: Perfil; empresas: Empresa[]; aoFechar: () => void }) {
  const notificar = useNotificar()
  const souEu = usuario?.uid === eu.uid
  const [nome, setNome] = useState(usuario?.nome ?? '')
  const [email, setEmail] = useState(usuario?.email ?? '')
  const [senha, setSenha] = useState('')
  const [papel, setPapel] = useState<'admin' | 'gestor'>(usuario?.papel ?? 'gestor')
  const [selecionadas, setSelecionadas] = useState<string[]>(usuario?.empresas ?? [])
  const [ativo, setAtivo] = useState(usuario?.ativo ?? true)
  const [busca, setBusca] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const termo = normalizarBusca(busca)
  const filtradas = empresas.filter((e) => !termo || normalizarBusca(e.nome).includes(termo))

  async function salvar() {
    setErro('')
    if (nome.trim().length < 3) return setErro('Informe o nome.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setErro('E-mail inválido.')
    if (!usuario && senha.length < 8) return setErro('Defina uma senha inicial com pelo menos 8 caracteres.')
    if (usuario && senha && senha.length < 8) return setErro('A nova senha precisa ter pelo menos 8 caracteres.')
    setSalvando(true)
    try {
      await api.salvarUsuario({
        ...(usuario ? { uid: usuario.uid } : {}),
        nome: nome.trim(),
        email: email.trim(),
        ...(senha ? { senha } : {}),
        papel,
        empresas: papel === 'admin' ? [] : selecionadas,
        ativo,
      })
      notificar(usuario ? 'Usuário atualizado.' : 'Usuário criado. Envie o e-mail e a senha inicial para a pessoa.')
      aoFechar()
    } catch (e) {
      setErro(mensagemErro(e))
    } finally {
      setSalvando(false)
    }
  }

  function alternar(id: string) {
    setSelecionadas(selecionadas.includes(id) ? selecionadas.filter((x) => x !== id) : [...selecionadas, id])
  }

  return (
    <Modal
      titulo={usuario ? `Editar: ${usuario.nome}` : 'Novo usuário'}
      aoFechar={aoFechar}
      aoEnviar={salvar}
      rodape={
        <>
          <button type="button" className="botao fantasma" onClick={aoFechar} disabled={salvando}>
            Cancelar
          </button>
          <button type="submit" className="botao primario" disabled={salvando}>
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
        </>
      }
    >
      <div className="grade-2">
        <Campo rotulo="Nome">
          <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} autoFocus />
        </Campo>
        <Campo rotulo="E-mail (login)">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </Campo>
      </div>
      <Campo rotulo={usuario ? 'Nova senha (deixe em branco para manter)' : 'Senha inicial'} ajuda="Mínimo de 8 caracteres. Senhas comuns (12345678, senha123) e com o próprio e-mail são recusadas.">
        <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="new-password" />
      </Campo>

      <fieldset className="grupo">
        <legend>Papel</legend>
        <label className="caixa-marcar">
          <input type="radio" name="papel" checked={papel === 'gestor'} disabled={souEu} onChange={() => setPapel('gestor')} />
          <span>
            <strong>Gestor</strong> · vê e gerencia apenas as empresas selecionadas abaixo
          </span>
        </label>
        <label className="caixa-marcar">
          <input type="radio" name="papel" checked={papel === 'admin'} disabled={souEu} onChange={() => setPapel('admin')} />
          <span>
            <strong>Administrador</strong> · acesso total, inclusive empresas e usuários
          </span>
        </label>
      </fieldset>

      {papel === 'gestor' && (
        <fieldset className="grupo">
          <legend>Empresas liberadas ({selecionadas.length})</legend>
          {empresas.length > 6 && (
            <div className="busca">
              <Search size={16} aria-hidden />
              <input placeholder="Filtrar empresas" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>
          )}
          <div className="lista-marcar">
            {filtradas.map((e) => (
              <label key={e.id} className="caixa-marcar">
                <input type="checkbox" checked={selecionadas.includes(e.id)} onChange={() => alternar(e.id)} />
                {e.nome}
              </label>
            ))}
            {empresas.length === 0 && <p className="texto-suave">Cadastre empresas antes de liberar o acesso.</p>}
          </div>
        </fieldset>
      )}

      <label className="caixa-marcar">
        <input type="checkbox" checked={ativo} disabled={souEu} onChange={(e) => setAtivo(e.target.checked)} />
        Usuário ativo
      </label>
      {souEu && <p className="texto-suave">Você não pode remover o seu próprio acesso de administrador.</p>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
    </Modal>
  )
}
