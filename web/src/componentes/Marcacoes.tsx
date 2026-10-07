import { Ban, ImageOff, LoaderCircle, PencilLine, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { mensagemErro } from '../lib/erros'
import { formatarNsr, mascararCpf } from '../lib/formatos'
import { dataLocal, formatarData, formatarDataHora, hhmmParaMinutos } from '../lib/tempo'
import type { Empresa, Funcionario, Registro } from '../tipos'
import { Aviso, Campo, Selo } from './Basicos'
import Modal from './Modal'
import { useNotificar } from './Notificacoes'

export function Miniatura({ registro, tamanho = 40, aoClicar }: { registro: Registro; tamanho?: number; aoClicar?: () => void }) {
  const conteudo = registro.miniatura ? (
    <img src={registro.miniatura} width={tamanho} height={tamanho} alt={`Foto de ${registro.funcionarioNome}`} />
  ) : registro.origem === 'manual' ? (
    <PencilLine size={tamanho * 0.45} aria-label="Marcação manual" />
  ) : (
    <ImageOff size={tamanho * 0.45} aria-label="Sem foto" />
  )
  return aoClicar ? (
    <button type="button" className="miniatura" style={{ width: tamanho, height: tamanho }} onClick={aoClicar} title="Ver detalhes">
      {conteudo}
    </button>
  ) : (
    <span className="miniatura" style={{ width: tamanho, height: tamanho }}>
      {conteudo}
    </span>
  )
}

// A foto vem pelo servidor (não há link público): ele confere o acesso à empresa
// e se o arquivo é o mesmo gravado no momento da marcação.
function FotoCompleta({ empresaId, registroId, alt }: { empresaId: string; registroId: string; alt: string }) {
  const [foto, setFoto] = useState<{ url: string; confere: boolean } | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let ativo = true
    api
      .obterFoto({ empresaId, registroId })
      .then((r) => ativo && setFoto({ url: r.foto, confere: r.confere }))
      .catch((e) => ativo && setErro(mensagemErro(e)))
    return () => {
      ativo = false
    }
  }, [empresaId, registroId])

  if (erro) return <div className="foto-grande foto-grande-vazia">{erro}</div>
  if (!foto) {
    return (
      <div className="foto-grande foto-grande-vazia">
        <LoaderCircle className="girando" aria-hidden /> Carregando foto...
      </div>
    )
  }
  return (
    <>
      <img className="foto-grande" src={foto.url} alt={alt} />
      {!foto.confere && (
        <Aviso tipo="erro">A foto guardada não confere com a registrada no momento da marcação: o arquivo foi alterado.</Aviso>
      )}
    </>
  )
}

