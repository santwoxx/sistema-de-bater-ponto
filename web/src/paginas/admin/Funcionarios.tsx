import { collection, getDocs } from 'firebase/firestore'
import { Pencil, Search, Shuffle, UserPlus, Users } from 'lucide-react'
import { useRef, useState } from 'react'
import { api } from '../../api'
import { Aviso, CabecalhoPagina, Campo, Carregando, Selo, Vazio } from '../../componentes/Basicos'
import Modal from '../../componentes/Modal'
import { useNotificar } from '../../componentes/Notificacoes'
import { useEmpresaAtual, useEmpresas } from '../../contexto/Empresa'
import { db } from '../../banco'
import { useColecao } from '../../hooks/useColecao'
import { mensagemErro } from '../../lib/erros'
import { cpfValido, formatarCpf, normalizarBusca, somenteDigitos } from '../../lib/formatos'
import { gerarPin, problemaNoPin, TAMANHO_PIN } from '../../lib/pin'
import { horarioSugerido, jornadaDoHorario, paresDoDia, problemaNoHorario } from '../../lib/horario'
import { minutosParaHHMM, NOMES_DIAS_LONGOS } from '../../lib/tempo'
import { JORNADA_PADRAO, ordenarPorNome, paraFuncionario, type Empresa, type Funcionario } from '../../tipos'

const COMERCIAL = '08:00-12:00 13:00-17:00'
// Horários comuns (domingo a sábado); o gestor ajusta depois, se precisar.
const MODELOS_HORARIO = [
  { rotulo: '44h · seg a sex 8h + sáb 4h', horario: ['', COMERCIAL, COMERCIAL, COMERCIAL, COMERCIAL, COMERCIAL, '08:00-12:00'] },
  { rotulo: '44h · seg a sex 8h48', horario: ['', ...Array(5).fill('08:00-12:00 13:00-17:48'), ''] },
  { rotulo: '40h · seg a sex 8h', horario: ['', ...Array(5).fill(COMERCIAL), ''] },
  { rotulo: '36h · seg a sáb 6h', horario: ['', ...Array(6).fill('08:00-14:00')] },
  { rotulo: '30h · seg a sex 6h', horario: ['', ...Array(5).fill('08:00-14:00'), ''] },
]

/** Duração do dia para mostrar ao lado do horário: "8h", "8h48", "folga" ou "?" (formato errado). */
function duracaoDoDia(texto: string): string {
  const pares = paresDoDia(texto)
  if (!pares) return '?'
  const minutos = jornadaDoHorario([texto])[0]
  return minutos === 0 ? 'folga' : minutosParaHHMM(minutos).replace(/:00$/, 'h').replace(':', 'h')
}

function totalSemanal(jornada: number[]): string {
  const total = jornada.reduce((s, m) => s + m, 0)
  return minutosParaHHMM(total).replace(/:00$/, 'h').replace(':', 'h')
}

