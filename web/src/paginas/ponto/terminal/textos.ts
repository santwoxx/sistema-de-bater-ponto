import type { Etapa } from './tipos'

// Textos da tela do aparelho para cada momento (funções puras, testadas em textos.test.ts).

export interface EstadoTexto {
  etapa: Etapa
  /** Salvando o PIN pessoal no servidor. */
  salvandoPin: boolean
  /** Problema com o PIN novo digitado (ex.: sequência). */
  erroPin: string
  /** Celular pessoal: nome do dono (a tela pede só o PIN dele). */
  nomeDono?: string | null
}

/** "ELIANA MOREIRA DOS SANTOS" → "Eliana". */
export function primeiroNome(nome: string): string {
  const primeiro = nome.trim().split(/\s+/)[0] ?? ''
  return primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase()
}

/**
 * Matrícula ou PIN recusados. O servidor dá a mesma resposta para os dois (para
 * ninguém descobrir quais matrículas existem); a tela mostra o que foi digitado
 * e lembra o que é a matrícula. No celular pessoal, a matrícula é a do dono.
 */
export function mensagemCredenciais(matricula: string, pessoal: boolean): string {
  if (pessoal) return 'PIN incorreto. Confira o seu PIN e tente de novo.'
  return `Matrícula ${matricula} ou PIN inválidos. A matrícula é o número que o gestor cadastrou para você (não é o CPF nem o telefone). Confira também o PIN.`
}

export function textoDeEspera(salvandoPin: boolean): string {
  return salvandoPin ? 'Salvando seu PIN...' : 'Registrando...'
}

export function tituloDaTela({ etapa, salvandoPin, nomeDono }: EstadoTexto): string {
  if (etapa === 'novoPin') return 'Crie seu PIN pessoal'
  if (etapa === 'confirmarPin') return 'Digite o novo PIN de novo'
  if (etapa === 'pin') return nomeDono ? `Olá, ${primeiroNome(nomeDono)}! Digite seu PIN` : 'Digite seu PIN'
  if (etapa === 'foto') return 'Olhe para a câmera'
  if (etapa === 'enviando') return textoDeEspera(salvandoPin)
  return 'Digite sua matrícula'
}

export function instrucaoDaTela({ etapa, salvandoPin, erroPin }: EstadoTexto): string {
  if (etapa === 'novoPin' || etapa === 'confirmarPin') {
    if (erroPin) return erroPin
    if (etapa === 'confirmarPin') return 'Confirme digitando o mesmo PIN.'
    return 'Primeiro acesso: o PIN que você recebeu é provisório. Escolha um de 4 a 6 números que só você saiba.'
  }
  if (etapa === 'pin') return 'Ao confirmar, olhe para a câmera: a foto é tirada automaticamente.'
  if (etapa === 'foto' || etapa === 'enviando') return salvandoPin ? 'Aguarde um instante.' : 'Fique parado, olhando para a câmera.'
  return 'Matrícula, depois o PIN.'
}
