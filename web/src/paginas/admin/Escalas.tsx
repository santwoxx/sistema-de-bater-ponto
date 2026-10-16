import { collection } from 'firebase/firestore'
import { CalendarClock, Pencil, Plus, Search, Trash2, Users } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../api'
import { Aviso, CabecalhoPagina, Campo, Carregando, Vazio } from '../../componentes/Basicos'
import { GradeHorario } from '../../componentes/HorarioContratual'
import Modal from '../../componentes/Modal'
import { useNotificar } from '../../componentes/Notificacoes'
import { useEmpresaAtual, useEmpresas } from '../../contexto/Empresa'
import { db } from '../../banco'
import { useColecao } from '../../hooks/useColecao'
import { mensagemErro } from '../../lib/erros'
import { normalizarBusca, somenteDigitos } from '../../lib/formatos'
import { jornadaDoHorario, MODELOS_HORARIO, problemaNoHorario, textoDoHorario, totalSemanal } from '../../lib/horario'
import { ordenarPorNome, paraEscala, paraFuncionario, type Empresa, type Escala, type Funcionario } from '../../tipos'

// Escalas de horário da empresa: o horário da escala é copiado para o cadastro
// de cada funcionário dela, e mudar a escala muda o de todos (ver
// functions/src/escalas.ts).

/** "1 funcionário", "3 funcionários". */
function quantos(n: number): string {
  return `${n} funcionário${n === 1 ? '' : 's'}`
}

/** "Ana, Bia, Caio" (com muitos, os primeiros e quantos faltam). */
function nomes(funcionarios: Funcionario[]): string {
  const lista = funcionarios.map((f) => f.nome)
  return lista.length > 12 ? `${lista.slice(0, 12).join(', ')} e mais ${lista.length - 12}` : lista.join(', ')
}