export function DetalhesRegistro({ registro, empresa, aoFechar }: { registro: Registro; empresa: Empresa; aoFechar: () => void }) {
  const notificar = useNotificar()
  const [motivo, setMotivo] = useState('')
  const [desconsiderando, setDesconsiderando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const instante = registro.dataHora.toDate()

  async function alterar(restaurar: boolean) {
    setErro('')
    if (!restaurar && motivo.trim().length < 5) {
      setErro('Explique o motivo (mínimo de 5 caracteres).')
      return
    }
    setSalvando(true)
    try {
      await api.desconsiderarMarcacao({
        empresaId: empresa.id,
        registroId: registro.id,
        ...(restaurar ? { restaurar: true } : { motivo: motivo.trim() }),
      })
      notificar(restaurar ? 'Marcação voltou a valer.' : 'Marcação desconsiderada.')
      aoFechar()
    } catch (e) {
      setErro(mensagemErro(e))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal titulo="Detalhes da marcação" aoFechar={aoFechar} largura="grande">
      <div className="detalhes-registro">
        <div>
          {registro.fotoPath ? (
            <FotoCompleta empresaId={empresa.id} registroId={registro.id} alt={`Foto de ${registro.funcionarioNome}`} />
          ) : (
            <div className="foto-grande foto-grande-vazia">Marcação incluída manualmente: sem foto.</div>
          )}
        </div>
        <dl className="lista-dados">
          <dt>Funcionário</dt>
          <dd>
            <strong>{registro.funcionarioNome}</strong>
            <br />
            Matrícula {registro.funcionarioMatricula} · CPF {mascararCpf(registro.funcionarioCpf)}
          </dd>
          <dt>Data e hora</dt>
          <dd>
            {formatarData(registro.dataLocal)} às {registro.horaLocal}
          </dd>
          <dt>Origem</dt>
          <dd>
            {registro.origem === 'manual' ? (
              <>
                Incluída por <strong>{registro.incluidoPor?.nome}</strong>
                <br />
                Justificativa: {registro.justificativa}
              </>
            ) : (
              <>Aparelho "{registro.dispositivoNome}"</>
            )}
          </dd>
          {registro.nsr !== undefined && (
            <>
              <dt>NSR</dt>
              <dd className="numeros">{formatarNsr(registro.nsr)}</dd>
              <dt>Código de verificação</dt>
              <dd className="numeros">{registro.hash?.slice(0, 12).toUpperCase()}</dd>
              <dt>Hash de integridade</dt>
              <dd className="hash">{registro.hash}</dd>
            </>
          )}
          <dt>Situação</dt>
          <dd>
            {registro.desconsiderado ? (
              <>
                <Selo cor="vermelho">Desconsiderada</Selo>
                <br />
                Por {registro.desconsiderado.por?.nome}
                {registro.desconsiderado.em && ` em ${formatarDataHora(registro.desconsiderado.em.toDate(), empresa.fusoHorario)}`}
                <br />
                Motivo: {registro.desconsiderado.motivo}
              </>
            ) : (
              <Selo cor="verde">Válida</Selo>
            )}
          </dd>
        </dl>
      </div>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      {registro.desconsiderado ? (
        <div className="acoes-detalhe">
          <button type="button" className="botao" disabled={salvando} onClick={() => alterar(true)}>
            <RotateCcw size={16} aria-hidden /> Voltar a considerar
          </button>
        </div>
      ) : desconsiderando ? (
        <div className="desconsiderar">
          <Campo rotulo="Motivo para desconsiderar" ajuda="A marcação original continua guardada; ela só deixa de contar no espelho.">
            <textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus maxLength={500} />
          </Campo>
          <div className="acoes-detalhe">
            <button type="button" className="botao fantasma" onClick={() => setDesconsiderando(false)} disabled={salvando}>
              Cancelar
            </button>
            <button type="button" className="botao perigo" onClick={() => alterar(false)} disabled={salvando}>
              <Ban size={16} aria-hidden /> Confirmar
            </button>
          </div>
        </div>
      ) : (
        <div className="acoes-detalhe">
          <span className="texto-suave">Registrada em {formatarDataHora(instante, empresa.fusoHorario)}</span>
          <button type="button" className="botao perigo-suave" onClick={() => setDesconsiderando(true)}>
            <Ban size={16} aria-hidden /> Desconsiderar
          </button>
        </div>
      )}
    </Modal>
  )
}

export function ModalIncluirMarcacao({
  empresa,
  funcionarios,
  funcionarioIdInicial = '',
  dataInicial,
  aoFechar,
}: {
  empresa: Empresa
  funcionarios: Funcionario[]
  funcionarioIdInicial?: string
  dataInicial?: string
  aoFechar: () => void
}) {
  const notificar = useNotificar()
  const [hoje] = useState(() => dataLocal(new Date(), empresa.fusoHorario))
  const [funcionarioId, setFuncionarioId] = useState(funcionarioIdInicial)
  const [data, setData] = useState(dataInicial ?? hoje)
  const [hora, setHora] = useState('')
  const [justificativa, setJustificativa] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function salvar() {
    setErro('')
    if (!funcionarioId) return setErro('Escolha o funcionário.')
    if (!data || data > hoje) return setErro('Informe uma data até hoje.')
    if (Number.isNaN(hhmmParaMinutos(hora))) return setErro('Informe a hora no formato HH:MM.')
    if (justificativa.trim().length < 5) return setErro('Escreva a justificativa (mínimo de 5 caracteres).')
    setSalvando(true)
    try {
      await api.incluirMarcacao({ empresaId: empresa.id, funcionarioId, data, hora, justificativa: justificativa.trim() })
      notificar('Marcação incluída.')
      aoFechar()
    } catch (e) {
      setErro(mensagemErro(e))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal
      titulo="Incluir marcação manual"
      aoFechar={aoFechar}
      aoEnviar={salvar}
      rodape={
        <>
          <button type="button" className="botao fantasma" onClick={aoFechar} disabled={salvando}>
            Cancelar
          </button>
          <button type="submit" className="botao primario" disabled={salvando}>
            {salvando ? 'Salvando...' : 'Incluir marcação'}
          </button>
        </>
      }
    >
      <Aviso tipo="info">Use para corrigir esquecimentos. A inclusão fica registrada na auditoria com o seu nome e a justificativa.</Aviso>
      <Campo rotulo="Funcionário">
        <select value={funcionarioId} onChange={(e) => setFuncionarioId(e.target.value)}>
          <option value="">Selecione...</option>
          {funcionarios.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nome} (matrícula {f.matricula}){f.ativo ? '' : ' · inativo'}
            </option>
          ))}
        </select>
      </Campo>
      <div className="grade-2">
        <Campo rotulo="Data">
          <input type="date" value={data} max={hoje} onChange={(e) => setData(e.target.value)} />
        </Campo>
        <Campo rotulo="Hora">
          <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
        </Campo>
      </div>
      <Campo rotulo="Justificativa">
        <textarea
          rows={3}
          value={justificativa}
          onChange={(e) => setJustificativa(e.target.value)}
          maxLength={500}
          placeholder="Ex.: funcionário esqueceu de registrar a saída; confirmado com o gerente."
        />
      </Campo>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
    </Modal>
  )
}
