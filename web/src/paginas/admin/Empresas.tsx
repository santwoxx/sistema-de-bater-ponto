import { Building2, Pencil, Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../api'
import { Aviso, CabecalhoPagina, Campo, Carregando, Selo, Vazio } from '../../componentes/Basicos'
import Modal from '../../componentes/Modal'
import { useNotificar } from '../../componentes/Notificacoes'
import { useEmpresas } from '../../contexto/Empresa'
import { mensagemErro } from '../../lib/erros'
import { cnpjValido, formatarCnpj, normalizarBusca } from '../../lib/formatos'
import { dataLocal, FUSOS_BRASIL } from '../../lib/tempo'
import type { Empresa } from '../../tipos'

export default function Empresas() {
  const { empresas, carregando, empresa: selecionada, selecionar } = useEmpresas()
  const [busca, setBusca] = useState('')
  const [editando, setEditando] = useState<Empresa | 'nova' | null>(null)

  const termo = normalizarBusca(busca)
  const termoCnpj = busca.toUpperCase().replace(/[^0-9A-Z]/g, '')
  const lista = empresas.filter(
    (e) => !termo || normalizarBusca(e.nome).includes(termo) || (termoCnpj.length >= 2 && e.cnpj.includes(termoCnpj)),
  )

  return (
    <>
      <CabecalhoPagina
        titulo="Empresas"
        descricao="Cada empresa tem seus próprios funcionários, aparelhos e marcações."
        acoes={
          <button type="button" className="botao primario" onClick={() => setEditando('nova')}>
            <Plus size={16} aria-hidden /> Nova empresa
          </button>
        }
      />

      <div className="filtros cartao">
        <Campo rotulo="Buscar">
          <div className="busca">
            <Search size={16} aria-hidden />
            <input placeholder="Nome ou CNPJ" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
        </Campo>
      </div>

      <section className="cartao sem-preenchimento">
        {carregando ? (
          <Carregando />
        ) : lista.length === 0 ? (
          <Vazio icone={Building2} titulo={empresas.length === 0 ? 'Nenhuma empresa cadastrada' : 'Nenhum resultado'} />
        ) : (
          <div className="tabela-rolagem">
            <table className="tabela clicavel">
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>CNPJ</th>
                  <th>Fuso horário</th>
                  <th>Situação</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {lista.map((e) => (
                  <tr key={e.id} onClick={() => setEditando(e)}>
                    <td>
                      <strong>{e.nome}</strong>
                      {e.id === selecionada?.id && <small className="bloco">selecionada no painel</small>}
                    </td>
                    <td className="numeros">{e.cnpj ? formatarCnpj(e.cnpj) : '—'}</td>
                    <td>{FUSOS_BRASIL.find((f) => f.valor === e.fusoHorario)?.rotulo ?? e.fusoHorario}</td>
                    <td>{e.ativo ? <Selo cor="verde">Ativa</Selo> : <Selo>Inativa</Selo>}</td>
                    <td>
                      <button type="button" className="botao-icone" aria-label={`Editar ${e.nome}`}>
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
        <FormEmpresa
          empresa={editando === 'nova' ? null : editando}
          aoFechar={() => setEditando(null)}
          aoCriar={(id) => selecionar(id)}
        />
      )}
    </>
  )
}

function FormEmpresa({ empresa, aoFechar, aoCriar }: { empresa: Empresa | null; aoFechar: () => void; aoCriar: (id: string) => void }) {
  const notificar = useNotificar()
  const [nome, setNome] = useState(empresa?.nome ?? '')
  const [cnpj, setCnpj] = useState(empresa?.cnpj ? formatarCnpj(empresa.cnpj) : '')
  const [fusoHorario, setFusoHorario] = useState(empresa?.fusoHorario ?? 'America/Sao_Paulo')
  const [intervalo, setIntervalo] = useState(String(empresa?.intervaloMinimoMinutos ?? 2))
  const [tolerancia, setTolerancia] = useState(String(empresa?.toleranciaMinutos ?? 10))
  const [inicioControle, setInicioControle] = useState(
    () => (empresa ? empresa.inicioControle : dataLocal(new Date(), 'America/Sao_Paulo')) ?? '',
  )
  const [ativo, setAtivo] = useState(empresa?.ativo ?? true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function salvar() {
    setErro('')
    if (nome.trim().length < 2) return setErro('Informe o nome da empresa.')
    if (cnpj.trim() && !cnpjValido(cnpj)) return setErro('CNPJ inválido.')
    const intervaloMinimoMinutos = Number(intervalo)
    const toleranciaMinutos = Number(tolerancia)
    if (!Number.isInteger(intervaloMinimoMinutos) || intervaloMinimoMinutos < 0 || intervaloMinimoMinutos > 60) {
      return setErro('O intervalo mínimo deve ser de 0 a 60 minutos.')
    }
    if (!Number.isInteger(toleranciaMinutos) || toleranciaMinutos < 0 || toleranciaMinutos > 60) {
      return setErro('A tolerância deve ser de 0 a 60 minutos.')
    }
    setSalvando(true)
    try {
      const { id } = await api.salvarEmpresa({
        ...(empresa ? { id: empresa.id } : {}),
        nome: nome.trim(),
        cnpj: cnpj.trim(),
        fusoHorario,
        intervaloMinimoMinutos,
        toleranciaMinutos,
        inicioControle: inicioControle || null,
        ativo,
      })
      notificar(empresa ? 'Empresa atualizada.' : 'Empresa cadastrada.')
      if (!empresa) aoCriar(id)
      aoFechar()
    } catch (e) {
      setErro(mensagemErro(e))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal
      titulo={empresa ? `Editar: ${empresa.nome}` : 'Nova empresa'}
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
      <Campo rotulo="Nome da empresa">
        <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} autoFocus />
      </Campo>
      <Campo rotulo="CNPJ (opcional)" ajuda="Aceita o CNPJ numérico e o novo CNPJ alfanumérico.">
        <input value={cnpj} onChange={(e) => setCnpj(e.target.value.toUpperCase())} maxLength={18} placeholder="00.000.000/0000-00" />
      </Campo>
      <Campo rotulo="Fuso horário da loja" ajuda="Define o dia e a hora das marcações desta empresa.">
        <select value={fusoHorario} onChange={(e) => setFusoHorario(e.target.value)}>
          {FUSOS_BRASIL.map((f) => (
            <option key={f.valor} value={f.valor}>
              {f.rotulo}
            </option>
          ))}
          {!FUSOS_BRASIL.some((f) => f.valor === fusoHorario) && <option value={fusoHorario}>{fusoHorario}</option>}
        </select>
      </Campo>
      <div className="grade-2">
        <Campo rotulo="Intervalo mínimo entre batidas (min)" ajuda="Evita batida duplicada por engano.">
          <input type="number" min={0} max={60} value={intervalo} onChange={(e) => setIntervalo(e.target.value)} />
        </Campo>
        <Campo rotulo="Tolerância diária no saldo (min)" ajuda="Diferenças até este limite não geram saldo no dia.">
          <input type="number" min={0} max={60} value={tolerancia} onChange={(e) => setTolerancia(e.target.value)} />
        </Campo>
      </div>
      <Campo
        rotulo="Início do controle de ponto"
        ajuda="Antes desta data, dias sem marcação não contam como falta no espelho (útil ao implantar no meio do mês)."
      >
        <input type="date" value={inicioControle} onChange={(e) => setInicioControle(e.target.value)} />
      </Campo>
      <label className="caixa-marcar">
        <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
        Empresa ativa (aparelhos podem registrar ponto)
      </label>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
    </Modal>
  )
}
