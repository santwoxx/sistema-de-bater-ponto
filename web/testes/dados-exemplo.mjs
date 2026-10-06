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

const SENHA = 'senha1234'
await chamar('configurarPrimeiroAdmin', { nome: 'Administrador', email: 'admin@teste.com', senha: SENHA })
await signInWithEmailAndPassword(auth, 'admin@teste.com', SENHA)

const regras = { fusoHorario: 'America/Sao_Paulo', intervaloMinimoMinutos: 2, toleranciaMinutos: 10, ativo: true }
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
for (const f of equipe) {
  await chamar('salvarFuncionario', { ...f, admissao: null, jornada: JORNADA_44H, ativo: true })
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
Dados de exemplo criados.

  Logins (senha ${SENHA}):
    admin@teste.com    administrador, vê todas as empresas
    gestora@teste.com  gestora, vê só a Loja Centro

  Funcionários para bater o ponto:
    Loja Centro          matrícula 1 / PIN 2580 (Maria)
                         matrícula 2 / PIN 1357 (João)
                         matrícula 3 / PIN 2468 (Ana)
    Loja Shopping Norte  matrícula 1 / PIN 4826 (Pedro)
`)
process.exit(0)
