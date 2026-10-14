import { collection, doc, getDoc, type Timestamp } from 'firebase/firestore'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { api } from '../../api'
import { db } from '../../banco'
import { Aviso, CabecalhoPagina, Campo, Carregando } from '../../componentes/Basicos'
import { useNotificar } from '../../componentes/Notificacoes'
import { useEmpresas } from '../../contexto/Empresa'
import { useColecao } from '../../hooks/useColecao'
import { mensagemErro } from '../../lib/erros'
import { cnpjValido, cpfValido, somenteDigitos } from '../../lib/formatos'
import { formatarDataHora } from '../../lib/tempo'

// Dados do REP-P (Portaria MTP nº 671/2021) que valem para todas as empresas:
// o número do registro do programa no INPI e o desenvolvedor, que vão no AFD,
// no AEJ e no comprovante do trabalhador. E o que ainda falta cadastrar.

interface Configuracao {
  inpi: string
  documento: string
  nome: string
  email: string
  programaNome: string
  programaVersao: string
}

/** Titular e validade do certificado enviado (o arquivo e a senha ficam só no servidor). */
interface ResumoCertificado {
  titular: string
  documento: string
  emissor: string
  validoAte: Timestamp | null
  icpBrasil: boolean
}

const MAX_PFX_BYTES = 64 * 1024

const VAZIA: Configuracao = { inpi: '', documento: '', nome: '', email: '', programaNome: 'Ponto Digital', programaVersao: '1.0' }

