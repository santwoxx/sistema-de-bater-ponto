import { CircleAlert, CircleCheck, Info } from 'lucide-react'
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

type Tipo = 'sucesso' | 'erro' | 'info'
type Notificar = (texto: string, tipo?: Tipo) => void

const Contexto = createContext<Notificar>(() => undefined)
const ICONES = { sucesso: CircleCheck, erro: CircleAlert, info: Info }
let proximoId = 1

export function NotificacoesProvider({ children }: { children: ReactNode }) {
  const [lista, setLista] = useState<Array<{ id: number; texto: string; tipo: Tipo }>>([])

  const notificar = useCallback<Notificar>((texto, tipo = 'sucesso') => {
    const id = proximoId++
    setLista((atual) => [...atual.slice(-3), { id, texto, tipo }])
    setTimeout(() => setLista((atual) => atual.filter((n) => n.id !== id)), tipo === 'erro' ? 7000 : 4000)
  }, [])

  return (
    <Contexto.Provider value={notificar}>
      {children}
      <div className="notificacoes" aria-live="polite">
        {lista.map((n) => {
          const Icone = ICONES[n.tipo]
          return (
            <div key={n.id} className={`notificacao notificacao-${n.tipo}`}>
              <Icone size={18} aria-hidden />
              <span>{n.texto}</span>
            </div>
          )
        })}
      </div>
    </Contexto.Provider>
  )
}

export function useNotificar(): Notificar {
  return useContext(Contexto)
}
