// Gera um identificador aleatório. crypto.randomUUID só existe em HTTPS,
// então usamos getRandomValues, disponível em qualquer contexto.
export function gerarId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * JSON com as chaves em ordem alfabética. Serve para comparar objetos vindos do
 * Firestore (que não preserva a ordem das chaves) com objetos montados na tela.
 */
export function jsonEstavel(valor: unknown): string {
  return JSON.stringify(valor, (_chave, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  )
}

// localStorage pode falhar (modo privado, armazenamento bloqueado): nunca quebra a tela.
export function lerLocal(chave: string): string | null {
  try {
    return localStorage.getItem(chave)
  } catch {
    return null
  }
}

export function gravarLocal(chave: string, valor: string | null): void {
  try {
    if (valor === null) localStorage.removeItem(chave)
    else localStorage.setItem(chave, valor)
  } catch {
    // sem armazenamento local: segue sem lembrar a preferência
  }
}
