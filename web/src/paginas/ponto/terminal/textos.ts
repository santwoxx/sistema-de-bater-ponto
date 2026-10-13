import type { Etapa } from './tipos'

// Textos da tela do aparelho para cada momento (funções puras, testadas em textos.test.ts).

/** O servidor recusou o PIN. */
export const PIN_INCORRETO = 'PIN incorreto. Confira o seu PIN e tente de novo.'

/** "ELIANA MOREIRA DOS SANTOS" → "Eliana". */
export function primeiroNome(nome: string): string {
  const primeiro = nome.trim().split(/\s+/)[0] ?? ''
  return primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase()
}

/** nomeDono: celular pessoal (a tela cumprimenta o dono). */
export function tituloDaTela(etapa: Etapa, nomeDono: string | null): string {
  if (etapa === 'foto') return 'Olhe para a câmera'
  if (etapa === 'enviando') return 'Registrando...'
  return nomeDono ? `Olá, ${primeiroNome(nomeDono)}! Digite seu PIN` : 'Digite seu PIN'
}

export function instrucaoDaTela(etapa: Etapa): string {
  if (etapa === 'foto' || etapa === 'enviando') return 'Fique parado, olhando para a câmera.'
  return 'Ao confirmar, olhe para a câmera: a foto é tirada automaticamente.'
}
