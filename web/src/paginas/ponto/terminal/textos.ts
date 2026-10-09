import type { Etapa } from './tipos'

// Textos da tela do aparelho para cada momento (funções puras, testadas em textos.test.ts).

export const TAMANHO_CPF = 11

/** O servidor recusou: no celular pessoal só pode ser o PIN; no aparelho da loja, o CPF ou o PIN. */
export function mensagemRecusa(pessoal: boolean): string {
  return pessoal ? 'PIN incorreto. Confira o seu PIN e tente de novo.' : 'CPF ou PIN incorretos. Confira e tente de novo.'
}

/** "ELIANA MOREIRA DOS SANTOS" → "Eliana". */
export function primeiroNome(nome: string): string {
  const primeiro = nome.trim().split(/\s+/)[0] ?? ''
  return primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase()
}

/** CPF formatado enquanto é digitado: "5299822" → "529.982.2". */
export function cpfNoVisor(digitos: string): string {
  const blocos = [digitos.slice(0, 3), digitos.slice(3, 6), digitos.slice(6, 9)].filter(Boolean).join('.')
  return digitos.length > 9 ? `${blocos}-${digitos.slice(9)}` : blocos
}

/** nomeDono: celular pessoal (a tela cumprimenta o dono e pede só o PIN). */
export function tituloDaTela(etapa: Etapa, nomeDono: string | null): string {
  if (etapa === 'cpf') return 'Digite seu CPF'
  if (etapa === 'foto') return 'Olhe para a câmera'
  if (etapa === 'enviando') return 'Registrando...'
  return nomeDono ? `Olá, ${primeiroNome(nomeDono)}! Digite seu PIN` : 'Digite seu PIN'
}

export function instrucaoDaTela(etapa: Etapa): string {
  if (etapa === 'cpf') return 'Só os números do CPF. Depois, o PIN de 4 números.'
  if (etapa === 'foto' || etapa === 'enviando') return 'Fique parado, olhando para a câmera.'
  return 'Ao confirmar, olhe para a câmera: a foto é tirada automaticamente.'
}
