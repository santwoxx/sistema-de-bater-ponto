import { Download, FileCheck2, Fingerprint } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { api, type ListaDeComprovantes } from '../api'
import { Aviso, Campo } from '../componentes/Basicos'
import { NOME_SISTEMA } from '../firebase'
import { mensagemErro } from '../lib/erros'
import { cpfValido, formatarCpf, formatarNsr, somenteDigitos } from '../lib/formatos'
import { formatarData } from '../lib/tempo'

// Comprovantes do trabalhador (Portaria 671, art. 80): com o CPF e o PIN que
// usa no ponto, o funcionário vê as marcações dos últimos dias e baixa o
// comprovante de cada uma (PDF assinado pelo sistema). Nada fica guardado no
// navegador: CPF e PIN ficam só na memória desta tela.

/** Baixa o PDF que veio em base64. */
function baixarPdf(nome: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  const link = document.createElement('a')
  link.href = url
  link.download = nome
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function Comprovantes() {
  const [cpf, setCpf] = useState('')
  const [pin, setPin] = useState('')
  const [lista, setLista] = useState<ListaDeComprovantes | null>(null)
  const [baixando, setBaixando] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')

  async function entrar(e: FormEvent) {
    e.preventDefault()
    setErro('')
    if (!cpfValido(cpf)) return setErro('CPF inválido: confira os números.')
    if (!/^\d{4}$/.test(pin)) return setErro('O PIN tem 4 números.')
    setOcupado(true)
    try {
      setLista((await api.comprovantes({ cpf: somenteDigitos(cpf), pin })) as ListaDeComprovantes)
    } catch (err) {
      setErro(mensagemErro(err))
    } finally {
      setOcupado(false)
    }
  }

  async function baixar(registroId: string) {
    setErro('')
    setBaixando(registroId)
    try {
      const arquivo = (await api.comprovantes({ cpf: somenteDigitos(cpf), pin, registroId })) as { nome: string; pdf: string }
      baixarPdf(arquivo.nome, arquivo.pdf)
    } catch (err) {
      setErro(mensagemErro(err))
    } finally {
      setBaixando(null)
    }
  }

  function sair() {
    setLista(null)
    setCpf('')
    setPin('')
    setErro('')
  }

  return (
    <div className="tela-acesso">
      <div className="cartao-acesso comprovantes">
        <div className="marca-acesso">
          <Fingerprint size={36} aria-hidden />
          <h1>{NOME_SISTEMA}</h1>
          <p>Comprovantes de registro de ponto</p>
        </div>

        {!lista ? (
          <form onSubmit={entrar} className="formulario">
            <p className="texto-suave">
              Informe seu CPF e o PIN que você usa no ponto. Você vê as marcações feitas no aparelho nos últimos dias e baixa o comprovante
              de cada uma.
            </p>
            <Campo rotulo="CPF">
              <input value={cpf} onChange={(e) => setCpf(e.target.value)} inputMode="numeric" placeholder="000.000.000-00" maxLength={14} autoFocus />
            </Campo>
            <Campo rotulo="PIN">
              <input
                type="password"
                value={pin}
                onChange={(e) => setPin(somenteDigitos(e.target.value).slice(0, 4))}
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
              />
            </Campo>
            {erro && <Aviso tipo="erro">{erro}</Aviso>}
            <button type="submit" className="botao primario grande" disabled={ocupado}>
              {ocupado ? 'Conferindo...' : 'Ver meus comprovantes'}
            </button>
          </form>
        ) : (
          <div className="formulario">
            <p>
              <strong>{lista.trabalhador}</strong>
              <br />
              <span className="texto-suave">
                {lista.empresa} · CPF {formatarCpf(somenteDigitos(cpf))}
              </span>
            </p>
            {lista.comprovantes.length === 0 ? (
              <p className="texto-suave">Nenhuma marcação no aparelho nos últimos {lista.dias} dias.</p>
            ) : (
              <ul className="lista-comprovantes">
                {lista.comprovantes.map((c) => (
                  <li key={c.registroId}>
                    <span>
                      <FileCheck2 size={16} aria-hidden /> {formatarData(c.dataLocal)} às {c.horaLocal}
                      <small className="bloco">NSR {formatarNsr(c.nsr)}</small>
                    </span>
                    <button type="button" className="botao pequeno" onClick={() => void baixar(c.registroId)} disabled={baixando !== null}>
                      <Download size={14} aria-hidden /> {baixando === c.registroId ? 'Gerando...' : 'Baixar PDF'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {erro && <Aviso tipo="erro">{erro}</Aviso>}
            <button type="button" className="botao" onClick={sair}>
              Sair
            </button>
          </div>
        )}
        <div className="links-acesso">
          <Link to="/login">Acesso do gestor</Link>
        </div>
      </div>
    </div>
  )
}
