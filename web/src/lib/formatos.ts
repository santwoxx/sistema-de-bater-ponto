export function somenteDigitos(valor: string): string {
  return valor.replace(/\D/g, '')
}

export function formatarCpf(cpf: string): string {
  const d = somenteDigitos(cpf)
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : cpf
}

/** Mostra só os 3 primeiros e os 2 últimos dígitos (LGPD: exibir o mínimo necessário). */
export function mascararCpf(cpf: string): string {
  const d = somenteDigitos(cpf)
  return d.length === 11 ? `${d.slice(0, 3)}.***.***-${d.slice(9)}` : cpf
}

export function formatarCnpj(cnpj: string): string {
  const c = cnpj.toUpperCase().replace(/[^0-9A-Z]/g, '')
  return c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : cnpj
}

export function cpfValido(cpf: string): boolean {
  const d = somenteDigitos(cpf)
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false
  const digito = (tamanho: number) => {
    let soma = 0
    for (let i = 0; i < tamanho; i++) soma += Number(d[i]) * (tamanho + 1 - i)
    const resto = (soma * 10) % 11
    return resto === 10 ? 0 : resto
  }
  return digito(9) === Number(d[9]) && digito(10) === Number(d[10])
}

export function cnpjValido(cnpj: string): boolean {
  const c = cnpj.toUpperCase().replace(/[^0-9A-Z]/g, '')
  if (!/^[0-9A-Z]{12}\d{2}$/.test(c) || /^(.)\1{13}$/.test(c)) return false
  const digito = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    let soma = 0
    for (let i = 0; i < base.length; i++) soma += (base.charCodeAt(i) - 48) * pesos[i]
    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
  }
  const d1 = digito(c.slice(0, 12))
  return d1 === Number(c[12]) && digito(c.slice(0, 12) + d1) === Number(c[13])
}

/** Para buscas: minúsculas e sem acentos ("João" encontra "joao"). */
export function normalizarBusca(texto: string): string {
  return texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
}

export function formatarNsr(nsr: number | undefined): string {
  return nsr === undefined ? '—' : String(nsr).padStart(9, '0')
}