export default function Funcionarios() {
  const empresa = useEmpresaAtual()
  const funcionarios = useColecao(() => collection(db, 'empresas', empresa.id, 'funcionarios'), paraFuncionario, `${empresa.id}:todos`)
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<'ativos' | 'inativos' | 'todos'>('ativos')
  const [editando, setEditando] = useState<Funcionario | 'novo' | null>(null)

  const termo = normalizarBusca(busca)
  const digitos = somenteDigitos(busca)
  const lista = ordenarPorNome(funcionarios.dados)
    .filter((f) => (filtro === 'todos' ? true : filtro === 'ativos' ? f.ativo : !f.ativo))
    .filter(
      (f) =>
        !termo ||
        normalizarBusca(f.nome).includes(termo) ||
        (digitos.length > 0 && (f.matricula === digitos.replace(/^0+(?=\d)/, '') || f.cpf.includes(digitos))),
    )

  return (
    <>
      <CabecalhoPagina
        titulo="Funcionários"
        descricao="Cada funcionário bate o ponto no aparelho digitando só o PIN dele."
        acoes={
          <button type="button" className="botao primario" onClick={() => setEditando('novo')}>
            <UserPlus size={16} aria-hidden /> Novo funcionário
          </button>
        }
      />

      <div className="filtros cartao">
        <Campo rotulo="Buscar">
          <div className="busca">
            <Search size={16} aria-hidden />
            <input placeholder="Nome, matrícula ou CPF" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
        </Campo>
        <Campo rotulo="Situação">
          <select value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)}>
            <option value="ativos">Ativos</option>
            <option value="inativos">Inativos</option>
            <option value="todos">Todos</option>
          </select>
        </Campo>
      </div>

      {funcionarios.erro && <Aviso tipo="erro">{funcionarios.erro}</Aviso>}

      <section className="cartao sem-preenchimento">
        {funcionarios.carregando ? (
          <Carregando />
        ) : lista.length === 0 ? (
          <Vazio icone={Users} titulo={funcionarios.dados.length === 0 ? 'Nenhum funcionário cadastrado' : 'Nenhum resultado'}>
            {funcionarios.dados.length === 0 && 'Cadastre o primeiro funcionário para começar a usar o ponto.'}
          </Vazio>
        ) : (
          <div className="tabela-rolagem">
            <table className="tabela clicavel">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Matrícula</th>
                  <th>CPF</th>
                  <th>Cargo</th>
                  <th>Jornada</th>
                  <th>Situação</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {lista.map((f) => (
                  <tr key={f.id} onClick={() => setEditando(f)}>
                    <td>
                      <strong>{f.nome}</strong>
                    </td>
                    <td className="numeros">{f.matricula}</td>
                    <td className="numeros">{formatarCpf(f.cpf)}</td>
                    <td>{f.cargo || '—'}</td>
                    <td>{totalSemanal(f.jornada)}/sem</td>
                    <td>
                      {f.ativo ? <Selo cor="verde">Ativo</Selo> : <Selo>Inativo</Selo>}{' '}
                      {!f.pinDefinido && <Selo cor="amarelo">Sem PIN</Selo>}
                    </td>
                    <td>
                      <button type="button" className="botao-icone" aria-label={`Editar ${f.nome}`}>
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
        <FormFuncionario
          empresa={empresa}
          funcionario={editando === 'novo' ? null : editando}
          todos={funcionarios.dados}
          aoFechar={() => setEditando(null)}
        />
      )}
    </>
  )
}

function proximaMatricula(todos: Funcionario[]): string {
  const maior = todos.reduce((m, f) => Math.max(m, Number(f.matricula) || 0), 0)
  return String(maior + 1)
}

function FormFuncionario({
  empresa,
  funcionario,
  todos,
  aoFechar,
}: {
  empresa: Empresa
  funcionario: Funcionario | null
  todos: Funcionario[]
  aoFechar: () => void
}) {
  const notificar = useNotificar()
  const novo = funcionario === null
  // Funcionário novo: dá para cadastrar em outra empresa (ex.: do mesmo grupo, que divide o aparelho da loja).
  const empresasPossiveis = ordenarPorNome(useEmpresas().empresas.filter((e) => e.ativo || e.id === empresa.id))
  const [empresaId, setEmpresaId] = useState(empresa.id)
  const empresaEscolhida = empresasPossiveis.find((e) => e.id === empresaId) ?? empresa
  const [nome, setNome] = useState(funcionario?.nome ?? '')
  const [cpf, setCpf] = useState(funcionario ? formatarCpf(funcionario.cpf) : '')
  const [matricula, setMatricula] = useState(funcionario?.matricula ?? proximaMatricula(todos))
  const matriculaSugerida = useRef(matricula)
  const [cargo, setCargo] = useState(funcionario?.cargo ?? '')
  const [admissao, setAdmissao] = useState(funcionario?.admissao ?? '')
  // Quem foi cadastrado antes do horário contratual: sugestão a partir da jornada, para conferir.
  const [horario, setHorario] = useState(() => funcionario?.horario ?? horarioSugerido(funcionario?.jornada ?? JORNADA_PADRAO))
  const horarioSugeridoAgora = Boolean(funcionario && !funcionario.horario)
  const [ativo, setAtivo] = useState(funcionario?.ativo ?? true)
  // Sem PIN (cadastro novo ou PIN antigo): já sugere um, que o gestor pode trocar.
  const [alterarPin, setAlterarPin] = useState(novo || !funcionario?.pinDefinido)
  const [pin, setPin] = useState(() => (novo || !funcionario?.pinDefinido ? gerarPin() : ''))
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  // A matrícula sugerida é a próxima da empresa escolhida (sem apagar uma digitada).
  async function escolherEmpresa(id: string) {
    setEmpresaId(id)
    let sugestao = proximaMatricula(todos)
    if (id !== empresa.id) {
      try {
        sugestao = proximaMatricula((await getDocs(collection(db, 'empresas', id, 'funcionarios'))).docs.map(paraFuncionario))
      } catch {
        return
      }
    }
    if (matricula === matriculaSugerida.current) setMatricula(sugestao)
    matriculaSugerida.current = sugestao
  }

  async function salvar() {
    setErro('')
    if (nome.trim().length < 3) return setErro('Informe o nome completo.')
    if (!cpfValido(cpf)) return setErro('CPF inválido.')
    if (!/^\d{1,10}$/.test(matricula.trim())) return setErro('A matrícula deve ter apenas números (até 10 dígitos).')
    const problemaHorario = problemaNoHorario(horario)
    if (problemaHorario) return setErro(problemaHorario)
    if (alterarPin) {
      const problema = problemaNoPin(pin)
      if (problema) return setErro(problema)
    }

    setSalvando(true)
    try {
      await api.salvarFuncionario({
        empresaId,
        ...(funcionario ? { id: funcionario.id } : {}),
        nome: nome.trim(),
        cpf: somenteDigitos(cpf),
        matricula: matricula.trim(),
        cargo: cargo.trim(),
        admissao: admissao || null,
        jornada: jornadaDoHorario(horario),
        horario,
        ativo,
        ...(alterarPin ? { pin } : {}),
      })
      const feito = novo
        ? empresaId === empresa.id
          ? 'Funcionário cadastrado.'
          : `Funcionário cadastrado em ${empresaEscolhida.nome} (aparece na lista dessa empresa).`
        : 'Funcionário atualizado.'
      notificar(alterarPin ? `${feito} Passe o PIN ${pin} para ${nome.trim()}.` : feito)
      aoFechar()
    } catch (e) {
      setErro(mensagemErro(e))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal
      titulo={novo ? 'Novo funcionário' : `Editar: ${funcionario.nome}`}
      aoFechar={aoFechar}
      aoEnviar={salvar}
      largura="grande"
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
      {novo && empresasPossiveis.length > 1 && (
        <Campo rotulo="Empresa do funcionário" ajuda="As marcações dele vão para esta empresa, em qualquer aparelho que a atenda.">
          <select value={empresaId} onChange={(e) => void escolherEmpresa(e.target.value)}>
            {empresasPossiveis.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </select>
        </Campo>
      )}
      <div className="grade-2">
        <Campo rotulo="Nome completo">
          <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} autoFocus />
        </Campo>
        <Campo rotulo="CPF">
          <input value={cpf} onChange={(e) => setCpf(e.target.value)} inputMode="numeric" placeholder="000.000.000-00" maxLength={14} />
        </Campo>
        <Campo rotulo="Matrícula" ajuda="Número do funcionário na empresa (aparece nos relatórios).">
          <input value={matricula} onChange={(e) => setMatricula(somenteDigitos(e.target.value))} inputMode="numeric" maxLength={10} />
        </Campo>
        <Campo rotulo="Cargo (opcional)">
          <input value={cargo} onChange={(e) => setCargo(e.target.value)} maxLength={80} />
        </Campo>
        <Campo rotulo="Data de admissão (opcional)" ajuda="Dias anteriores não contam como falta no espelho.">
          <input type="date" value={admissao} onChange={(e) => setAdmissao(e.target.value)} />
        </Campo>
        <label className="caixa-marcar alinhar-base">
          <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
          Funcionário ativo (pode bater ponto)
        </label>
      </div>

      <fieldset className="grupo">
        <legend>Horário contratual</legend>
        <div className="modelos">
          {MODELOS_HORARIO.map((m) => (
            <button type="button" key={m.rotulo} className="botao pequeno" onClick={() => setHorario(m.horario)}>
              {m.rotulo}
            </button>
          ))}
        </div>
        {horarioSugeridoAgora && (
          <Aviso tipo="alerta">Horário sugerido a partir da jornada que estava cadastrada: confira com o contrato e salve.</Aviso>
        )}
        <div className="grade-horario">
          {[1, 2, 3, 4, 5, 6, 0].map((dia) => (
            <label key={dia} className="linha-horario">
              <span>{NOMES_DIAS_LONGOS[dia]}</span>
              <input
                value={horario[dia]}
                placeholder="folga"
                maxLength={60}
                onChange={(e) => setHorario(horario.map((v, i) => (i === dia ? e.target.value : v)))}
              />
              <small>{duracaoDoDia(horario[dia])}</small>
            </label>
          ))}
        </div>
        <small className="campo-ajuda">
          Entradas e saídas de cada dia, como no contrato: 08:00-12:00 13:00-17:00 (um espaço entre os pares). Em branco é folga. A jornada
          prevista do dia é a soma dos pares; ela vai no espelho e no AEJ (Portaria 671).
        </small>
      </fieldset>

      <fieldset className="grupo">
        <legend>PIN do ponto</legend>
        <p className="texto-suave">
          O funcionário bate o ponto digitando só este PIN de {TAMANHO_PIN} números, por isso cada funcionário (de todas as empresas)
          tem um PIN diferente.
          Passe o PIN para ele; se ele esquecer ou outra pessoa descobrir, troque aqui (trocar também desbloqueia quem errou demais).
          {!novo && !funcionario?.pinDefinido && ' Este funcionário ainda não tem o PIN de 4 números: salve um para ele bater o ponto.'}
        </p>
        {!novo && funcionario?.pinDefinido && (
          <label className="caixa-marcar">
            <input
              type="checkbox"
              checked={alterarPin}
              onChange={(e) => {
                setAlterarPin(e.target.checked)
                if (e.target.checked && !pin) setPin(gerarPin())
              }}
            />
            Trocar o PIN (esqueceu, ou outra pessoa descobriu)
          </label>
        )}
        {alterarPin && (
          <div className="grade-2">
            <Campo rotulo={`PIN (${TAMANHO_PIN} números)`} ajuda="Evite sequências (1234) e repetições (1111).">
              <input
                className="numeros"
                inputMode="numeric"
                autoComplete="off"
                value={pin}
                onChange={(e) => setPin(somenteDigitos(e.target.value).slice(0, TAMANHO_PIN))}
              />
            </Campo>
            <button type="button" className="botao alinhar-base" onClick={() => setPin(gerarPin())}>
              <Shuffle size={16} aria-hidden /> Gerar PIN
            </button>
          </div>
        )}
      </fieldset>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
    </Modal>
  )
}
