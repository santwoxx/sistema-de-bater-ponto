// Auditoria das dependências do backend (roda no CI): falha se houver
// vulnerabilidade alta ou crítica, menos as listadas em ACEITAS, cada uma com o
// motivo de não se aplicar a este sistema. Uso: node scripts/auditar-dependencias.mjs
import { execSync } from 'node:child_process'

const ACEITAS = {
  // node-forge: a falha está na CONFERÊNCIA de assinaturas RSA PKCS#1 v1.5 feita
  // pelo próprio node-forge. O sistema usa o node-forge só para abrir o
  // certificado A1 (.pfx) e montar a estrutura CMS; quem assina é o crypto do
  // Node, e nada é conferido com o node-forge. Sem versão corrigida (10/2026).
  'GHSA-86w9-cpqp-85rv': 'node-forge: conferência de assinatura RSA, que o sistema não usa',
}

let saida
try {
  saida = execSync('npm audit --prefix functions --omit=dev --json', { encoding: 'utf8' })
} catch (erro) {
  // O npm audit sai com erro quando encontra algo; o relatório vem do mesmo jeito.
  saida = erro.stdout
}
const relatorio = JSON.parse(saida)

const problemas = []
const ignoradas = new Set()
for (const [pacote, vulnerabilidade] of Object.entries(relatorio.vulnerabilities ?? {})) {
  for (const via of vulnerabilidade.via) {
    // Texto = só aponta outro pacote vulnerável (que é avaliado por conta própria).
    if (typeof via !== 'object' || !['high', 'critical'].includes(via.severity)) continue
    const id = String(via.url ?? '').split('/').pop()
    if (ACEITAS[id]) ignoradas.add(`${id} (${ACEITAS[id]})`)
    else problemas.push(`${pacote}: ${via.title} [${via.severity}] ${via.url}`)
  }
}

for (const ignorada of ignoradas) console.log(`Aceita, não se aplica: ${ignorada}`)
if (problemas.length > 0) {
  console.error(`Vulnerabilidades altas ou críticas nas dependências do backend:\n- ${problemas.join('\n- ')}`)
  process.exit(1)
}
console.log('Dependências do backend sem vulnerabilidades altas ou críticas (fora as aceitas acima).')