export default function Escalas() {
  const empresa = useEmpresaAtual()
  const escalas = useColecao(() => collection(db, 'empresas', empresa.id, 'escalas'), paraEscala, `${empresa.id}:escalas`)
  const funcionarios = useColecao(() => collection(db, 'empresas', empresa.id, 'funcionarios'), paraFuncionario, `${empresa.id}:todos`)
  const [editando, setEditando] = useState<Escala | 'nova' | null>(null)
  const [associando, setAssociando] = useState<Escala | null>(null)

  const lista = ordenarPorNome(escalas.dados)
  const daEscala = (escala: Escala) => funcionarios.dados.filter((f) => f.escalaId === escala.id)
  const semEscala = ordenarPorNome(funcionarios.dados.filter((f) => f.ativo && !lista.some((e) => e.id === f.escalaId)))
  const erro = escalas.erro ?? funcionarios.erro

  return (
    <>
      <CabecalhoPagina
        titulo="Escalas de horário"
        descricao="Crie as escalas e associe os funcionários a elas. O horário da escala vale para o espelho e o AEJ, e mudar a escala muda o horário de todos dela."
        acoes={
          <button type="button" className="botao primario" onClick={() => setEditando('nova')}>
            <Plus size={16} aria-hidden /> Nova escala
          </button>
        }
      />

      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <section className="cartao sem-preenchimento">
        {escalas.carregando || funcionarios.carregando ? (
          <Carregando />
        ) : lista.length === 0 ? (
          <Vazio icone={CalendarClock} titulo="Nenhuma escala cadastrada">
            Crie a primeira (ex.: Comercial 44h) e associe os funcionários de uma vez.
          </Vazio>
        ) : (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Escala</th>
                  <th>Horário</th>
                  <th>Semana</th>
                  <th>Funcionários</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {lista.map((e) => {
                  const deles = daEscala(e)
                  const inativos = deles.filter((f) => !f.ativo).length
                  return (
                    <tr key={e.id}>
                      <td>
                        <strong>{e.nome}</strong>
                      </td>
                      <td>{textoDoHorario(e.horario)}</td>
                      <td className="numeros">{totalSemanal(e.jornada)}</td>
                      <td>
                        {deles.length - inativos}
                        {inativos > 0 && <small className="texto-suave"> (+{inativos} inativo{inativos === 1 ? '' : 's'})</small>}
                      </td>
                      <td>
                        <div className="acoes-linha">
                          <button type="button" className="botao pequeno" onClick={() => setAssociando(e)}>
                            <Users size={14} aria-hidden /> Funcionários
                          </button>
                          <button type="button" className="botao-icone" onClick={() => setEditando(e)} aria-label={`Editar ${e.nome}`} title="Editar escala">
                            <Pencil size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {lista.length > 0 && semEscala.length > 0 && <p className="texto-suave">Sem escala (com horário próprio): {nomes(semEscala)}.</p>}

      {editando && (
        <FormEscala
          empresa={empresa}
          escala={editando === 'nova' ? null : editando}
          membros={editando === 'nova' ? [] : daEscala(editando)}
          aoFechar={(criada) => {
            setEditando(null)
            // Escala nova: já abre a escolha dos funcionários.
            if (criada && funcionarios.dados.length > 0) setAssociando(criada)
          }}
        />
      )}
      {associando && (
        <AssociarFuncionarios
          empresa={empresa}
          escala={associando}
          escalas={lista}
          funcionarios={funcionarios.dados}
          aoFechar={() => setAssociando(null)}
        />
      )}
    </>
  )
}

function FormEscala({
  empresa,
  escala,
  membros,
  aoFechar,
}: {
  empresa: Empresa
  escala: Escala | null
  /** Funcionários da escala (o horário deles muda junto). */
  membros: Funcionario[]
  /** criada: a escala nova, para associar os funcionários em seguida. */
  aoFechar: (criada?: Escala) => void
}) {
  const notificar = useNotificar()
  const nova = escala === null
  // Escala nova: dá para criar a mesma nas outras empresas (ex.: do mesmo grupo, na mesma loja).
  const outrasEmpresas = ordenarPorNome(useEmpresas().empresas.filter((e) => e.ativo && e.id !== empresa.id))
  const [nome, setNome] = useState(escala?.nome ?? '')
  const [horario, setHorario] = useState(escala?.horario ?? MODELOS_HORARIO[0].horario)
  const [copiarPara, setCopiarPara] = useState<string[]>([])
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function salvar() {
    setErro('')
    if (nome.trim().length < 2) return setErro('Dê um nome à escala (ex.: Comercial 44h).')
    const problema = problemaNoHorario(horario)
    if (problema) return setErro(problema)
    if (jornadaDoHorario(horario).every((minutos) => minutos === 0)) return setErro('A escala precisa de pelo menos um dia de trabalho.')

    setSalvando(true)
    try {
      const r = await api.salvarEscala({ empresaId: empresa.id, ...(escala ? { id: escala.id } : { copiarPara }), nome: nome.trim(), horario })
      if (escala) {
        notificar(r.funcionariosAtualizados > 0 ? `Escala salva: o horário de ${quantos(r.funcionariosAtualizados)} mudou junto.` : 'Escala salva.')
        aoFechar()
      } else {
        notificar(r.copias > 0 ? `Escala criada aqui e em mais ${r.copias === 1 ? '1 empresa' : `${r.copias} empresas`}.` : 'Escala criada.')
        aoFechar({ id: r.id, nome: nome.trim(), horario, jornada: jornadaDoHorario(horario) })
      }
    } catch (e) {
      setErro(mensagemErro(e))
    } finally {
      setSalvando(false)
    }
  }

  async function excluir() {
    if (!escala) return
    const quemFica =
      membros.length === 0
        ? ''
        : membros.length === 1
          ? ` ${membros[0].nome} continua com o mesmo horário, como horário próprio.`
          : ` Os ${quantos(membros.length)} dela continuam com o mesmo horário, como horário próprio.`
    if (!window.confirm(`Excluir a escala ${escala.nome}?${quemFica}`)) return
    setErro('')
    setSalvando(true)
    try {
      await api.removerEscala({ empresaId: empresa.id, escalaId: escala.id })
      notificar('Escala excluída.')
      aoFechar()
    } catch (e) {
      setErro(mensagemErro(e))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal
      titulo={nova ? 'Nova escala' : `Editar escala: ${escala.nome}`}
      aoFechar={() => aoFechar()}
      aoEnviar={salvar}
      largura="grande"
      rodape={
        <>
          {!nova && (
            <button type="button" className="botao perigo-suave empurrar-esquerda" onClick={() => void excluir()} disabled={salvando}>
              <Trash2 size={16} aria-hidden /> Excluir escala
            </button>
          )}
          <button type="button" className="botao fantasma" onClick={() => aoFechar()} disabled={salvando}>
            Cancelar
          </button>
          <button type="submit" className="botao primario" disabled={salvando}>
            {salvando ? 'Salvando...' : nova ? 'Criar escala' : 'Salvar'}
          </button>
        </>
      }
    >
      <Campo rotulo="Nome da escala" ajuda="Ex.: Comercial 44h, Turno da tarde, Meio período.">
        <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} autoFocus />
      </Campo>

      <fieldset className="grupo">
        <legend>Horário</legend>
        <GradeHorario horario={horario} aoMudar={setHorario} />
      </fieldset>

      {membros.length > 0 && (
        <Aviso>
          Ao salvar, o horário de quem está nesta escala ({membros.length === 1 ? membros[0].nome : quantos(membros.length)}) muda junto. Os meses
          já fechados continuam como estão.
        </Aviso>
      )}

      {nova && outrasEmpresas.length > 0 && (
        <fieldset className="grupo">
          <legend>Criar também em</legend>
          <p className="texto-suave">A mesma escala nas outras empresas. Cada empresa fica com a sua: mudar uma depois não muda as outras.</p>
          {outrasEmpresas.map((outra) => (
            <label key={outra.id} className="caixa-marcar">
              <input
                type="checkbox"
                checked={copiarPara.includes(outra.id)}
                onChange={(e) => setCopiarPara(e.target.checked ? [...copiarPara, outra.id] : copiarPara.filter((id) => id !== outra.id))}
              />
              <span>{outra.nome}</span>
            </label>
          ))}
        </fieldset>
      )}

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
    </Modal>
  )
}

/**
 * Marca e desmarca quem é da escala. Salva só o que mudou desde que a janela
 * abriu (quem entra e quem sai), sem desfazer o que outra pessoa fez ao mesmo tempo.
 */
function AssociarFuncionarios({
  empresa,
  escala,
  escalas,
  funcionarios,
  aoFechar,
}: {
  empresa: Empresa
  escala: Escala
  escalas: Escala[]
  funcionarios: Funcionario[]
  aoFechar: () => void
}) {
  const notificar = useNotificar()
  const [iniciais] = useState(() => new Set(funcionarios.filter((f) => f.escalaId === escala.id).map((f) => f.id)))
  const [marcados, setMarcados] = useState(() => new Set(iniciais))
  const [busca, setBusca] = useState('')
  const [mostrarInativos, setMostrarInativos] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const nomeDaEscala = new Map(escalas.map((e) => [e.id, e.nome]))
  const termo = normalizarBusca(busca)
  const digitos = somenteDigitos(busca)
  const visiveis = ordenarPorNome(funcionarios)
    .filter((f) => mostrarInativos || f.ativo || iniciais.has(f.id))
    .filter((f) => !termo || normalizarBusca(f.nome).includes(termo) || (digitos.length > 0 && f.matricula === digitos.replace(/^0+(?=\d)/, '')))
  const adicionar = [...marcados].filter((id) => !iniciais.has(id))
  const remover = [...iniciais].filter((id) => !marcados.has(id))

  function marcar(ids: string[], sim: boolean) {
    const novos = new Set(marcados)
    for (const id of ids) {
      if (sim) novos.add(id)
      else novos.delete(id)
    }
    setMarcados(novos)
  }

  async function salvar() {
    if (adicionar.length + remover.length === 0) return aoFechar()
    setErro('')
    setSalvando(true)
    try {
      const r = await api.associarEscala({ empresaId: empresa.id, escalaId: escala.id, adicionar, remover })
      const partes = [
        ...(r.adicionados > 0 ? [`${quantos(r.adicionados)} ${r.adicionados === 1 ? 'entrou' : 'entraram'}`] : []),
        ...(r.removidos > 0 ? [`${quantos(r.removidos)} ${r.removidos === 1 ? 'saiu' : 'saíram'}`] : []),
      ]
      notificar(partes.length > 0 ? `Escala ${escala.nome}: ${partes.join(' e ')}.` : 'Nada mudou.')
      aoFechar()
    } catch (e) {
      setErro(mensagemErro(e))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal
      titulo={`Funcionários da escala ${escala.nome}`}
      aoFechar={aoFechar}
      rodape={
        <>
          <button type="button" className="botao fantasma" onClick={aoFechar} disabled={salvando}>
            Cancelar
          </button>
          <button type="button" className="botao primario" onClick={() => void salvar()} disabled={salvando}>
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
        </>
      }
    >
      <p className="texto-suave">
        Marque quem trabalha nesta escala ({textoDoHorario(escala.horario)}). Quem entra fica com este horário, mesmo vindo de outra escala;
        quem sai continua com o mesmo horário, como horário próprio.
      </p>
      <div className="barra-escolha">
        <div className="busca">
          <Search size={16} aria-hidden />
          <input placeholder="Buscar por nome ou matrícula" aria-label="Buscar funcionário" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <button type="button" className="botao pequeno" onClick={() => marcar(visiveis.map((f) => f.id), true)}>
          Marcar todos
        </button>
        <button type="button" className="botao pequeno" onClick={() => marcar(visiveis.map((f) => f.id), false)}>
          Desmarcar todos
        </button>
      </div>
      <div className="lista-marcar lista-escala">
        {visiveis.length === 0 && <p className="texto-suave">Nenhum funcionário encontrado.</p>}
        {visiveis.map((f) => {
          const hoje =
            f.escalaId === escala.id
              ? ''
              : f.escalaId && nomeDaEscala.has(f.escalaId)
                ? ` · hoje na escala ${nomeDaEscala.get(f.escalaId)}`
                : f.horario
                  ? ' · horário próprio'
                  : ' · sem horário'
          return (
            <label key={f.id} className="caixa-marcar">
              <input type="checkbox" checked={marcados.has(f.id)} onChange={(e) => marcar([f.id], e.target.checked)} />
              <span>
                {f.nome}{' '}
                <small className="texto-suave">
                  matrícula {f.matricula}
                  {f.ativo ? '' : ' · inativo'}
                  {hoje}
                </small>
              </span>
            </label>
          )
        })}
      </div>
      <div className="rodape-escolha">
        <label className="caixa-marcar">
          <input type="checkbox" checked={mostrarInativos} onChange={(e) => setMostrarInativos(e.target.checked)} />
          Mostrar inativos
        </label>
        <span className="texto-suave" role="status">
          {marcados.size} na escala
          {adicionar.length > 0 && ` · ${adicionar.length} entra${adicionar.length === 1 ? '' : 'm'}`}
          {remover.length > 0 && ` · ${remover.length} sai${remover.length === 1 ? '' : 'em'}`}
        </span>
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
    </Modal>
  )
}
