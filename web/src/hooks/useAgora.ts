import { useEffect, useState } from 'react'

/** Atualiza o componente periodicamente (relógios, "há 5 min"). */
export function useAgora(intervaloMs = 1000): number {
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), intervaloMs)
    return () => clearInterval(id)
  }, [intervaloMs])
  return agora
}
