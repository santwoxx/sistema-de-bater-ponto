import { Building2, Check, ChevronDown, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useEmpresas } from '../contexto/Empresa'
import { formatarCnpj, normalizarBusca } from '../lib/formatos'

// Seletor de empresa no topo do painel, com busca por nome ou CNPJ.
export default function SeletorEmpresa() {
  const { empresas, empresa, selecionar } = useEmpresas()
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')
  const raiz = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      if (!raiz.current?.contains(e.target as Node)) setAberto(false)
    }
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberto(false)
    }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', tecla)
    }
  }, [aberto])

  const termo = normalizarBusca(busca)
  const termoDigitos = busca.replace(/[^0-9A-Za-z]/g, '').toUpperCase()
  const filtradas = empresas.filter(
    (e) => !termo || normalizarBusca(e.nome).includes(termo) || (termoDigitos.length >= 2 && e.cnpj.includes(termoDigitos)),
  )

  return (
    <div className="seletor-empresa" ref={raiz}>
      <button
        type="button"
        className="seletor-empresa-botao"
        onClick={() => {
          setAberto(!aberto)
          setBusca('')
        }}
        aria-expanded={aberto}
      >
        <Building2 size={18} aria-hidden />
        <span className="seletor-empresa-texto">
          <strong>{empresa?.nome ?? 'Selecione a empresa'}</strong>
          {empresa?.cnpj && <small>{formatarCnpj(empresa.cnpj)}</small>}
        </span>
        <ChevronDown size={16} aria-hidden />
      </button>

      {aberto && (
        <div className="seletor-empresa-painel">
          <div className="busca">
            <Search size={16} aria-hidden />
            <input autoFocus placeholder="Buscar por nome ou CNPJ" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <ul>
            {filtradas.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  className={e.id === empresa?.id ? 'selecionada' : ''}
                  onClick={() => {
                    selecionar(e.id)
                    setAberto(false)
                  }}
                >
                  <span>
                    <strong>{e.nome}</strong>
                    <small>
                      {e.cnpj ? formatarCnpj(e.cnpj) : 'Sem CNPJ'}
                      {!e.ativo && ' · inativa'}
                    </small>
                  </span>
                  {e.id === empresa?.id && <Check size={16} aria-hidden />}
                </button>
              </li>
            ))}
            {filtradas.length === 0 && <li className="seletor-empresa-vazio">Nenhuma empresa encontrada.</li>}
          </ul>
        </div>
      )}
    </div>
  )
}
