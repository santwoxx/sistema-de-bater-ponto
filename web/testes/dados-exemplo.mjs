// Cria dados de exemplo nos emuladores locais, para testar o sistema na mão.
// Com os emuladores ligados, na pasta "web":  npm run dados:exemplo

import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth'
import { connectFirestoreEmulator, doc, getDoc, getFirestore } from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions'

const app = initializeApp({ apiKey: 'demo-chave', projectId: 'demo-ponto', appId: 'demo-app' })
const auth = getAuth(app)
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
const db = getFirestore(app)
connectFirestoreEmulator(db, '127.0.0.1', 8080)
const functions = getFunctions(app, 'southamerica-east1')
connectFunctionsEmulator(functions, '127.0.0.1', 5001)
const chamar = async (nome, dados) => (await httpsCallable(functions, nome)(dados)).data

// Gera um CPF válido a partir de 9 dígitos.
function cpf(base) {
  const d = [...base].map(Number)
  const digito = (tamanho) => {
    let soma = 0
    for (let i = 0; i < tamanho; i++) soma += d[i] * (tamanho + 1 - i)
    const resto = (soma * 10) % 11
    return resto === 10 ? 0 : resto
  }
  d.push(digito(9))
  d.push(digito(10))
  return d.join('')
}

if ((await getDoc(doc(db, 'sistema', 'estado'))).exists()) {
  console.log('Os emuladores já têm dados: nada foi criado.')
  process.exit(0)
}

const SENHA = 'ponto-teste-2026'
// Código de instalação dos emuladores (functions/.env.demo-ponto).
await chamar('configurarPrimeiroAdmin', { nome: 'Administrador', email: 'admin@teste.com', senha: SENHA, codigo: 'TESTE-LOCAL' })
await signInWithEmailAndPassword(auth, 'admin@teste.com', SENHA)

// O histórico de exemplo começa no mês anterior, para dar o que fechar e imprimir.
const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
const [anoAtual, mesAtualNumero] = hoje.split('-').map(Number)
const mesAnterior = new Date(Date.UTC(anoAtual, mesAtualNumero - 2, 1)).toISOString().slice(0, 7)

const regras = {
  fusoHorario: 'America/Sao_Paulo',
  intervaloMinimoMinutos: 2,
  toleranciaMinutos: 10,
  inicioControle: `${mesAnterior}-01`,
  ativo: true,
}
const centro = (await chamar('salvarEmpresa', { ...regras, nome: 'Loja Centro', cnpj: '11.222.333/0001-81' })).id
const shopping = (await chamar('salvarEmpresa', { ...regras, nome: 'Loja Shopping Norte', cnpj: '12.ABC.345/01DE-35' })).id

await chamar('salvarUsuario', {
  nome: 'Gestora Exemplo',
  email: 'gestora@teste.com',
  senha: SENHA,
  papel: 'gestor',
  empresas: [centro],
  ativo: true,
})

const JORNADA_44H = [0, 480, 480, 480, 480, 480, 240]
const equipe = [
  { empresaId: centro, nome: 'Maria Souza', cpf: cpf('529982247'), matricula: '1', cargo: 'Vendedora', pin: '2580' },
  { empresaId: centro, nome: 'João Lima', cpf: cpf('111444777'), matricula: '2', cargo: 'Caixa', pin: '1357' },
  { empresaId: centro, nome: 'Ana Pereira', cpf: cpf('987654321'), matricula: '3', cargo: 'Gerente', pin: '2468' },
  { empresaId: shopping, nome: 'Pedro Alves', cpf: cpf('246813579'), matricula: '1', cargo: 'Vendedor', pin: '4826' },
]
const ids = {}
for (const f of equipe) {
  ids[f.nome] = (await chamar('salvarFuncionario', { ...f, admissao: null, jornada: JORNADA_44H, ativo: true })).id
}

// Mês anterior da Loja Centro: semana com 8h, sábado com 4h, pequenas variações,
// uma falta da Maria e uma saída esquecida do João (para aparecer no espelho).
const diasDoMesAnterior = []
for (let d = new Date(`${mesAnterior}-01T12:00:00Z`); d.toISOString().startsWith(mesAnterior); d.setUTCDate(d.getUTCDate() + 1)) {
  diasDoMesAnterior.push({ data: d.toISOString().slice(0, 10), semana: d.getUTCDay() })
}
const variacao = (dia, deslocamento) => String(((Number(dia.slice(8)) * 7 + deslocamento) % 9) + 1).padStart(2, '0')
let incluidas = 0
for (const nome of ['Maria Souza', 'João Lima', 'Ana Pereira']) {
  for (const { data, semana } of diasDoMesAnterior) {
    if (semana === 0) continue
    if (nome === 'Maria Souza' && data.endsWith('-12')) continue
    const horas =
      semana === 6
        ? [`08:${variacao(data, 1)}`, `12:${variacao(data, 2)}`]
        : [`07:5${variacao(data, 3).slice(1)}`, `12:0${variacao(data, 4).slice(1)}`, `13:0${variacao(data, 5).slice(1)}`, `17:${variacao(data, 6)}`]
    const doDia = nome === 'João Lima' && data.endsWith('-18') ? horas.slice(0, 3) : horas
    for (const hora of doDia) {
      await chamar('incluirMarcacao', {
        empresaId: centro,
        funcionarioId: ids[nome],
        data,
        hora,
        justificativa: 'Histórico de exemplo',
      })
      incluidas++
    }
  }
}

for (const empresaId of [centro, shopping]) {
  await chamar('incluirAbono', {
    empresaId,
    funcionarioId: null,
    tipo: 'feriado',
    descricao: 'Nossa Senhora Aparecida',
    de: '2026-10-12',
    ate: '2026-10-12',
    minutos: null,
  })
}

console.log(`
Dados de exemplo criados (${incluidas} marcações de histórico em ${mesAnterior}, pronto para fechar).

  Logins (senha ${SENHA}):
    admin@teste.com    administrador, vê todas as empresas
    gestora@teste.com  gestora, vê só a Loja Centro

  Funcionários (no aparelho da loja: CPF + PIN; no celular pessoal, só o PIN):
${equipe.map((f) => `    ${f.nome.padEnd(12)} CPF ${f.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')}  PIN ${f.pin}`).join('\n')}
`)
process.exit(0)
