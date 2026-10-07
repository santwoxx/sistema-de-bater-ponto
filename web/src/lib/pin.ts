// Mesma regra do servidor (functions/src/validacao.ts), para avisar na hora,
// no teclado do aparelho, antes de enviar.

export function pinTrivial(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true
  return '01234567890123456789'.includes(pin) || '98765432109876543210'.includes(pin)
}

/** Mensagem de erro para um PIN novo, ou null se ele pode ser usado. */
export function problemaNoPin(pin: string): string | null {
  if (!/^\d{4,6}$/.test(pin)) return 'O PIN deve ter de 4 a 6 números.'
  if (pinTrivial(pin)) return 'Muito fácil de adivinhar: evite sequências (1234) e números repetidos (1111).'
  return null
}
