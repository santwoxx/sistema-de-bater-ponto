// Exportação CSV no padrão do Excel brasileiro: separador ";" e BOM UTF-8
// (para acentos aparecerem corretamente).

function celula(valor: string | number | null | undefined): string {
  let texto = String(valor ?? '')
  // Evita que texto livre seja interpretado como fórmula pelo Excel.
  if (/^[=+\-@\t\r]/.test(texto) && !/^[-+]?\d[\d:.,]*$/.test(texto)) texto = `'${texto}`
  return /[";\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto
}

export function gerarCsv(linhas: Array<Array<string | number | null | undefined>>): string {
  return linhas.map((linha) => linha.map(celula).join(';')).join('\r\n')
}

export function baixarCsv(nomeArquivo: string, linhas: Array<Array<string | number | null | undefined>>): void {
  const blob = new Blob(['﻿', gerarCsv(linhas)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = nomeArquivo
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
