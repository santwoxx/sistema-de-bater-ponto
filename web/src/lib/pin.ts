// PIN do ponto: 4 números, definido pelo gestor. No aparelho da loja, o
// funcionário digita o CPF e o PIN; no celular pessoal, só o PIN. Mesma regra
// do servidor (functions/src/validacao.ts), para avisar na hora, antes de enviar.

export const TAMANHO_PIN = 4

export function pinTrivial(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true
  return '01234567890123456789'.includes(pin) || '98765432109876543210'.includes(pin)
}

/** Mensagem de erro para um PIN novo, ou null se ele pode ser usado. */
export function problemaNoPin(pin: string): string | null {
  if (!/^\d{4}$/.test(pin)) return 'O PIN deve ter 4 números.'
  if (pinTrivial(pin)) return 'Muito fácil de adivinhar: evite sequências (1234) e números repetidos (1111).'
  return null
}

/** PIN aleatório que não seja óbvio. */
export function gerarPin(): string {
  for (;;) {
    const [sorteado] = globalThis.crypto.getRandomValues(new Uint32Array(1))
    const pin = String(sorteado % 10_000).padStart(TAMANHO_PIN, '0')
    if (!pinTrivial(pin)) return pin
  }
}