export default function Portaria671() {
  const notificar = useNotificar()
  const { empresas } = useEmpresas()
  const usuarios = useColecao(
    () => collection(db, 'usuarios'),
    (snap) => ({ nome: String(snap.get('nome') ?? ''), cpf: String(snap.get('cpf') ?? ''), ativo: snap.get('ativo') === true }),
    'usuarios-cpf',
  )
  const [dados, setDados] = useState<Configuracao | null>(null)
  const [certificado, setCertificado] = useState<ResumoCertificado | null>(null)
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [senhaCertificado, setSenhaCertificado] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erroCertificado, setErroCertificado] = useState('')
  const [versao, setVersao] = useState(0)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let ativo = true
    getDoc(doc(db, 'sistema', 'rep'))
      .then((snap) => {
        if (!ativo) return
        const d = snap.data() ?? {}
        setCertificado(d.certificado ?? null)
        setDados({
          inpi: d.inpi ?? '',
          documento: d.desenvolvedor?.documento ?? '',
          nome: d.desenvolvedor?.nome ?? '',
          email: d.desenvolvedor?.email ?? '',
          programaNome: d.programa?.nome ?? VAZIA.programaNome,
          programaVersao: d.programa?.versao ?? VAZIA.programaVersao,
        })
      })
      .catch((e) => ativo && setErro(mensagemErro(e)))
    return () => {
      ativo = false
    }
  }, [versao])

  async function enviarCertificado(e: FormEvent) {
    e.preventDefault()
    setErroCertificado('')
    if (!arquivo) return setErroCertificado('Escolha o arquivo do certificado (.pfx ou .p12).')
    if (arquivo.size > MAX_PFX_BYTES) return setErroCertificado('Arquivo grande demais para um certificado A1.')
    setEnviando(true)
    try {
      const bytes = new Uint8Array(await arquivo.arrayBuffer())
      let binario = ''
      for (const byte of bytes) binario += String.fromCharCode(byte)
      const resultado = await api.salvarCertificado({ pfx: btoa(binario), senha: senhaCertificado })
      notificar(`Certificado de ${resultado.titular} enviado.`)
      setArquivo(null)
      setSenhaCertificado('')
      setVersao((v) => v + 1)
    } catch (err) {
      setErroCertificado(mensagemErro(err))
    } finally {
      setEnviando(false)
    }
  }

  async function removerCertificado() {
    if (!window.confirm('Remover o certificado? O AFD e os comprovantes passam a sair sem assinatura.')) return
    setErroCertificado('')
    try {
      await api.removerCertificado({})
      notificar('Certificado removido.')
      setVersao((v) => v + 1)
    } catch (err) {
      setErroCertificado(mensagemErro(err))
    }
  }

  const mudar = (campo: keyof Configuracao) => (valor: string) => setDados((atual) => (atual ? { ...atual, [campo]: valor } : atual))

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (!dados) return
    setErro('')
    const documento = dados.documento.replace(/[^0-9A-Za-z]/g, '').toUpperCase()
    if (documento && !(documento.length === 11 ? cpfValido(documento) : cnpjValido(documento))) return setErro('CNPJ ou CPF do desenvolvedor inválido.')
    if (somenteDigitos(dados.inpi).length > 17) return setErro('O número do registro no INPI tem no máximo 17 dígitos.')
    setSalvando(true)
    try {
      await api.salvarConfiguracaoRep({ ...dados, documento })
      notificar('Dados do REP-P salvos.')
    } catch (e) {
      setErro(mensagemErro(e))
    } finally {
      setSalvando(false)
    }
  }

  const ativas = empresas.filter((e) => e.ativo)
  const pendencias = [
    ...(dados && !dados.inpi ? ['Número do registro do programa no INPI (vai no AFD, no AEJ e no comprovante).'] : []),
    ...(dados && !dados.documento ? ['CNPJ ou CPF do desenvolvedor (vai no AFD e no AEJ).'] : []),
    ...ativas.filter((e) => !e.cnpj).map((e) => `CNPJ da empresa ${e.nome} (sem ele, o AFD não é gerado).`),
    ...ativas.filter((e) => !e.endereco).map((e) => `Endereço (local da prestação do serviço) da empresa ${e.nome}.`),
    ...usuarios.dados.filter((u) => u.ativo && !u.cpf).map((u) => `CPF do usuário ${u.nome} (vai no AFD como responsável pelas alterações que ele fizer).`),
    ...(dados && !certificado ? ['Certificado digital A1 (ICP-Brasil) do desenvolvedor: sem ele, o AFD e os comprovantes saem sem assinatura.'] : []),
    ...(certificado && !certificado.icpBrasil ? ['O certificado enviado não é ICP-Brasil: as assinaturas não valem para a Portaria 671.'] : []),
  ]

  return (
    <>
      <CabecalhoPagina
        titulo="Portaria 671"
        descricao="Dados do registro eletrônico de ponto via programa (REP-P) que valem para todas as empresas."
      />

      <section className="cartao">
        <h2>
          <ShieldCheck size={18} aria-hidden /> O que falta cadastrar
        </h2>
        {pendencias.length === 0 ? (
          <p className="texto-suave">Nada: os dados que vão no AFD estão completos.</p>
        ) : (
          <ul className="lista-pendencias">
            {pendencias.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <p className="texto-suave">
          CNPJ e endereço ficam em <Link to="/admin/empresas">Empresas</Link>; o CPF de cada usuário, em <Link to="/admin/usuarios">Usuários</Link>. O
          AFD de cada empresa sai em Exportar dados.
        </p>
      </section>

      <section className="cartao">
        <h2>
          <KeyRound size={18} aria-hidden /> Certificado digital do desenvolvedor
        </h2>
        {certificado ? (
          <dl className="lista-dados">
            <dt>Titular</dt>
            <dd>
              {certificado.titular}
              {certificado.documento && ` · ${certificado.documento}`}
            </dd>
            <dt>Emissor</dt>
            <dd>
              {certificado.emissor} {certificado.icpBrasil ? '(ICP-Brasil)' : '(não é ICP-Brasil)'}
            </dd>
            <dt>Válido até</dt>
            <dd>{certificado.validoAte ? formatarDataHora(certificado.validoAte.toDate(), 'America/Sao_Paulo') : '—'}</dd>
          </dl>
        ) : (
          <p className="texto-suave">Nenhum certificado enviado: o AFD e os comprovantes saem sem assinatura.</p>
        )}
        <form onSubmit={enviarCertificado} className="formulario">
          <div className="grade-2">
            <Campo rotulo={certificado ? 'Trocar por outro certificado (.pfx ou .p12)' : 'Arquivo do certificado A1 (.pfx ou .p12)'}>
              <input type="file" accept=".pfx,.p12,application/x-pkcs12" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
            </Campo>
            <Campo rotulo="Senha do certificado">
              <input type="password" value={senhaCertificado} onChange={(e) => setSenhaCertificado(e.target.value)} autoComplete="off" />
            </Campo>
          </div>
          {erroCertificado && <Aviso tipo="erro">{erroCertificado}</Aviso>}
          <div className="acoes-detalhe">
            {certificado && (
              <button type="button" className="botao perigo-suave" onClick={() => void removerCertificado()}>
                Remover certificado
              </button>
            )}
            <button type="submit" className="botao primario" disabled={enviando}>
              {enviando ? 'Enviando...' : 'Enviar certificado'}
            </button>
          </div>
          <p className="texto-suave">
            Use o certificado A1 (arquivo) da ICP-Brasil do desenvolvedor: o A3 (token ou cartão) não serve para assinar sozinho. O arquivo e
            a senha ficam guardados no servidor, num lugar que nenhum navegador lê; aqui aparecem só o titular e a validade.
          </p>
        </form>
      </section>

      <section className="cartao">
        <h2>Programa e desenvolvedor</h2>
        {!dados ? (
          erro ? <Aviso tipo="erro">{erro}</Aviso> : <Carregando />
        ) : (
          <form onSubmit={salvar} className="formulario">
            <Campo rotulo="Número do registro do programa no INPI" ajuda="Só os números, como no certificado de registro (até 17 dígitos).">
              <input value={dados.inpi} onChange={(e) => mudar('inpi')(e.target.value)} inputMode="numeric" maxLength={40} />
            </Campo>
            <div className="grade-2">
              <Campo rotulo="CNPJ ou CPF do desenvolvedor">
                <input value={dados.documento} onChange={(e) => mudar('documento')(e.target.value.toUpperCase())} maxLength={18} />
              </Campo>
              <Campo rotulo="Nome ou razão social do desenvolvedor">
                <input value={dados.nome} onChange={(e) => mudar('nome')(e.target.value)} maxLength={150} />
              </Campo>
              <Campo rotulo="E-mail do desenvolvedor" ajuda="Vai no AEJ (até 50 caracteres).">
                <input type="email" value={dados.email} onChange={(e) => mudar('email')(e.target.value)} maxLength={50} />
              </Campo>
              <Campo rotulo="Nome e versão do programa" ajuda="Programa de tratamento de registro de ponto (AEJ).">
                <div className="grade-2">
                  <input value={dados.programaNome} onChange={(e) => mudar('programaNome')(e.target.value)} maxLength={150} />
                  <input value={dados.programaVersao} onChange={(e) => mudar('programaVersao')(e.target.value)} maxLength={8} />
                </div>
              </Campo>
            </div>
            {erro && <Aviso tipo="erro">{erro}</Aviso>}
            <button type="submit" className="botao primario" disabled={salvando}>
              {salvando ? 'Salvando...' : 'Salvar'}
            </button>
          </form>
        )}
      </section>
    </>
  )
}
