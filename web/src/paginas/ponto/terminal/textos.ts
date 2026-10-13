import type { Etapa } from './tipos'

// Textos da tela do aparelho para cada momento (funções puras, testadas em textos.test.ts).

/** O servidor recusou o PIN. */
export const PIN_INCORRETO = 'PIN incorreto. Confira o seu PIN e tente de novo.'

// No meio do nome, a descrição jurídica ("COMÉRCIO E IMPORTADORA DE PNEUS LTDA") e o tipo de sociedade.
const DESCRICAO_JURIDICA = /^(com[eé]rcio|ind[uú]stria|importadora|exportadora|distribuidora|servi[cç]os)$/iu
const SUFIXO_JURIDICO = /^(ltda\.?|me|epp|eireli|s\/a|s\.a\.|sa|e|de|da|do|-)$/iu

/**
 * Nome curto de uma empresa, para o topo do aparelho que atende várias:
 * "CENTRAL PNEUS COMÉRCIO E IMPORTADORA DE PNEUS LTDA" → "CENTRAL PNEUS".
 */
export function nomeCurto(nome: string): string {
  const palavras = nome.trim().split(/\s+/)
  const corte = palavras.findIndex((palavra, i) => i > 0 && DESCRICAO_JURIDICA.test(palavra))
  const curtas = corte > 0 ? palavras.slice(0, corte) : palavras
  while (curtas.length > 1 && SUFIXO_JURIDICO.test(curtas[curtas.length - 1])) curtas.pop()
  return curtas.join(' ') || nome.trim()
}

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
