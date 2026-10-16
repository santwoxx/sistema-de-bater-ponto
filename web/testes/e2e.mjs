// Teste de ponta a ponta contra os emuladores do Firebase (nada vai para a nuvem).
// Exige Java 21+ e o Firebase CLI. Na pasta "web":  npm run test:e2e

import assert from 'node:assert/strict'
import { createHash, createHmac, createPublicKey, generateKeyPairSync, randomBytes, verify } from 'node:crypto'
import { createRequire } from 'node:module'
import { initializeApp } from 'firebase/app'
import {
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  linkWithCredential,
  signInWithCredential,
  signInWithEmailAndPassword,
} from 'firebase/auth'
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  setDoc,
  Timestamp,
  where,
} from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions'
import { connectStorageEmulator, getBytes, getStorage, ref } from 'firebase/storage'

const PROJETO = process.env.GCLOUD_PROJECT || 'demo-ponto'
const config = { apiKey: 'demo-chave', projectId: PROJETO, storageBucket: `${PROJETO}.appspot.com`, appId: 'demo-app' }
// Código de instalação dos emuladores (functions/.env.demo-ponto).
const CODIGO_INSTALACAO = 'TESTE-LOCAL'
// No aparelho, só o PIN de 4 números (definido pelo gestor, um diferente para cada funcionário).
const CPF_MARIA = '52998224725'
const CPF_JOAO = '11144477735'
const PIN_MARIA = '2580'
const PIN_JOAO_INICIAL = '1357'
// O gestor troca o PIN do João no meio do teste ("esqueceu o PIN").
const PIN_JOAO = '8642'
// Funcionário da outra empresa (Loja Shopping), para o aparelho que atende as duas.
const PIN_FULANO = '6173'

// Ações rápidas do painel: passam pela função "painel" (functions/src/painel.ts).
const ACOES_DO_PAINEL = new Set([
  'salvarEmpresa',
  'salvarUsuario',
  'salvarFuncionario',
  'salvarEscala',
  'removerEscala',
  'associarEscala',
  'ativarDispositivo',
  'salvarDispositivo',
  'desativarDispositivo',
  'obterFoto',
  'incluirMarcacao',
  'desconsiderarMarcacao',
  'apagarMarcacao',
  'salvarConfiguracaoRep',
  'salvarCertificado',
  'removerCertificado',
  'incluirAbono',
  'removerAbono',
  'criarSolicitacao',
  'decidirSolicitacao',
])

let total = 0
async function etapa(nome, fn) {
  total++
  process.stdout.write(`  ${String(total).padStart(2, '0')}. ${nome} ... `)
  await fn()
  console.log('ok')
}

function cliente(nome) {
  const app = initializeApp(config, nome)
  const auth = getAuth(app)
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  const db = getFirestore(app)
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  const functions = getFunctions(app, 'southamerica-east1')
  connectFunctionsEmulator(functions, '127.0.0.1', 5001)
  const storage = getStorage(app)
  connectStorageEmulator(storage, '127.0.0.1', 9199)
  const chamarFuncao = async (funcao, dados = {}) => (await httpsCallable(functions, funcao)(dados)).data
  const chamar = (funcao, dados = {}) => (ACOES_DO_PAINEL.has(funcao) ? chamarFuncao('painel', { acao: funcao, dados }) : chamarFuncao(funcao, dados))
  const entrar = (email, senha) => signInWithEmailAndPassword(auth, email, senha)
  return { auth, db, storage, chamar, chamarFuncao, entrar }
}

// Altera um documento direto no emulador, sem passar pelas regras (simula alguém
// mexendo no banco pelo Console do Firebase).
async function adulterar(caminho, campo, valor) {
  const url = `http://127.0.0.1:8080/v1/projects/${PROJETO}/databases/(default)/documents/${caminho}?updateMask.fieldPaths=${campo}`
  const resposta = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { [campo]: { stringValue: valor } } }),
  })
  assert.equal(resposta.ok, true, `falha ao alterar ${caminho}: ${resposta.status}`)
}

// Lê ou muda um documento direto no emulador, sem passar pelas regras.
async function comoDono(metodo, caminho, corpo) {
  const resposta = await fetch(`http://127.0.0.1:8080/v1/projects/${PROJETO}/databases/(default)/documents/${caminho}`, {
    method: metodo,
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  assert.equal(resposta.ok, true, `${metodo} ${caminho}: ${resposta.status}`)
  return resposta.json()
}

// Último NSR da empresa: o contador fica num documento que só o servidor lê. Desde a
// Portaria 671 (ARP), a inclusão do empregador e dos empregados também tem NSR.
async function nsrAtual(empresaId) {
  return Number((await comoDono('GET', `empresas/${empresaId}/privado/controle`)).fields?.ultimoNsr?.integerValue ?? 0)
}

async function falha(promessa, codigo, trecho) {
  try {
    await promessa
  } catch (e) {
    assert.equal(e.code, codigo, `esperava ${codigo}, veio ${e.code}: ${e.message}`)
    if (trecho) assert.match(e.message, trecho)
    return e
  }
  assert.fail(`esperava falha ${codigo}, mas a operação funcionou`)
}

// Chamada a uma função que não existe mais no servidor.
async function naoExiste(promessa) {
  const e = await promessa.then(
    () => null,
    (erro) => erro,
  )
  assert.ok(e, 'a função não deveria existir mais')
  assert.equal(e.code, 'functions/not-found', `esperava functions/not-found, veio ${e.code}: ${e.message}`)
}

// "JPEG" sintético: o servidor confere a assinatura do arquivo e o tamanho.
function jpeg(tamanho) {
  return `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(tamanho)]).toString('base64')}`
}
const sha256 = (dados) => createHash('sha256').update(dados).digest('hex')
// A mesma biblioteca do servidor, para criar o certificado de teste e ler as assinaturas.
const forge = createRequire(new URL('../../functions/package.json', import.meta.url))('node-forge')
const SENHA_CERTIFICADO = 'senha-de-teste'

/** Certificado A1 de teste (autoassinado, não ICP-Brasil), em PKCS#12 como o de verdade, em base64. */
function certificadoDeTeste() {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const chave = forge.pki.privateKeyFromPem(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())
  const cert = forge.pki.createCertificate()
  cert.publicKey = forge.pki.setRsaPublicKey(chave.n, chave.e)
  cert.serialNumber = '0a1b2c'
  cert.validity.notBefore = new Date(Date.now() - 86_400_000)
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000)
  const nome = [
    { name: 'commonName', value: 'EMPRESA TESTE:11444777000161' },
    { name: 'organizationName', value: 'Teste' },
  ]
  cert.setSubject(nome)
  cert.setIssuer(nome)
  cert.sign(chave, forge.md.sha256.create())
  const p12 = forge.pkcs12.toPkcs12Asn1(chave, [cert], SENHA_CERTIFICADO, { algorithm: '3des' })
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary').toString('base64')
}

/** Confere uma assinatura CMS destacada (o resumo do conteúdo e a assinatura RSA) com o certificado que vem nela. */
function assinaturaConfere(cms, conteudo) {
  const { asn1 } = forge
  const signedData = asn1.fromDer(forge.util.createBuffer(cms.toString('binary'))).value[1].value[0]
  const partes = signedData.value
  const certificado = forge.pki.certificateFromAsn1(partes[3].value[0])
  const [, , , atributos, , assinatura] = partes[partes.length - 1].value[0].value
  const resumo = atributos.value.find((a) => asn1.derToOid(a.value[0].value) === '1.2.840.113549.1.9.4').value[1].value[0].value
  if (!Buffer.from(resumo, 'binary').equals(createHash('sha256').update(conteudo).digest())) return false
  const der = Buffer.from(asn1.toDer(atributos).getBytes(), 'binary')
  der[0] = 0x31
  const publica = createPublicKey(forge.pki.publicKeyToPem(certificado.publicKey))
  return verify('sha256', der, publica, Buffer.from(assinatura.value, 'binary'))
}

/** Arquivos de um ZIP sem compressão (o do AFD assinado). */
function lerZip(zip) {
  const arquivos = {}
  let i = 0
  while (zip.readUInt32LE(i) === 0x04034b50) {
    const tamanho = zip.readUInt32LE(i + 18)
    const nome = zip.toString('utf8', i + 30, i + 30 + zip.readUInt16LE(i + 26))
    const inicio = i + 30 + zip.readUInt16LE(i + 26) + zip.readUInt16LE(i + 28)
    arquivos[nome] = zip.subarray(inicio, inicio + tamanho)
    i = inicio + tamanho
  }
  return arquivos
}

// CRC-16/KERMIT (registros 1 a 5 do AFD), feito aqui à parte para conferir o do servidor.
function crc16(texto) {
  let crc = 0
  for (const byte of Buffer.from(texto, 'latin1')) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0x8408 : crc >>> 1
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}
const id = () => randomBytes(16).toString('hex')

function dataSaoPaulo(deslocamentoDias = 0) {
  const d = new Date(Date.now() + deslocamentoDias * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d)
}

const JORNADA = [0, 480, 480, 480, 480, 480, 240]

console.log(`\nTeste de ponta a ponta (projeto ${PROJETO})\n`)

const anonimo = cliente('anonimo')
const admin = cliente('admin')
const gestora = cliente('gestora')
const outraGestora = cliente('outra')
const aparelho = cliente('aparelho')
let empresaA, empresaB, maria, joao, fulano, credAparelho, uidAparelho, primeiro
const cadastroMaria = () => ({ empresaId: empresaA, id: maria, nome: 'Maria Souza', cpf: CPF_MARIA, matricula: '12', cargo: 'Vendedora', admissao: null, jornada: JORNADA, ativo: true })
const cadastroJoao = () => ({ empresaId: empresaA, id: joao, nome: 'João Lima', cpf: CPF_JOAO, matricula: '7', cargo: '', admissao: null, jornada: JORNADA, ativo: true })

/**
 * Simula um PIN definido antes de o PIN ser único na empresa: só a chave por
 * funcionário (pinChave), sem índice. Devolve o índice que ele ganha ao ser usado.
 */
async function pinAntigo(funcionarioId, pin) {
  const segredo = Buffer.from((await comoDono('GET', 'sistema/pin')).fields.segredo.stringValue, 'base64')
  const hmac = (texto) => createHmac('sha256', segredo).update(texto).digest('hex')
  const caminho = `empresas/${empresaA}/credenciais/${funcionarioId}`
  const indice = (await comoDono('GET', caminho)).fields.pinIndice?.stringValue
  if (indice) await comoDono('DELETE', `pins/${indice}`)
  await comoDono('PATCH', `${caminho}?updateMask.fieldPaths=pinChave&updateMask.fieldPaths=pinIndice`, {
    fields: { pinChave: { stringValue: hmac(`${empresaA}|${funcionarioId}|${pin}`) } },
  })
  return hmac(`pin|${pin}`)
}

await etapa('configuração inicial exige o código de instalação e cria o administrador uma única vez', async () => {
  assert.equal((await getDoc(doc(anonimo.db, 'sistema', 'estado'))).exists(), false)
  const dados = { nome: 'Ana Admin', email: 'admin@teste.com', senha: 'senha-forte-123' }
  await falha(anonimo.chamar('configurarPrimeiroAdmin', dados), 'functions/permission-denied', /Código de instalação/)
  await falha(anonimo.chamar('configurarPrimeiroAdmin', { ...dados, codigo: 'CHUTE-1234' }), 'functions/permission-denied')
  await anonimo.chamar('configurarPrimeiroAdmin', { ...dados, codigo: CODIGO_INSTALACAO.toLowerCase() })
  await falha(
    anonimo.chamar('configurarPrimeiroAdmin', { nome: 'Intruso', email: 'x@teste.com', senha: 'senha-forte-123', codigo: CODIGO_INSTALACAO }),
    'functions/failed-precondition',
  )
  assert.equal((await getDoc(doc(anonimo.db, 'sistema', 'estado'))).exists(), true)
  await admin.entrar('admin@teste.com', 'senha-forte-123')
})

await etapa('visitante sem login não lê nada além do estado do sistema', async () => {
  await falha(getDocs(collection(anonimo.db, 'empresas')), 'permission-denied')
  await falha(anonimo.chamar('salvarEmpresa', { nome: 'X' }), 'functions/unauthenticated')
})

await etapa('admin cadastra empresas com CNPJ validado e único', async () => {
  const base = { fusoHorario: 'America/Sao_Paulo', intervaloMinimoMinutos: 2, toleranciaMinutos: 10, ativo: true }
  empresaA = (await admin.chamar('salvarEmpresa', { ...base, nome: 'Loja Centro', cnpj: '11.222.333/0001-81' })).id
  empresaB = (await admin.chamar('salvarEmpresa', { ...base, nome: 'Loja Shopping', cnpj: '12.ABC.345/01DE-35' })).id
  await falha(admin.chamar('salvarEmpresa', { ...base, nome: 'Inválida', cnpj: '11.222.333/0001-00' }), 'functions/invalid-argument', /CNPJ/)
  await falha(admin.chamar('salvarEmpresa', { ...base, nome: 'Duplicada', cnpj: '11222333000181' }), 'functions/already-exists')
  const snap = await getDoc(doc(admin.db, 'empresas', empresaB))
  assert.equal(snap.get('cnpj'), '12ABC34501DE35')
  // O início do controle de ponto assume a data de cadastro.
  assert.equal(snap.get('inicioControle'), dataSaoPaulo())
})

await etapa('funcionário: matrícula normalizada, PIN de 4 números (não fraco), CPF e matrícula únicos', async () => {
  const dados = { empresaId: empresaA, nome: 'Maria Souza', cpf: '529.982.247-25', cargo: 'Vendedora', admissao: null, jornada: JORNADA, ativo: true }
  await falha(admin.chamar('salvarFuncionario', { ...dados, matricula: '12', pin: '1234' }), 'functions/invalid-argument', /PIN/)
  await falha(admin.chamar('salvarFuncionario', { ...dados, matricula: '12', pin: '25801' }), 'functions/invalid-argument', /4 números/)
  maria = (await admin.chamar('salvarFuncionario', { ...dados, matricula: '0012', pin: PIN_MARIA })).id
  const snap = await getDoc(doc(admin.db, 'empresas', empresaA, 'funcionarios', maria))
  assert.equal(snap.get('matricula'), '12')
  assert.equal(snap.get('pinAtivo'), true)
  assert.equal(snap.get('pin'), undefined)
  await falha(
    admin.chamar('salvarFuncionario', { ...dados, nome: 'Outra Pessoa', cpf: '111.444.777-35', matricula: '12', pin: '9137' }),
    'functions/already-exists',
    /matrícula/,
  )
  await falha(admin.chamar('salvarFuncionario', { ...dados, matricula: '99', pin: '9137' }), 'functions/already-exists', /CPF/)
})

await etapa('ninguém lê a chave do PIN (nem o segredo do servidor) nem grava direto no banco', async () => {
  await falha(getDoc(doc(admin.db, 'empresas', empresaA, 'credenciais', maria)), 'permission-denied')
  await falha(getDoc(doc(admin.db, 'sistema', 'pin')), 'permission-denied')
  await falha(setDoc(doc(admin.db, 'empresas', empresaA, 'funcionarios', maria), { nome: 'Hack' }), 'permission-denied')
  await falha(setDoc(doc(admin.db, 'empresas', empresaA, 'registros', 'falso'), { nsr: 1 }), 'permission-denied')
  // Contadores de limite de uso e de NSR também são só do servidor.
  await falha(getDoc(doc(admin.db, 'limites', `${admin.auth.currentUser.uid}_exportarDados`)), 'permission-denied')
  await falha(getDoc(doc(admin.db, 'empresas', empresaA, 'privado', 'controle')), 'permission-denied')
})

await etapa('gestora só acessa as empresas liberadas para ela', async () => {
  await admin.chamar('salvarUsuario', {
    nome: 'Gisele Gestora',
    email: 'gestora@teste.com',
    senha: 'cafe-da-loja-centro-7',
    papel: 'gestor',
    empresas: [empresaA],
    ativo: true,
  })
  await gestora.entrar('gestora@teste.com', 'cafe-da-loja-centro-7')
  assert.equal((await getDoc(doc(gestora.db, 'empresas', empresaA))).get('nome'), 'Loja Centro')
  await falha(getDoc(doc(gestora.db, 'empresas', empresaB)), 'permission-denied')
  await falha(getDocs(collection(gestora.db, 'empresas', empresaB, 'registros')), 'permission-denied')
  await falha(gestora.chamar('salvarEmpresa', { nome: 'Nova', fusoHorario: 'America/Sao_Paulo' }), 'functions/permission-denied')
  await falha(gestora.chamar('salvarUsuario', { nome: 'X Y Z', email: 'z@teste.com', senha: '12345678', papel: 'admin', empresas: [] }), 'functions/permission-denied')
  joao = (
    await gestora.chamar('salvarFuncionario', {
      empresaId: empresaA,
      nome: 'João Lima',
      cpf: '111.444.777-35',
      matricula: '7',
      cargo: '',
      admissao: null,
      jornada: JORNADA,
      ativo: true,
      pin: PIN_JOAO_INICIAL,
    })
  ).id
  await falha(
    gestora.chamar('salvarFuncionario', { empresaId: empresaB, nome: 'Fulano', cpf: '529.982.247-25', matricula: '1', jornada: JORNADA, pin: '9137' }),
    'functions/permission-denied',
  )
  // O PIN sozinho diz quem é: na mesma empresa, dois funcionários não podem ter o mesmo.
  await falha(
    gestora.chamar('salvarFuncionario', { ...cadastroJoao(), id: undefined, nome: 'Pedro Alves', cpf: '246.813.579-28', matricula: '8', pin: PIN_MARIA }),
    'functions/already-exists',
    /PIN já é de outro funcionário/,
  )
  // Nem em outra empresa: um aparelho da loja pode atender várias, e o PIN diz de quem é a batida.
  const cadastroFulano = { empresaId: empresaB, nome: 'Fulano de Tal', cpf: '529.982.247-25', matricula: '1', jornada: JORNADA }
  await falha(admin.chamar('salvarFuncionario', { ...cadastroFulano, pin: PIN_MARIA }), 'functions/already-exists', /desta ou de outra empresa/)
  fulano = (await admin.chamar('salvarFuncionario', { ...cadastroFulano, pin: PIN_FULANO })).id
})

await etapa('admin não consegue remover o próprio acesso', async () => {
  const uid = admin.auth.currentUser.uid
  await falha(
    admin.chamar('salvarUsuario', { uid, nome: 'Ana Admin', email: 'admin@teste.com', papel: 'gestor', empresas: [], ativo: true }),
    'functions/failed-precondition',
  )
})

await etapa('senhas comuns ou com o próprio e-mail são recusadas', async () => {
  const usuario = { nome: 'Fábio Fraco', email: 'fabio@teste.com', papel: 'gestor', empresas: [empresaA], ativo: true }
  await falha(admin.chamar('salvarUsuario', { ...usuario, senha: '12345678' }), 'functions/invalid-argument', /comum/)
  await falha(admin.chamar('salvarUsuario', { ...usuario, senha: 'Senha123' }), 'functions/invalid-argument', /comum/)
  await falha(admin.chamar('salvarUsuario', { ...usuario, senha: 'fabio-2026!' }), 'functions/invalid-argument', /e-mail/)
})

await etapa('login com Google entra na conta cadastrada com o mesmo e-mail; conta Google sem cadastro não acessa nada', async () => {
  // O emulador aceita um id_token "falso" (JSON) no lugar do token assinado pelo Google.
  const google = (sub, email, verificado = true) => GoogleAuthProvider.credential(JSON.stringify({ sub, email, email_verified: verificado }))
  const pelaSenha = (email, senha) =>
    cliente(`senha-${id()}`)
      .entrar(email, senha)
      .then(
        () => null,
        (e) => e.code,
      )

  // Cadastrado sem senha: entra pelo Google, com o papel e as empresas do cadastro.
  const gil = { nome: 'Gil Google', email: 'gil@gmail.com', papel: 'gestor', empresas: [empresaA], ativo: true }
  const { uid: uidGil } = await admin.chamar('salvarUsuario', gil)
  const sessaoGil = cliente('gil')
  assert.equal((await signInWithCredential(sessaoGil.auth, google('google-gil', gil.email))).user.uid, uidGil)
  assert.equal((await getDoc(doc(sessaoGil.db, 'empresas', empresaA))).get('nome'), 'Loja Centro')
  await falha(getDoc(doc(sessaoGil.db, 'empresas', empresaB)), 'permission-denied')
  await falha(sessaoGil.chamar('salvarEmpresa', { nome: 'Nova', fusoHorario: 'America/Sao_Paulo' }), 'functions/permission-denied', /administradores/)

  // Cadastrado com senha: o primeiro login pelo Google fica com a mesma conta e a senha deixa de
  // valer (o e-mail não era confirmado). O admin pode dar uma senha de novo; o Google continua.
  const lia = { nome: 'Lia Lima', email: 'lia@gmail.com', senha: 'lia-entra-2026', papel: 'gestor', empresas: [empresaA], ativo: true }
  const { uid: uidLia } = await admin.chamar('salvarUsuario', lia)
  assert.equal((await signInWithCredential(cliente('lia').auth, google('google-lia', lia.email))).user.uid, uidLia)
  assert.ok(['auth/wrong-password', 'auth/invalid-credential'].includes(await pelaSenha(lia.email, lia.senha)))
  await admin.chamar('salvarUsuario', { uid: uidLia, ...lia, senha: 'lia-volta-2026' })
  assert.equal(await pelaSenha(lia.email, 'lia-volta-2026'), null)
  assert.equal((await signInWithCredential(cliente('lia-de-novo').auth, google('google-lia', lia.email))).user.uid, uidLia)

  // Conta Google com e-mail que o Google não confirma: só liga depois de um login com a senha
  // (o fluxo da tela de login); a senha continua valendo.
  const rui = { nome: 'Rui Reis', email: 'rui@empresa.com.br', senha: 'rui-entra-2026', papel: 'gestor', empresas: [empresaA], ativo: true }
  const { uid: uidRui } = await admin.chamar('salvarUsuario', rui)
  const sessaoRui = cliente('rui')
  const recusa = await falha(signInWithCredential(sessaoRui.auth, google('google-rui', rui.email, false)), 'auth/account-exists-with-different-credential')
  assert.equal(recusa.customData?.email, rui.email)
  const { user } = await sessaoRui.entrar(rui.email, rui.senha)
  await linkWithCredential(user, GoogleAuthProvider.credentialFromError(recusa))
  assert.equal((await signInWithCredential(cliente('rui-google').auth, google('google-rui', rui.email, false))).user.uid, uidRui)
  assert.equal(await pelaSenha(rui.email, rui.senha), null)

  // Conta Google sem cadastro: no emulador a criação de contas está liberada (o painel apaga a
  // conta na hora), mas mesmo assim ela não lê nada nem usa as funções.
  const estranho = cliente('estranho')
  await signInWithCredential(estranho.auth, google('google-estranho', 'estranho@gmail.com'))
  await falha(getDoc(doc(estranho.db, 'empresas', empresaA)), 'permission-denied')
  await falha(estranho.chamar('salvarEmpresa', { nome: 'Nova', fusoHorario: 'America/Sao_Paulo' }), 'functions/permission-denied', /não tem acesso/)
})

await etapa('gestora ativa um aparelho; ele não lê nada do banco, só fala com as funções', async () => {
  credAparelho = await gestora.chamar('ativarDispositivo', { empresaId: empresaA, nome: 'Tablet do caixa' })
  const { user } = await aparelho.entrar(credAparelho.email, credAparelho.senha)
  uidAparelho = user.uid
  const token = await user.getIdTokenResult()
  assert.equal(token.claims.papel, 'dispositivo')
  assert.equal(token.claims.empresaId, empresaA)
  await falha(getDoc(doc(aparelho.db, 'empresas', empresaA)), 'permission-denied')
  await falha(getDoc(doc(aparelho.db, 'empresas', empresaA, 'dispositivos', uidAparelho)), 'permission-denied')
  await falha(getDocs(collection(aparelho.db, 'empresas', empresaA, 'funcionarios')), 'permission-denied')
  await falha(getDocs(collection(aparelho.db, 'empresas', empresaA, 'registros')), 'permission-denied')
  await falha(getDoc(doc(aparelho.db, 'empresas', empresaB)), 'permission-denied')
  await falha(aparelho.chamar('salvarFuncionario', { empresaId: empresaA }), 'functions/permission-denied')
  const sinc = await aparelho.chamar('sincronizarDispositivo')
  assert.equal(sinc.ativo, true)
  assert.equal(sinc.empresa.nome, 'Loja Centro')
  assert.ok(Math.abs(sinc.agora - Date.now()) < 60_000)

  // O aparelho informa o estado da câmera e o painel mostra; campo fora do formato é descartado.
  const cameraDoAparelho = async () => (await getDoc(doc(gestora.db, 'empresas', empresaA, 'dispositivos', uidAparelho))).get('camera')
  await aparelho.chamar('sincronizarDispositivo', {
    camera: { estado: 'erro', codigo: 'NotAllowedError', detalhe: 'Permission denied', permissao: 'denied', resolucao: null },
  })
  assert.deepEqual(
    { ...(await cameraDoAparelho()), atualizadaEm: null },
    { estado: 'erro', codigo: 'NotAllowedError', detalhe: 'Permission denied', permissao: 'denied', resolucao: null, atualizadaEm: null },
  )
  await aparelho.chamar('sincronizarDispositivo', { camera: { estado: 'pronta', codigo: '<b>x</b>', resolucao: '1280x720', permissao: 'talvez' } })
  const pronta = await cameraDoAparelho()
  assert.equal(pronta.estado, 'pronta')
  assert.equal(pronta.codigo, null)
  assert.equal(pronta.permissao, 'desconhecida')
  assert.equal(pronta.resolucao, '1280x720')
})

await etapa('ações do painel numa função só, com aquecimento (painel e aparelho); as antigas, uma por ação, não existem', async () => {
  assert.deepEqual(await gestora.chamarFuncao('painel', { acao: 'aquecer' }), { aquecido: true })
  await falha(anonimo.chamarFuncao('painel', { acao: 'aquecer' }), 'functions/unauthenticated')
  await falha(aparelho.chamarFuncao('painel', { acao: 'aquecer' }), 'functions/permission-denied', /aparelhos de ponto/)
  await falha(aparelho.chamar('salvarFuncionario', { empresaId: empresaA }), 'functions/permission-denied')
  for (const acao of ['apagarTudo', 'constructor', '__proto__']) {
    await falha(gestora.chamarFuncao('painel', { acao, dados: {} }), 'functions/invalid-argument', /Ação desconhecida/)
  }
  // O aparelho aquece a função de ponto quando alguém começa a digitar; só aparelho pode.
  assert.deepEqual(await aparelho.chamar('registrarPonto', { aquecer: true }), { aquecido: true })
  await falha(gestora.chamar('registrarPonto', { aquecer: true }), 'functions/permission-denied')
  for (const antiga of ['salvarFuncionario', 'obterFoto', 'incluirMarcacao', 'decidirSolicitacao']) await naoExiste(gestora.chamarFuncao(antiga, {}))
})

await etapa('no aparelho, só o PIN de 4 números (sem CPF nem matrícula); o aparelho não cria nem troca PIN', async () => {
  const bater = (dados) => aparelho.chamar('registrarPonto', { idRequisicao: id(), foto: jpeg(900), miniatura: jpeg(200), ...dados })
  // Formato errado (PIN que não tem 4 números) nem é procurado.
  for (const pin of ['258', '25801', '25a0']) await falha(bater({ pin }), 'functions/permission-denied', /PIN incorreto/)
  // Tela antiga (aberta desde antes da atualização) manda a matrícula: pede para recarregar, sem "erro de matrícula".
  const antiga = await falha(bater({ matricula: '12', pin: PIN_MARIA }), 'functions/failed-precondition', /versão antiga do ponto.*Recarregue a página/)
  assert.equal(antiga.details?.motivo, 'versao-antiga')
  await naoExiste(aparelho.chamar('definirPin', { pin: PIN_MARIA, novoPin: '4826' }))
  assert.equal((await getDocs(collection(gestora.db, 'empresas', empresaA, 'registros'))).size, 0)
})

const fotoMaria = jpeg(3000)
await etapa('registro de ponto com foto gera NSR, hash e comprovante', async () => {
  const idRequisicao = id()
  // ARP (Portaria 671): antes da 1ª marcação, a inclusão do empregador e dos dois empregados, com NSR.
  const arp = (await comoDono('GET', `empresas/${empresaA}/arp`)).documents.map((d) => d.fields)
  assert.deepEqual(
    arp.map((c) => [Number(c.nsr.integerValue), Number(c.tipo.integerValue), c.operacao?.stringValue ?? null]),
    [
      [1, 2, null],
      [2, 5, 'I'],
      [3, 5, 'I'],
    ],
  )
  assert.equal(arp[0].razaoSocial.stringValue, 'Loja Centro')
  assert.equal(arp[0].idtEmpregador.stringValue, '11222333000181')
  assert.deepEqual([arp[1].cpf.stringValue, arp[1].nome.stringValue], [CPF_MARIA, 'Maria Souza'])
  const nsrAntes = await nsrAtual(empresaA)
  assert.equal(nsrAntes, 3)
  primeiro = await aparelho.chamar('registrarPonto', { idRequisicao, pin: PIN_MARIA, foto: fotoMaria, miniatura: jpeg(500) })
  assert.equal(primeiro.nsr, nsrAntes + 1)
  // A marcação tem o código hash SHA-256 do AFD (a primeira, sem anterior), que o comprovante mostra.
  const gravada = (await getDoc(doc(gestora.db, 'empresas', empresaA, 'registros', primeiro.registroId))).data()
  assert.match(gravada.rep.hash, /^[0-9a-f]{64}$/)
  assert.equal(gravada.rep.hashAnterior, '')
  assert.equal(primeiro.codigoVerificacao, gravada.rep.hash.slice(0, 12).toUpperCase())
  assert.equal(primeiro.tipo, 'entrada')
  assert.equal(primeiro.ordinal, 1)
  assert.equal(primeiro.funcionarioNome, 'Maria Souza')
  assert.equal(primeiro.dataLocal, dataSaoPaulo())
  assert.ok(Math.abs(primeiro.dataHora - Date.now()) < 60_000)

  // Reenvio da mesma requisição (ex.: internet caiu na resposta) não duplica. Vindo da tela de
  // CPF + PIN (aberta desde antes da atualização), o CPF é ignorado: o PIN diz quem é.
  const reenvio = await aparelho.chamar('registrarPonto', { idRequisicao, cpf: CPF_MARIA, pin: PIN_MARIA, foto: fotoMaria, miniatura: jpeg(500) })
  assert.equal(reenvio.nsr, primeiro.nsr)
  assert.equal(reenvio.registroId, primeiro.registroId)
  // O reenvio também exige o PIN certo: sem ele, não devolve nem o comprovante.
  await falha(
    aparelho.chamar('registrarPonto', { idRequisicao, pin: '9998', foto: fotoMaria, miniatura: jpeg(500) }),
    'functions/permission-denied',
  )
})

await etapa('batida repetida em seguida é bloqueada; PIN que não é de ninguém é recusado', async () => {
  const novo = () => ({ idRequisicao: id(), pin: PIN_MARIA, foto: jpeg(1000), miniatura: jpeg(300) })
  await falha(aparelho.chamar('registrarPonto', novo()), 'functions/failed-precondition', /já registrado/)
  const pinErrado = await falha(aparelho.chamar('registrarPonto', { ...novo(), pin: '9999' }), 'functions/permission-denied', /PIN incorreto/)
  assert.equal(pinErrado.details?.motivo, 'credenciais-invalidas')
  await falha(aparelho.chamar('registrarPonto', { ...novo(), foto: 'data:image/jpeg;base64,AAAA' }), 'functions/invalid-argument')
})

await etapa('gestora vê a marcação e a foto (pelo servidor), que confere com o hash; a cadeia é verificável', async () => {
  const snaps = await getDocs(collection(gestora.db, 'empresas', empresaA, 'registros'))
  assert.equal(snaps.size, 1)
  const registroId = snaps.docs[0].id
  const r = snaps.docs[0].data()
  assert.equal(r.funcionarioId, maria)
  assert.equal(r.origem, 'dispositivo')
  assert.equal(r.dispositivoId, uidAparelho)
  // Encadeia com o registro anterior da ARP (a inclusão do João, NSR 3).
  assert.equal(r.hashAnterior, (await comoDono('GET', `empresas/${empresaA}/arp/000000003`)).fields.hash.stringValue)
  const esperado = sha256(
    [
      r.hashAnterior,
      r.nsr,
      empresaA,
      r.funcionarioId,
      r.funcionarioCpf,
      r.dataHora.toDate().toISOString(),
      r.dataLocal,
      r.horaLocal,
      r.fotoSha256,
      r.dispositivoId,
    ].join('|'),
  )
  assert.equal(r.hash, esperado)
  assert.ok(r.miniatura.startsWith('data:image/jpeg;base64,'))

  const { foto, confere } = await gestora.chamar('obterFoto', { empresaId: empresaA, registroId })
  assert.equal(confere, true)
  assert.equal(sha256(Buffer.from(foto.split(',')[1], 'base64')), r.fotoSha256)
  assert.equal(foto, fotoMaria)
})

await etapa('foto não sai para quem não tem acesso à empresa, nem direto do Storage', async () => {
  await admin.chamar('salvarUsuario', {
    nome: 'Olga Outra',
    email: 'outra@teste.com',
    senha: 'pao-de-queijo-quente-42',
    papel: 'gestor',
    empresas: [empresaB],
    ativo: true,
  })
  await outraGestora.entrar('outra@teste.com', 'pao-de-queijo-quente-42')
  const doc0 = (await getDocs(collection(gestora.db, 'empresas', empresaA, 'registros'))).docs[0]
  const pedido = { empresaId: empresaA, registroId: doc0.id }
  await falha(outraGestora.chamar('obterFoto', pedido), 'functions/permission-denied')
  await falha(aparelho.chamar('obterFoto', pedido), 'functions/permission-denied')
  await falha(anonimo.chamar('obterFoto', pedido), 'functions/unauthenticated')
  // Nem quem tem acesso à empresa lê o arquivo direto: não existe link público.
  await falha(getBytes(ref(gestora.storage, doc0.get('fotoPath'))), 'storage/unauthorized')
  await falha(getBytes(ref(aparelho.storage, doc0.get('fotoPath'))), 'storage/unauthorized')
})

await etapa('segunda batida vira saída e encadeia com o hash anterior', async () => {
  await admin.chamar('salvarEmpresa', {
    id: empresaA,
    nome: 'Loja Centro',
    cnpj: '11222333000181',
    fusoHorario: 'America/Sao_Paulo',
    intervaloMinimoMinutos: 0,
    toleranciaMinutos: 10,
    ativo: true,
  })
  // Editar sem enviar o início do controle não o apaga.
  assert.equal((await getDoc(doc(admin.db, 'empresas', empresaA))).get('inicioControle'), dataSaoPaulo())
  const segundo = await aparelho.chamar('registrarPonto', { idRequisicao: id(), pin: PIN_MARIA, foto: jpeg(1200), miniatura: jpeg(300) })
  assert.equal(segundo.nsr, primeiro.nsr + 1)
  assert.equal(segundo.tipo, 'saida')
  assert.equal(segundo.ordinal, 2)
  const regs = (await getDocs(query(collection(gestora.db, 'empresas', empresaA, 'registros'), orderBy('nsr')))).docs.map((d) => d.data())
  assert.equal(regs[1].hashAnterior, regs[0].hash)
})

await etapa('o gestor troca o PIN: só aceita PIN que não seja de outro funcionário, e o antigo deixa de valer na hora', async () => {
  const trocarPin = (pin) => gestora.chamar('salvarFuncionario', { ...cadastroJoao(), pin })
  const tentativa = (pin) => aparelho.chamar('registrarPonto', { idRequisicao: id(), pin, foto: jpeg(800), miniatura: jpeg(200) })
  await falha(trocarPin('1111'), 'functions/invalid-argument', /adivinhar/)
  await falha(trocarPin(PIN_MARIA), 'functions/already-exists', /PIN já é de outro funcionário/)
  await trocarPin(PIN_JOAO)
  await falha(tentativa(PIN_JOAO_INICIAL), 'functions/permission-denied', /PIN incorreto/)
  // Trocar o PIN é alteração do empregado no REP (tipo 5, "A"), com NSR.
  const nsrAntes = await nsrAtual(empresaA)
  const alteracao = (await comoDono('GET', `empresas/${empresaA}/arp/${String(nsrAntes).padStart(9, '0')}`)).fields
  assert.deepEqual([Number(alteracao.tipo.integerValue), alteracao.operacao.stringValue, alteracao.nome.stringValue], [5, 'A', 'João Lima'])
  const ok = await tentativa(PIN_JOAO)
  assert.equal(ok.nsr, nsrAntes + 1)
  assert.equal(ok.funcionarioNome, 'João Lima')
  // Salvar de novo o mesmo PIN não conflita com ele mesmo.
  await trocarPin(PIN_JOAO)
  const auditoria = (await getDocs(query(collection(gestora.db, 'empresas', empresaA, 'auditoria'), where('acao', '==', 'funcionario.atualizado')))).docs
  assert.ok(auditoria.some((d) => /João Lima \(matrícula 7\) atualizado; PIN redefinido/.test(d.get('descricao'))))
  // O índice do PIN, como as credenciais, é só do servidor.
  await falha(getDocs(collection(gestora.db, 'pins')), 'permission-denied')
  await falha(getDocs(collection(admin.db, 'pins')), 'permission-denied')
})

let manual
await etapa('ajustes: incluir marcação manual e desconsiderar/restaurar com justificativa', async () => {
  const ontem = dataSaoPaulo(-1)
  manual = (
    await gestora.chamar('incluirMarcacao', { empresaId: empresaA, funcionarioId: maria, data: ontem, hora: '08:00', justificativa: 'Esqueceu de registrar' })
  ).id
  const snap = await getDoc(doc(gestora.db, 'empresas', empresaA, 'registros', manual))
  assert.equal(snap.get('origem'), 'manual')
  assert.equal(snap.get('dataLocal'), ontem)
  assert.equal(snap.get('horaLocal'), '08:00:00')
  assert.equal(snap.get('incluidoPor').nome, 'Gisele Gestora')
  assert.equal(snap.get('dataHora').toDate().toISOString(), new Date(`${ontem}T11:00:00.000Z`).toISOString())

  await falha(
    gestora.chamar('incluirMarcacao', { empresaId: empresaA, funcionarioId: maria, data: ontem, hora: '08:00', justificativa: 'Duplicada aqui' }),
    'functions/already-exists',
  )
  await falha(
    gestora.chamar('incluirMarcacao', { empresaId: empresaA, funcionarioId: maria, data: dataSaoPaulo(2), hora: '08:00', justificativa: 'No futuro' }),
    'functions/invalid-argument',
  )
  await falha(
    gestora.chamar('incluirMarcacao', { empresaId: empresaA, funcionarioId: maria, data: ontem, hora: '09:00', justificativa: 'ok' }),
    'functions/invalid-argument',
    /Justificativa/,
  )

  await gestora.chamar('desconsiderarMarcacao', { empresaId: empresaA, registroId: manual, motivo: 'Lançada por engano' })
  const desconsiderada = await getDoc(doc(gestora.db, 'empresas', empresaA, 'registros', manual))
  assert.equal(desconsiderada.get('desconsiderado').motivo, 'Lançada por engano')
  assert.equal(desconsiderada.get('horaLocal'), '08:00:00')
  await gestora.chamar('desconsiderarMarcacao', { empresaId: empresaA, registroId: manual, restaurar: true })
  assert.equal((await getDoc(doc(gestora.db, 'empresas', empresaA, 'registros', manual))).get('desconsiderado'), null)
})

await etapa('abonos: feriado coletivo e férias individuais, sem duplicar; só quem tem acesso vê', async () => {
  const ontem = dataSaoPaulo(-1)
  const feriado = { empresaId: empresaA, funcionarioId: null, tipo: 'feriado', descricao: 'Feriado municipal', de: ontem, ate: ontem, minutos: null }
  assert.equal((await gestora.chamar('incluirAbono', feriado)).criados, 1)
  await falha(gestora.chamar('incluirAbono', feriado), 'functions/already-exists')
  const ferias = await gestora.chamar('incluirAbono', {
    empresaId: empresaA,
    funcionarioId: joao,
    tipo: 'ferias',
    descricao: 'Férias de outubro',
    de: dataSaoPaulo(1),
    ate: dataSaoPaulo(10),
    minutos: null,
  })
  assert.equal(ferias.criados, 10)
  await falha(gestora.chamar('incluirAbono', { ...feriado, tipo: 'invalido' }), 'functions/invalid-argument')
  await falha(gestora.chamar('incluirAbono', { ...feriado, de: dataSaoPaulo(0), ate: dataSaoPaulo(-3) }), 'functions/invalid-argument')
  await falha(outraGestora.chamar('incluirAbono', { ...feriado, tipo: 'folga' }), 'functions/permission-denied')
  await falha(getDocs(collection(outraGestora.db, 'empresas', empresaA, 'abonos')), 'permission-denied')

  const lista = await getDocs(query(collection(gestora.db, 'empresas', empresaA, 'abonos'), where('data', '>=', ontem), where('data', '<=', dataSaoPaulo(10))))
  assert.equal(lista.size, 11)
  const doFeriado = lista.docs.find((d) => d.get('tipo') === 'feriado')
  assert.equal(doFeriado.get('funcionarioId'), null)
  assert.equal(doFeriado.get('criadoPor').nome, 'Gisele Gestora')
  await gestora.chamar('removerAbono', { empresaId: empresaA, abonoId: doFeriado.id })
  assert.equal((await getDoc(doc(gestora.db, 'empresas', empresaA, 'abonos', doFeriado.id))).exists(), false)
})

await etapa('solicitações: só o gestor registra (no painel) e aprova ou recusa; o aparelho não pede nada', async () => {
  const ontem = dataSaoPaulo(-1)
  // O funcionário só bate o ponto: o aparelho não faz solicitação (a função não existe mais).
  await naoExiste(aparelho.chamar('solicitarMarcacao', { pin: PIN_JOAO, data: ontem, hora: '18:00', motivo: 'Esqueci' }))

  const pedido = { empresaId: empresaA, funcionarioId: joao, data: ontem, hora: '18:00', motivo: 'Esqueceu de registrar a saída', aprovarAgora: false }
  await falha(aparelho.chamar('criarSolicitacao', pedido), 'functions/permission-denied')
  await falha(outraGestora.chamar('criarSolicitacao', pedido), 'functions/permission-denied')
  await falha(gestora.chamar('criarSolicitacao', { ...pedido, data: dataSaoPaulo(1) }), 'functions/invalid-argument', /futuro/)
  await falha(gestora.chamar('criarSolicitacao', { ...pedido, data: dataSaoPaulo(-40) }), 'functions/invalid-argument', /últimos/)
  const criada = await gestora.chamar('criarSolicitacao', pedido)
  assert.equal(criada.registroId, null)
  await falha(gestora.chamar('criarSolicitacao', pedido), 'functions/already-exists', /pendente/)

  // Enquanto pendente, não vira marcação.
  const doDia = () =>
    getDocs(query(collection(gestora.db, 'empresas', empresaA, 'registros'), where('funcionarioId', '==', joao), where('dataLocal', '==', ontem)))
  assert.equal((await doDia()).size, 0)
  const pendente = await getDoc(doc(gestora.db, 'empresas', empresaA, 'solicitacoes', criada.id))
  assert.equal(pendente.get('status'), 'pendente')
  assert.equal(pendente.get('solicitadoPor').nome, 'Gisele Gestora')

  // Só quem tem acesso à empresa vê e decide.
  await falha(getDocs(collection(outraGestora.db, 'empresas', empresaA, 'solicitacoes')), 'permission-denied')
  await falha(getDocs(collection(aparelho.db, 'empresas', empresaA, 'solicitacoes')), 'permission-denied')
  const decisao = { empresaId: empresaA, solicitacaoId: criada.id, aprovar: true }
  await falha(outraGestora.chamar('decidirSolicitacao', decisao), 'functions/permission-denied')
  await falha(aparelho.chamar('decidirSolicitacao', decisao), 'functions/permission-denied')

  const aprovada = await gestora.chamar('decidirSolicitacao', decisao)
  const registro = await getDoc(doc(gestora.db, 'empresas', empresaA, 'registros', aprovada.registroId))
  assert.equal(registro.get('origem'), 'manual')
  assert.equal(registro.get('horaLocal'), '18:00:00')
  assert.equal(registro.get('solicitacaoId'), criada.id)
  assert.equal(registro.get('justificativa'), 'Solicitação registrada por Gisele Gestora: Esqueceu de registrar a saída')
  const fechada = await getDoc(doc(gestora.db, 'empresas', empresaA, 'solicitacoes', criada.id))
  assert.equal(fechada.get('status'), 'aprovada')
  assert.equal(fechada.get('decididoPor').nome, 'Gisele Gestora')
  await falha(gestora.chamar('decidirSolicitacao', decisao), 'functions/failed-precondition')
  await falha(gestora.chamar('criarSolicitacao', pedido), 'functions/already-exists', /marcação/)

  // Recusa exige motivo e não cria marcação.
  const outra = await gestora.chamar('criarSolicitacao', { ...pedido, hora: '12:00' })
  await falha(
    gestora.chamar('decidirSolicitacao', { empresaId: empresaA, solicitacaoId: outra.id, aprovar: false }),
    'functions/invalid-argument',
  )
  await gestora.chamar('decidirSolicitacao', { empresaId: empresaA, solicitacaoId: outra.id, aprovar: false, motivoRecusa: 'Estava de folga' })
  assert.equal((await getDoc(doc(gestora.db, 'empresas', empresaA, 'solicitacoes', outra.id))).get('status'), 'recusada')
  assert.equal((await doDia()).size, 1)

  // O admin registra já aprovada; ou a gestora deixa pendente para outra pessoa analisar.
  const peloAdmin = await admin.chamar('criarSolicitacao', { ...pedido, hora: '08:00', motivo: 'Avisou por telefone', aprovarAgora: true })
  assert.ok(peloAdmin.registroId)
  assert.equal((await getDoc(doc(admin.db, 'empresas', empresaA, 'solicitacoes', peloAdmin.id))).get('status'), 'aprovada')
  const paraAnalise = await gestora.chamar('criarSolicitacao', { ...pedido, hora: '13:00', motivo: 'Confirmar com o gerente' })
  assert.equal(paraAnalise.registroId, null)
  assert.equal((await doDia()).size, 2)
})

await etapa('consulta do espelho (funcionário + período) traz as marcações do mês', async () => {
  const q = query(
    collection(gestora.db, 'empresas', empresaA, 'registros'),
    where('funcionarioId', '==', maria),
    where('dataLocal', '>=', dataSaoPaulo(-31)),
    where('dataLocal', '<=', dataSaoPaulo()),
  )
  assert.equal((await getDocs(q)).size, 3)
})

await etapa('fechamento do mês: espelho congelado para imprimir e assinar em papel; mudança depois só com motivo', async () => {
  const mesAtual = dataSaoPaulo().slice(0, 7)
  const [ano, numero] = mesAtual.split('-').map(Number)
  const mesAnterior = new Date(Date.UTC(ano, numero - 2, 1)).toISOString().slice(0, 7)
  for (const [dia, hora] of [
    ['15', '08:00'],
    ['15', '17:00'],
    ['16', '08:00'],
    ['16', '12:00'],
  ]) {
    await gestora.chamar('incluirMarcacao', { empresaId: empresaA, funcionarioId: maria, data: `${mesAnterior}-${dia}`, hora, justificativa: 'Implantação do sistema' })
  }

  await falha(gestora.chamar('fecharEspelhos', { empresaId: empresaA, mes: mesAtual }), 'functions/failed-precondition', /terminaram/)
  await falha(outraGestora.chamar('fecharEspelhos', { empresaId: empresaA, mes: mesAnterior }), 'functions/permission-denied')

  const resultado = (lista, id) => lista.resultados.find((r) => r.funcionarioId === id)?.resultado
  const primeiro = await gestora.chamar('fecharEspelhos', { empresaId: empresaA, mes: mesAnterior })
  assert.equal(resultado(primeiro, maria), 'fechado')
  assert.equal(resultado(primeiro, joao), 'fechado')
  const refMaria = doc(gestora.db, 'empresas', empresaA, 'espelhos', `${maria}_${mesAnterior}`)
  const fechado = await getDoc(refMaria)
  assert.equal(fechado.get('status'), 'fechado')
  assert.equal(fechado.get('versao'), 1)
  assert.equal(fechado.get('reabertura'), null)
  assert.equal(fechado.get('documento').totais.trabalhadoMin, 540 + 240)
  assert.match(fechado.get('hash'), /^[0-9a-f]{64}$/)
  assert.equal(resultado(await gestora.chamar('fecharEspelhos', { empresaId: empresaA, mes: mesAnterior }), maria), 'sem-alteracoes')

  // Só quem tem acesso à empresa vê os espelhos. O aparelho não consulta nem assina nada.
  await falha(getDocs(collection(outraGestora.db, 'empresas', empresaA, 'espelhos')), 'permission-denied')
  await falha(getDocs(collection(aparelho.db, 'empresas', empresaA, 'espelhos')), 'permission-denied')
  await naoExiste(aparelho.chamar('consultarEspelhosPendentes', { pin: PIN_MARIA }))
  await naoExiste(aparelho.chamar('assinarEspelho', { pin: PIN_MARIA, espelhoId: refMaria.id, hash: fechado.get('hash'), concordo: true }))

  // Mudança depois do fechamento (o espelho pode já ter sido impresso e assinado):
  // só com motivo, e a versão anterior fica guardada.
  await gestora.chamar('incluirMarcacao', { empresaId: empresaA, funcionarioId: maria, data: `${mesAnterior}-16`, hora: '13:00', justificativa: 'Correção após o fechamento' })
  assert.equal(resultado(await gestora.chamar('fecharEspelhos', { empresaId: empresaA, mes: mesAnterior }), maria), 'exige-motivo')
  assert.equal((await getDoc(refMaria)).get('hash'), fechado.get('hash'))
  const reabrir = (motivoReabertura) => gestora.chamar('fecharEspelhos', { empresaId: empresaA, mes: mesAnterior, funcionarioIds: [maria], motivoReabertura })
  await falha(reabrir('ok'), 'functions/invalid-argument', /Motivo/)
  const reaberto = await reabrir('Inclusão da volta do almoço do dia 16')
  assert.equal(resultado(reaberto, maria), 'atualizado')
  const versao2 = await getDoc(refMaria)
  assert.equal(versao2.get('status'), 'fechado')
  assert.equal(versao2.get('versao'), 2)
  assert.deepEqual(versao2.get('reabertura'), { motivo: 'Inclusão da volta do almoço do dia 16', versaoAnterior: 1 })
  const versao1 = await getDoc(doc(gestora.db, 'empresas', empresaA, 'espelhos', `${maria}_${mesAnterior}`, 'versoes', '1'))
  assert.equal(versao1.get('versao'), 1)
  assert.equal(versao1.get('hash'), fechado.get('hash'))
  // Reabrir sem mudança não gera versão nova.
  assert.equal(resultado(await reabrir('Conferência de rotina'), maria), 'sem-alteracoes')
  assert.equal((await getDoc(refMaria)).get('versao'), 2)
})

await etapa('exportação por empresa com filtros: marcações, espelho diário, resumo e espelhos para impressão', async () => {
  const mesAtual = dataSaoPaulo().slice(0, 7)
  const [ano, numero] = mesAtual.split('-').map(Number)
  const mesAnterior = new Date(Date.UTC(ano, numero - 2, 1)).toISOString().slice(0, 7)
  const fimMesAnterior = new Date(Date.UTC(ano, numero - 1, 0)).toISOString().slice(0, 10)
  const de = `${mesAnterior}-01`
  const ate = dataSaoPaulo()
  const exportar = (dados) =>
    gestora.chamar('exportarDados', { empresaId: empresaA, de, ate, funcionarioIds: null, incluirDesconsideradas: false, origem: 'todas', ...dados })

  // Uma marcação desconsiderada, para testar o filtro de situação.
  const alvo = (
    await getDocs(
      query(collection(gestora.db, 'empresas', empresaA, 'registros'), where('funcionarioId', '==', maria), where('dataLocal', '==', `${mesAnterior}-16`)),
    )
  ).docs.find((d) => d.get('horaLocal') === '13:00:00')
  await gestora.chamar('desconsiderarMarcacao', { empresaId: empresaA, registroId: alvo.id, motivo: 'Lançada em duplicidade' })

  // Marcações: confere com o que está no banco.
  const noBanco = (
    await getDocs(query(collection(gestora.db, 'empresas', empresaA, 'registros'), where('dataLocal', '>=', de), where('dataLocal', '<=', ate)))
  ).docs.map((d) => d.data())
  const validas = await exportar({ tipo: 'marcacoes' })
  assert.equal(validas.quantidade, noBanco.filter((r) => !r.desconsiderado).length)
  assert.equal(validas.linhas.length, validas.quantidade + 1)
  assert.equal(validas.linhas[0][0], 'Data')
  assert.ok(!JSON.stringify(validas.linhas).includes('data:image'), 'a exportação não deve trazer fotos')
  const todas = await exportar({ tipo: 'marcacoes', incluirDesconsideradas: true })
  assert.equal(todas.quantidade, noBanco.length)
  assert.ok(todas.linhas.some((l) => l[10] === 'Desconsiderada' && l[11] === 'Lançada em duplicidade'))
  const soMaria = await exportar({ tipo: 'marcacoes', funcionarioIds: [maria] })
  assert.ok(soMaria.quantidade > 0 && soMaria.linhas.slice(1).every((l) => l[3] === 'Maria Souza'))
  const manuais = await exportar({ tipo: 'marcacoes', origem: 'manual' })
  const doAparelho = await exportar({ tipo: 'marcacoes', origem: 'dispositivo' })
  assert.ok(manuais.linhas.slice(1).every((l) => l[7] === 'Manual'))
  assert.ok(doAparelho.linhas.slice(1).every((l) => l[7] === 'Aparelho' && /^\d+$/.test(String(l[9]))))
  assert.equal(manuais.quantidade + doAparelho.quantidade, validas.quantidade)

  // Espelho diário: uma linha por funcionário e dia do período.
  const dias = Math.round((Date.parse(ate) - Date.parse(de)) / 86_400_000) + 1
  assert.equal((await exportar({ tipo: 'espelho-diario', funcionarioIds: [maria, joao] })).quantidade, 2 * dias)

  // Resumo do mês anterior da Maria: 9h no dia 15 + 4h no dia 16 (a das 13:00 foi desconsiderada).
  const resumo = await exportar({ tipo: 'resumo', de, ate: fimMesAnterior, funcionarioIds: [maria] })
  assert.equal(resumo.linhas[2][0], 'Maria Souza')
  assert.equal(resumo.linhas[2][6], '13:00')

  // Espelhos para impressão: o mês sai inteiro e, se fechado, com a versão oficial.
  const paraImprimir = await exportar({ tipo: 'espelhos', de: `${mesAnterior}-10`, ate: `${mesAnterior}-20`, funcionarioIds: [maria] })
  assert.equal(paraImprimir.espelhos.length, 1)
  assert.equal(paraImprimir.espelhos[0].mes, mesAnterior)
  assert.deepEqual(Object.keys(paraImprimir.espelhos[0].fechamento).sort(), ['fechadoEm', 'fechadoPor', 'versao'])
  assert.equal(paraImprimir.espelhos[0].fechamento.versao, 2)
  assert.ok(paraImprimir.espelhos[0].documento.dias.length >= 28)

  // Só quem tem acesso à empresa exporta; período e filtros são validados.
  const pedido = { empresaId: empresaA, tipo: 'marcacoes', de, ate, funcionarioIds: null }
  await falha(outraGestora.chamar('exportarDados', pedido), 'functions/permission-denied')
  await falha(aparelho.chamar('exportarDados', pedido), 'functions/permission-denied')
  await falha(exportar({ tipo: 'marcacoes', de: '2024-01-01' }), 'functions/invalid-argument', /366/)
  await falha(exportar({ tipo: 'marcacoes', funcionarioIds: [] }), 'functions/invalid-argument')
})

await etapa('verificação de integridade aponta marcação adulterada direto no banco e avisa o painel', async () => {
  const integridade = async () => (await getDoc(doc(gestora.db, 'empresas', empresaA))).get('integridade')
  const limpa = await gestora.chamar('verificarIntegridade', { empresaId: empresaA })
  assert.equal(limpa.totalProblemas, 0)
  assert.equal(limpa.marcacoesAparelho, 3)
  assert.equal(limpa.ultimoNsr, await nsrAtual(empresaA))
  assert.ok(limpa.marcacoesManuais > 0)
  assert.equal((await integridade()).problemas, 0)
  await falha(outraGestora.chamar('verificarIntegridade', { empresaId: empresaA }), 'functions/permission-denied')

  // Alguém muda o horário de uma marcação direto no banco (como pelo Console do Firebase).
  const alvo = (await getDocs(query(collection(gestora.db, 'empresas', empresaA, 'registros'), where('nsr', '==', primeiro.nsr + 1)))).docs[0]
  const original = alvo.get('horaLocal')
  await adulterar(`empresas/${empresaA}/registros/${alvo.id}`, 'horaLocal', '06:00:00')
  const adulterada = await gestora.chamar('verificarIntegridade', { empresaId: empresaA })
  assert.equal(adulterada.totalProblemas, 1)
  assert.equal(adulterada.problemas[0].registroId, alvo.id)
  assert.match(adulterada.problemas[0].descricao, new RegExp(`NSR ${primeiro.nsr + 1} .*alterados`))
  // O painel mostra o alerta (faixa no topo) e a auditoria registra.
  assert.equal((await integridade()).problemas, 1)
  const alerta = await getDocs(query(collection(gestora.db, 'empresas', empresaA, 'auditoria'), where('acao', '==', 'integridade.alerta')))
  assert.equal(alerta.size, 1)

  await adulterar(`empresas/${empresaA}/registros/${alvo.id}`, 'horaLocal', original)
  assert.equal((await gestora.chamar('verificarIntegridade', { empresaId: empresaA })).totalProblemas, 0)
  assert.equal((await integridade()).problemas, 0)

  // Uma operação do REP (a inclusão da Maria) alterada direto no banco também aparece.
  await adulterar(`empresas/${empresaA}/arp/000000002`, 'nome', 'Outra Pessoa')
  const operacao = await admin.chamar('verificarIntegridade', { empresaId: empresaA })
  assert.equal(operacao.totalProblemas, 1)
  assert.match(operacao.problemas[0].descricao, /NSR 2 \(empregado Outra Pessoa\): dados alterados/)
  await adulterar(`empresas/${empresaA}/arp/000000002`, 'nome', 'Maria Souza')

  // Limite de uso: nos emuladores o máximo é 4 por hora (LIMITE_VERIFICAR_INTEGRIDADE em functions/.env.demo-ponto).
  await gestora.chamar('verificarIntegridade', { empresaId: empresaA })
  await falha(gestora.chamar('verificarIntegridade', { empresaId: empresaA }), 'functions/resource-exhausted', /Limite de 4/)
})

await etapa('aparelho bloqueia depois de 10 PINs errados (com foto na auditoria), mesmo em paralelo; os outros seguem', async () => {
  const celular = cliente('celular')
  const cred = await gestora.chamar('ativarDispositivo', { empresaId: empresaA, nome: 'Celular de teste' })
  await celular.entrar(cred.email, cred.senha)
  const tentativa = (pin) => celular.chamar('registrarPonto', { idRequisicao: id(), pin, foto: jpeg(800), miniatura: jpeg(200) })
  // Ataque em paralelo: 15 PINs errados disparados juntos. Cada tentativa é
  // reservada antes da resposta, então no máximo 10 PINs chegam a ser testados.
  const resultados = await Promise.allSettled(Array.from({ length: 15 }, (_, i) => tentativa(String(4000 + i * 7))))
  assert.equal(resultados.filter((r) => r.status === 'fulfilled').length, 0)
  const testados = resultados.filter((r) => r.reason?.code === 'functions/permission-denied').length
  assert.ok(testados <= 10, testados + ' PINs foram testados em paralelo (o máximo é 10)')
  for (let i = testados; i < 10; i++) await falha(tentativa('0002'), 'functions/permission-denied')
  await falha(tentativa(PIN_MARIA), 'functions/resource-exhausted', /neste aparelho/)
  const bloqueios = (await getDocs(query(collection(gestora.db, 'empresas', empresaA, 'auditoria'), where('acao', '==', 'aparelho.bloqueado')))).docs
  assert.equal(bloqueios.length, 1)
  assert.match(bloqueios[0].get('descricao'), /Celular de teste" bloqueado por 15 min depois de 10 tentativas erradas/)
  assert.ok(bloqueios[0].get('detalhes').foto.startsWith('data:image/jpeg;base64,'))
  // O outro aparelho da loja continua funcionando.
  const nsrAntes = await nsrAtual(empresaA)
  const ok = await aparelho.chamar('registrarPonto', { idRequisicao: id(), pin: PIN_MARIA, foto: jpeg(900), miniatura: jpeg(200) })
  assert.equal(ok.nsr, nsrAntes + 1)
})

await etapa('auditoria registra as ações; a do sistema é só do admin', async () => {
  const acoes = (await getDocs(collection(gestora.db, 'empresas', empresaA, 'auditoria'))).docs.map((d) => d.get('acao'))
  for (const acao of [
    'aparelho.bloqueado',
    'integridade.verificada',
    'integridade.alerta',
    'funcionario.criado',
    'funcionario.atualizado',
    'dispositivo.ativado',
    'marcacao.incluida',
    'marcacao.desconsiderada',
    'marcacao.restaurada',
    'abono.incluido',
    'abono.removido',
    'solicitacao.criada',
    'solicitacao.aprovada',
    'solicitacao.recusada',
    'espelho.fechado',
    'dados.exportados',
  ]) {
    assert.ok(acoes.includes(acao), `faltou ${acao} na auditoria`)
  }
  // Consulta do cartão "Alertas de segurança" (página Hoje): bloqueios, PIN repetido e integridade dos últimos 7 dias.
  const alertas = await getDocs(
    query(
      collection(gestora.db, 'empresas', empresaA, 'auditoria'),
      where('acao', 'in', ['pin.bloqueado', 'aparelho.bloqueado', 'pin.repetido', 'integridade.alerta']),
      where('em', '>=', Timestamp.fromMillis(Date.now() - 7 * 86_400_000)),
      orderBy('em', 'desc'),
      limit(10),
    ),
  )
  assert.deepEqual(new Set(alertas.docs.map((d) => d.get('acao'))), new Set(['aparelho.bloqueado', 'integridade.alerta']))
  await falha(getDocs(collection(gestora.db, 'auditoria')), 'permission-denied')
  const sistema = (await getDocs(collection(admin.db, 'auditoria'))).docs.map((d) => d.get('acao'))
  assert.ok(sistema.includes('empresa.criada') && sistema.includes('usuario.criado') && sistema.includes('sistema.configurado'))
})

// Mesma cifragem do navegador (web/src/paginas/ponto/terminal/semInternet.ts).
async function selar(chavePublica, conteudo) {
  const subtle = globalThis.crypto.subtle
  const publica = await subtle.importKey('spki', Buffer.from(chavePublica, 'base64'), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt'])
  const aes = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt'])
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const dados = await subtle.encrypt({ name: 'AES-GCM', iv }, aes, new TextEncoder().encode(JSON.stringify(conteudo)))
  const chave = await subtle.encrypt({ name: 'RSA-OAEP' }, publica, await subtle.exportKey('raw', aes))
  const b64 = (b) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString('base64')
  return { versao: 1, chave: b64(chave), iv: b64(iv), dados: b64(dados) }
}

await etapa('batida sem internet: guardada cifrada, conferida quando chega e marcada na cadeia de hashes', async () => {
  const { semInternet } = await aparelho.chamar('sincronizarDispositivo')
  const relogioNaAncora = Date.now()
  assert.ok(semInternet.chavePublica && semInternet.ancora.assinatura)
  // O aparelho guarda a batida com o tempo decorrido desde a âncora (e o relógio dele, que pode ter sido mudado).
  const guardar = async ({ pin = PIN_MARIA, decorrido = 2_000, desvio = 0, idRequisicao = id(), ...outros } = {}) => ({
    idRequisicao,
    pacote: await selar(semInternet.chavePublica, {
      dispositivoId: outros.dispositivoId ?? uidAparelho,
      idRequisicao,
      matricula: outros.matricula,
      pin,
      foto: jpeg(1100),
      miniatura: jpeg(300),
      horario: { ancora: outros.ancora ?? semInternet.ancora, relogioNaAncora, relogioAgora: relogioNaAncora + decorrido + desvio, decorrido },
    }),
  })
  const enviar = (pacote) => aparelho.chamar('registrarPontoGuardado', { pacote })

  // Batida normal: entra na cadeia com o NSR seguinte, marcada "sem internet", no horário certo.
  const nsrAntes = await nsrAtual(empresaA)
  const ok = await guardar()
  const resultado = await enviar(ok.pacote)
  assert.equal(resultado.resultado, 'registrada')
  assert.equal(resultado.conferir, false)
  assert.equal(resultado.comprovante.nsr, nsrAntes + 1)
  assert.ok(Math.abs(resultado.comprovante.dataHora - (semInternet.ancora.em + 2_000)) < 1_000)
  // Reenvio (a resposta se perdeu): mesmo registro, sem duplicar.
  assert.equal((await enviar(ok.pacote)).comprovante.registroId, ok.idRequisicao)
  const r = (await getDoc(doc(gestora.db, 'empresas', empresaA, 'registros', ok.idRequisicao))).data()
  assert.equal(r.semInternet.conferir, false)
  // A marca "sem internet" entra no hash: não dá para escondê-la direto no banco.
  const base = [r.hashAnterior, r.nsr, empresaA, r.funcionarioId, r.funcionarioCpf, r.dataHora.toDate().toISOString(), r.dataLocal, r.horaLocal, r.fotoSha256, r.dispositivoId]
  assert.equal(r.hash, sha256([...base, 'sem-internet', r.semInternet.recebidoEm.toDate().toISOString(), 'ok'].join('|')))

  // Relógio do aparelho atrasado 10 min para fingir chegada mais cedo: vale o tempo decorrido, e o gestor confere.
  const atrasado = await guardar({ pin: PIN_JOAO, decorrido: 3_000, desvio: -10 * 60_000 })
  const conferir = await enviar(atrasado.pacote)
  assert.equal(conferir.resultado, 'registrada')
  assert.equal(conferir.conferir, true)
  assert.ok(Math.abs(conferir.comprovante.dataHora - (semInternet.ancora.em + 3_000)) < 1_000)
  const alertaHorario = await getDocs(query(collection(gestora.db, 'empresas', empresaA, 'auditoria'), where('acao', '==', 'ponto.horarioConferir')))
  assert.equal(alertaHorario.size, 1)
  assert.match(alertaHorario.docs[0].get('descricao'), /João Lima.*Confira o horário/)

  // Recusas definitivas voltam como resultado (o aparelho tira da fila) e vão para os alertas, com a foto.
  const recusa = async (dados, motivo) => {
    const r = await enviar((await guardar(dados)).pacote)
    assert.equal(r.resultado, 'recusada')
    assert.match(r.motivo, motivo)
  }
  await recusa({ pin: '9999' }, /PIN incorreto/)
  await recusa({ ancora: { ...semInternet.ancora, em: semInternet.ancora.em - 3_600_000 } }, /confirmação do servidor/)
  await recusa({ dispositivoId: 'disp_outro' }, /outro aparelho/)
  // Guardada pela tela antiga (com matrícula): sai da fila com um aviso claro para o gestor.
  await recusa({ matricula: '12' }, /versão antiga do aparelho/)
  const recusadas = await getDocs(query(collection(gestora.db, 'empresas', empresaA, 'auditoria'), where('acao', '==', 'ponto.semInternetRecusado')))
  assert.equal(recusadas.size, 4)
  assert.ok(recusadas.docs.some((d) => String(d.get('detalhes').foto).startsWith('data:image/jpeg;base64,')))
  assert.equal((await enviar({ versao: 1, chave: 'AAAA', iv: 'AAAA', dados: 'AAAA' })).resultado, 'recusada')

  // Batida repetida (a menos do intervalo mínimo de outra) não vira outra marcação.
  const empresa = { id: empresaA, nome: 'Loja Centro', cnpj: '11222333000181', fusoHorario: 'America/Sao_Paulo', toleranciaMinutos: 10, ativo: true }
  await admin.chamar('salvarEmpresa', { ...empresa, intervaloMinimoMinutos: 2 })
  const repetida = await enviar((await guardar({ decorrido: 30_000 })).pacote)
  assert.equal(repetida.resultado, 'duplicada')
  await admin.chamar('salvarEmpresa', { ...empresa, intervaloMinimoMinutos: 0 })

  // A cadeia continua íntegra com as batidas que chegaram depois (NSR maior, horário anterior).
  const integridade = await admin.chamar('verificarIntegridade', { empresaId: empresaA })
  assert.equal(integridade.totalProblemas, 0)
  assert.equal(integridade.ultimoNsr, await nsrAtual(empresaA))
  // O aparelho nunca lê a chave privada do servidor.
  await falha(getDoc(doc(aparelho.db, 'sistema', 'semInternet')), 'permission-denied')
  await falha(getDoc(doc(admin.db, 'sistema', 'semInternet')), 'permission-denied')
})

await etapa('celular pessoal: só o dono bate ponto nele, o PIN dele bloqueia com 5 erros, e a gestora muda o uso pelo painel', async () => {
  const pessoal = cliente('pessoal')
  const ativar = (funcionarioId) => gestora.chamar('ativarDispositivo', { empresaId: empresaA, nome: 'Celular da Maria', funcionarioId })
  await falha(ativar('nao-existe'), 'functions/invalid-argument', /Dono do aparelho/)
  const cred = await ativar(maria)
  const { user } = await pessoal.entrar(cred.email, cred.senha)
  const dispositivo = await getDoc(doc(gestora.db, 'empresas', empresaA, 'dispositivos', user.uid))
  assert.equal(dispositivo.get('funcionarioNome'), 'Maria Souza')
  // A tela do aparelho recebe o dono (nome e matrícula do cadastro atual); o da loja não tem dono.
  assert.deepEqual((await pessoal.chamar('sincronizarDispositivo')).dispositivo.funcionario, { nome: 'Maria Souza' })
  assert.equal((await aparelho.chamar('sincronizarDispositivo')).dispositivo.funcionario, null)

  const bater = (pin) => pessoal.chamar('registrarPonto', { idRequisicao: id(), pin, foto: jpeg(900), miniatura: jpeg(200) })
  // Outro funcionário, mesmo com o PIN certo dele, é recusado no celular da Maria.
  const recusa = await falha(bater(PIN_JOAO), 'functions/permission-denied', /PIN incorreto/)
  assert.equal(recusa.details?.motivo, 'credenciais-invalidas')
  assert.equal((await bater(PIN_MARIA)).funcionarioNome, 'Maria Souza')

  // No celular pessoal, o PIN do dono também tem limite: 5 erros seguidos bloqueiam (com foto na auditoria).
  for (let i = 0; i < 5; i++) await falha(bater('0001'), 'functions/permission-denied')
  await falha(bater(PIN_MARIA), 'functions/resource-exhausted', /Muitas tentativas/)
  const bloqueios = (await getDocs(query(collection(gestora.db, 'empresas', empresaA, 'auditoria'), where('acao', '==', 'pin.bloqueado')))).docs
  assert.equal(bloqueios.length, 1)
  assert.match(bloqueios[0].get('descricao'), /PIN de Maria Souza bloqueado por 15 min/)
  assert.ok(bloqueios[0].get('detalhes').foto.startsWith('data:image/jpeg;base64,'))
  // Salvar o PIN de novo (mesmo que igual) desbloqueia.
  await gestora.chamar('salvarFuncionario', { ...cadastroMaria(), pin: PIN_MARIA })
  assert.equal((await bater(PIN_MARIA)).funcionarioNome, 'Maria Souza')

  // Só quem gerencia a empresa muda o uso; vale na hora no servidor e na próxima sincronização da tela.
  const mudar = (quem, funcionarioId) => quem.chamar('salvarDispositivo', { empresaId: empresaA, dispositivoId: user.uid, funcionarioId })
  await falha(mudar(outraGestora, null), 'functions/permission-denied')
  await falha(mudar(pessoal, null), 'functions/permission-denied')
  await falha(mudar(gestora, 'nao-existe'), 'functions/invalid-argument', /Dono do aparelho/)
  await mudar(gestora, null)
  assert.equal((await pessoal.chamar('sincronizarDispositivo')).dispositivo.funcionario, null)
  // Virou aparelho da loja: cada um bate com o próprio PIN.
  assert.equal((await bater(PIN_JOAO)).funcionarioNome, 'João Lima')
  await mudar(gestora, joao)
  assert.deepEqual((await pessoal.chamar('sincronizarDispositivo')).dispositivo.funcionario, { nome: 'João Lima' })
  await falha(bater(PIN_MARIA), 'functions/permission-denied', /PIN incorreto/)
  const usos = (await getDocs(query(collection(gestora.db, 'empresas', empresaA, 'auditoria'), where('acao', '==', 'dispositivo.uso')))).docs
  assert.deepEqual(usos.map((d) => d.get('descricao')).sort(), [
    'Aparelho "Celular da Maria" passou a ser o aparelho da loja (todos os funcionários).',
    'Aparelho "Celular da Maria" passou a ser o celular pessoal de João Lima.',
  ])
  await gestora.chamar('desativarDispositivo', { empresaId: empresaA, dispositivoId: user.uid })
  await falha(mudar(gestora, maria), 'functions/not-found')
})

await etapa('PIN de antes do PIN único: vale e passa ao índice na 1ª batida; repetido, vira alerta até o gestor trocar', async () => {
  const bater = (pin) => aparelho.chamar('registrarPonto', { idRequisicao: id(), pin, foto: jpeg(900), miniatura: jpeg(200) })
  const trocarPinDoJoao = (pin) => gestora.chamar('salvarFuncionario', { ...cadastroJoao(), pin })
  const indice = await pinAntigo(joao, PIN_JOAO)
  assert.equal((await bater(PIN_JOAO)).funcionarioNome, 'João Lima')
  const credenciais = (await comoDono('GET', `empresas/${empresaA}/credenciais/${joao}`)).fields
  assert.equal(credenciais.pinIndice.stringValue, indice)
  assert.equal(credenciais.pinChave, undefined)
  const noIndice = (await comoDono('GET', `pins/${indice}`)).fields
  assert.deepEqual([noIndice.empresaId.stringValue, noIndice.funcionarioId.stringValue], [empresaA, joao])

  // Dois funcionários com o mesmo PIN antigo: não dá para saber quem é, e o gestor é avisado.
  await pinAntigo(maria, '7319')
  await pinAntigo(joao, '7319')
  const repetido = await falha(bater('7319'), 'functions/failed-precondition', /igual ao de outro funcionário/)
  assert.equal(repetido.details?.motivo, 'pin-repetido')
  const alertas = (await getDocs(query(collection(gestora.db, 'empresas', empresaA, 'auditoria'), where('acao', '==', 'pin.repetido')))).docs
  assert.equal(alertas.length, 1)
  assert.match(alertas[0].get('descricao'), /Maria Souza/)
  assert.match(alertas[0].get('descricao'), /João Lima/)
  // O gestor troca o PIN do João; o PIN antigo que sobrou (da Maria) não pode ir para outra pessoa.
  await trocarPinDoJoao(PIN_JOAO)
  await falha(trocarPinDoJoao('7319'), 'functions/already-exists', /PIN já é de outro funcionário/)
  assert.equal((await bater('7319')).funcionarioNome, 'Maria Souza')
  assert.equal((await bater(PIN_JOAO)).funcionarioNome, 'João Lima')
  await gestora.chamar('salvarFuncionario', { ...cadastroMaria(), pin: PIN_MARIA })
})

await etapa('aparelho da loja que atende duas empresas: o PIN diz quem é, e a batida vai para a empresa do funcionário', async () => {
  const bater = (pin) => aparelho.chamar('registrarPonto', { idRequisicao: id(), pin, foto: jpeg(900), miniatura: jpeg(200) })
  const empresasDoAparelho = (quem, empresas) =>
    quem.chamar('salvarDispositivo', { empresaId: empresaA, dispositivoId: uidAparelho, funcionarioId: null, empresas })
  // O aparelho é da Loja Centro: o funcionário da Loja Shopping ainda não bate ponto nele.
  await falha(bater(PIN_FULANO), 'functions/permission-denied', /PIN incorreto/)
  // Só quem gerencia as duas empresas junta as duas no aparelho.
  await falha(empresasDoAparelho(gestora, [empresaB]), 'functions/permission-denied', /não tem acesso/)
  await falha(empresasDoAparelho(outraGestora, [empresaB]), 'functions/permission-denied')
  await empresasDoAparelho(admin, [empresaB])
  const sincronizado = await aparelho.chamar('sincronizarDispositivo')
  assert.deepEqual(
    sincronizado.empresas.map((e) => e.nome),
    ['Loja Centro', 'Loja Shopping'],
  )

  // A batida do Fulano vai para a Loja Shopping (NSR e cadeia dela), com a foto na pasta dela.
  const nsrAntesB = await nsrAtual(empresaB)
  const doFulano = await bater(PIN_FULANO)
  assert.equal(doFulano.funcionarioNome, 'Fulano de Tal')
  assert.equal(doFulano.empresaNome, 'Loja Shopping')
  assert.equal(doFulano.nsr, nsrAntesB + 1)
  const registro = (await getDoc(doc(outraGestora.db, 'empresas', empresaB, 'registros', doFulano.registroId))).data()
  assert.equal(registro.funcionarioId, fulano)
  assert.equal(registro.dispositivoId, uidAparelho)
  assert.ok(registro.fotoPath.startsWith(`empresas/${empresaB}/registros/`))
  assert.equal((await outraGestora.chamar('obterFoto', { empresaId: empresaB, registroId: doFulano.registroId })).confere, true)
  // A gestora da Loja Centro não vê a batida da outra empresa.
  await falha(getDoc(doc(gestora.db, 'empresas', empresaB, 'registros', doFulano.registroId)), 'permission-denied')
  // No mesmo aparelho, a Maria continua batendo na Loja Centro.
  assert.equal((await bater(PIN_MARIA)).empresaNome, 'Loja Centro')
  const integridade = await admin.chamar('verificarIntegridade', { empresaId: empresaB })
  assert.equal(integridade.totalProblemas, 0)
  assert.equal(integridade.ultimoNsr, await nsrAtual(empresaB))

  // Sem a Loja Shopping na lista, o PIN dele volta a não valer aqui.
  await empresasDoAparelho(admin, [])
  await falha(bater(PIN_FULANO), 'functions/permission-denied', /PIN incorreto/)
  assert.deepEqual(
    (await aparelho.chamar('sincronizarDispositivo')).empresas.map((e) => e.nome),
    ['Loja Centro'],
  )

  // Na ativação: só quem gerencia as empresas escolhidas; no celular pessoal, só a empresa do dono.
  const ativar = (quem, dados) => quem.chamar('ativarDispositivo', { empresaId: empresaA, nome: 'Tablet do grupo', ...dados })
  await falha(ativar(gestora, { empresas: [empresaB] }), 'functions/permission-denied', /não tem acesso/)
  const credGrupo = await ativar(admin, { empresas: [empresaB, empresaA] })
  // A conta do aparelho é o uid dele no e-mail técnico.
  const uidGrupo = credGrupo.email.split('@')[0]
  assert.deepEqual((await getDoc(doc(admin.db, 'empresas', empresaA, 'dispositivos', uidGrupo))).get('empresas'), [empresaA, empresaB])
  const credPessoal = await ativar(admin, { funcionarioId: maria, empresas: [empresaB] })
  const uidPessoal = credPessoal.email.split('@')[0]
  assert.deepEqual((await getDoc(doc(admin.db, 'empresas', empresaA, 'dispositivos', uidPessoal))).get('empresas'), [empresaA])
  for (const uid of [uidGrupo, uidPessoal]) await admin.chamar('desativarDispositivo', { empresaId: empresaA, dispositivoId: uid })
})

await etapa('AFD (Portaria 671): leiaute oficial, CRC-16, hash SHA-256 encadeado, INPI e desenvolvedor, CPF do responsável', async () => {
  // Só o administrador configura e lê os dados do REP-P (número do INPI e desenvolvedor).
  const configuracao = {
    inpi: 'BR 51 2026 000123-4',
    documento: '11.444.777/0001-61',
    nome: 'Desenvolvedor Teste',
    email: 'dev@teste.com',
    programaNome: 'Ponto Digital',
    programaVersao: '2.0',
  }
  await falha(gestora.chamar('salvarConfiguracaoRep', configuracao), 'functions/permission-denied')
  await falha(admin.chamar('salvarConfiguracaoRep', { ...configuracao, documento: '11.444.777/0001-62' }), 'functions/invalid-argument', /desenvolvedor/)
  await admin.chamar('salvarConfiguracaoRep', configuracao)
  await falha(getDoc(doc(gestora.db, 'sistema', 'rep')), 'permission-denied')
  assert.equal((await getDoc(doc(admin.db, 'sistema', 'rep'))).get('inpi'), '5120260001234')

  // Com o CPF da gestora cadastrado (Usuários), a alteração que ela faz leva o CPF dela.
  const uidGestora = gestora.auth.currentUser.uid
  await admin.chamar('salvarUsuario', { uid: uidGestora, nome: 'Gisele Gestora', email: 'gestora@teste.com', cpf: '246.813.579-28', papel: 'gestor', empresas: [empresaA], ativo: true })
  await gestora.chamar('salvarFuncionario', { ...cadastroMaria(), pin: PIN_MARIA })

  const hoje = dataSaoPaulo()
  const ontem = dataSaoPaulo(-1)
  const afd = await gestora.chamar('exportarDados', { empresaId: empresaA, tipo: 'afd', de: ontem, ate: hoje })
  assert.equal(afd.nomeArquivo, 'AFD512026000123411222333000181REP_P.txt')
  const texto = Buffer.from(afd.arquivo, 'base64').toString('latin1')
  assert.ok(texto.endsWith('\r\n'), 'cada linha termina em CR LF')
  const linhas = texto.slice(0, -2).split('\r\n')
  assert.equal(linhas.length, afd.quantidade + 3)
  const [cabecalho, ...registros] = linhas
  const assinatura = registros.pop()
  const trailer = registros.pop()

  // Cabeçalho (tipo 1): 302 posições, CNPJ, razão social, INPI só com dígitos, período, leiaute 003, desenvolvedor e CRC-16.
  assert.equal(cabecalho.length, 302)
  assert.equal(cabecalho.slice(0, 11), '00000000011')
  assert.equal(cabecalho.slice(11, 25), '11222333000181')
  assert.equal(cabecalho.slice(39, 189).trimEnd(), 'Loja Centro')
  assert.equal(cabecalho.slice(189, 206), '5120260001234    ')
  assert.equal(cabecalho.slice(206, 226), ontem + hoje)
  assert.match(cabecalho.slice(226, 250), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00-0300$/)
  assert.equal(cabecalho.slice(250, 253), '003')
  assert.equal(cabecalho.slice(253, 268), '111444777000161')
  assert.equal(cabecalho.slice(298), crc16(cabecalho.slice(0, 298)))

  // Registros na ordem do NSR, desde a inclusão do empregador (NSR 1), cada tipo com o tamanho do leiaute.
  const nsrs = registros.map((l) => Number(l.slice(0, 9)))
  assert.deepEqual(nsrs, [...nsrs].sort((a, b) => a - b))
  assert.deepEqual([nsrs[0], registros[0][9]], [1, '2'])
  for (const l of registros) {
    if (l[9] === '2') {
      assert.equal(l.length, 331)
      assert.equal(l.slice(327), crc16(l.slice(0, 327)))
    } else if (l[9] === '5') {
      assert.equal(l.length, 118)
      assert.equal(l.slice(114), crc16(l.slice(0, 114)))
    } else {
      assert.equal(l[9], '7')
      assert.equal(l.length, 137)
    }
  }
  assert.equal(registros[0].slice(49, 63), '11222333000181')
  // Inclusão da Maria (NSR 2) e a alteração feita agora pela gestora, com o CPF dela.
  assert.deepEqual([registros[1].slice(34, 35), registros[1].slice(35, 47), registros[1].slice(47, 99).trimEnd()], ['I', `${CPF_MARIA} `, 'Maria Souza'])
  const alteracao = registros.filter((l) => l[9] === '5').at(-1)
  assert.deepEqual([alteracao.slice(34, 35), alteracao.slice(103, 114)], ['A', '24681357928'])

  // Hash SHA-256 de cada marcação: campos 1 a 7 do registro, seguidos do hash da marcação anterior.
  let anterior = ''
  for (const l of registros.filter((r) => r[9] === '7')) {
    assert.equal(l.slice(73), sha256(l.slice(0, 73) + anterior))
    anterior = l.slice(73)
  }
  // A 1ª marcação da Maria: CPF em 12 posições, coletor "02" (navegador), on-line; o hash é o do comprovante.
  const daMaria = registros.find((l) => Number(l.slice(0, 9)) === primeiro.nsr)
  assert.equal(daMaria.slice(34, 46), `${CPF_MARIA} `)
  assert.equal(daMaria.slice(70, 73), '020')
  assert.equal(daMaria.slice(73, 85).toUpperCase(), primeiro.codigoVerificacao)
  // Batida feita sem internet: "1" no campo 7.
  assert.ok(registros.some((l) => l[9] === '7' && l[72] === '1'))

  // Trailer com as quantidades por tipo e a linha da assinatura em arquivo separado.
  const quantos = (tipo) => String(registros.filter((l) => l[9] === tipo).length).padStart(9, '0')
  assert.equal(trailer, '999999999' + ['2', '3', '4', '5', '6', '7'].map(quantos).join('') + '9')
  assert.equal(assinatura, 'ASSINATURA_DIGITAL_EM_ARQUIVO_P7S'.padEnd(100, ' '))
  // Os registros antigos sem o CPF do responsável (o administrador não tem CPF cadastrado) aparecem nos avisos.
  assert.ok(afd.avisos.some((a) => /sem o CPF do responsável/.test(a)))
  // A Loja Centro não tem CNPJ? Tem. Uma empresa sem CNPJ não gera AFD.
  const semCnpj = (await admin.chamar('salvarEmpresa', { nome: 'Sem CNPJ', fusoHorario: 'America/Sao_Paulo' })).id
  await falha(admin.chamar('exportarDados', { empresaId: semCnpj, tipo: 'afd', de: ontem, ate: hoje }), 'functions/failed-precondition', /CNPJ/)
})

await etapa('certificado A1 do desenvolvedor: AFD assinado (ZIP com .p7s) e comprovante do trabalhador em PDF assinado, com CPF e PIN', async () => {
  const pfx = certificadoDeTeste()
  await falha(gestora.chamar('salvarCertificado', { pfx, senha: SENHA_CERTIFICADO }), 'functions/permission-denied')
  await falha(admin.chamar('salvarCertificado', { pfx, senha: 'errada' }), 'functions/invalid-argument', /senha/)
  const enviado = await admin.chamar('salvarCertificado', { pfx, senha: SENHA_CERTIFICADO })
  assert.deepEqual([enviado.titular, enviado.icpBrasil], ['EMPRESA TESTE', false])
  // O arquivo e a senha ficam só no servidor: nem o administrador lê; o painel vê titular e validade.
  await falha(getDoc(doc(admin.db, 'sistema', 'certificado')), 'permission-denied')
  assert.equal((await getDoc(doc(admin.db, 'sistema', 'rep'))).get('certificado').titular, 'EMPRESA TESTE')

  // AFD assinado: ZIP com o arquivo e a assinatura CAdES (.p7s com o nome do AFD + ".p7s"), que confere.
  const hoje = dataSaoPaulo()
  const afd = await gestora.chamar('exportarDados', { empresaId: empresaA, tipo: 'afd', de: dataSaoPaulo(-1), ate: hoje })
  assert.equal(afd.nomeArquivo, 'AFD512026000123411222333000181REP_P.zip')
  const arquivos = lerZip(Buffer.from(afd.arquivo, 'base64'))
  const nome = 'AFD512026000123411222333000181REP_P.txt'
  assert.deepEqual(Object.keys(arquivos), [nome, `${nome}.p7s`])
  assert.ok(assinaturaConfere(arquivos[`${nome}.p7s`], arquivos[nome]))
  assert.ok(!assinaturaConfere(arquivos[`${nome}.p7s`], Buffer.concat([arquivos[nome], Buffer.from(' ')])))
  assert.ok(afd.avisos.some((a) => /não é ICP-Brasil/.test(a)))

  // Comprovantes do trabalhador: página aberta, com CPF e PIN.
  const consultar = (dados) => anonimo.chamarFuncao('comprovantes', dados)
  const lista = await consultar({ cpf: CPF_MARIA, pin: PIN_MARIA })
  assert.equal(lista.trabalhador, 'Maria Souza')
  assert.ok(lista.comprovantes.some((c) => c.registroId === primeiro.registroId && c.nsr === primeiro.nsr))
  const baixado = await consultar({ cpf: CPF_MARIA, pin: PIN_MARIA, registroId: primeiro.registroId })
  assert.equal(baixado.nome, `comprovante-NSR-${String(primeiro.nsr).padStart(9, '0')}.pdf`)
  const pdf = Buffer.from(baixado.pdf, 'base64')
  const texto = pdf.toString('latin1')
  assert.ok(texto.startsWith('%PDF-') && texto.includes('/ETSI.CAdES.detached'))
  const [, , b, c] = /\/ByteRange \[\s*(\d+) (\d+) (\d+) (\d+)\s*\]/.exec(texto).map(Number)
  const reservado = Buffer.from(texto.slice(b + 1, c - 1), 'hex')
  const cms = reservado.subarray(0, 4 + reservado.readUInt16BE(2))
  assert.ok(assinaturaConfere(cms, Buffer.concat([pdf.subarray(0, b), pdf.subarray(c)])))

  // Só os comprovantes dele: a marcação de outra pessoa não sai.
  const doJoao = (await getDocs(query(collection(gestora.db, 'empresas', empresaA, 'registros'), where('funcionarioId', '==', joao)))).docs.find((d) => d.get('origem') === 'dispositivo')
  await falha(consultar({ cpf: CPF_MARIA, pin: PIN_MARIA, registroId: doJoao.id }), 'functions/not-found')
  // CPF de outra pessoa com o PIN da Maria: recusado; 5 erros seguidos bloqueiam aquele CPF.
  for (let i = 0; i < 5; i++) await falha(consultar({ cpf: CPF_JOAO, pin: PIN_MARIA }), 'functions/permission-denied', /CPF ou PIN incorretos/)
  await falha(consultar({ cpf: CPF_JOAO, pin: PIN_JOAO }), 'functions/resource-exhausted', /Muitas tentativas/)
  await falha(consultar({ cpf: '123', pin: PIN_MARIA }), 'functions/invalid-argument', /CPF inválido/)
})

await etapa('AEJ (Portaria 671): exige o horário contratual; vínculos, horários, marcações originais, incluídas e desconsideradas, programa e trailer; assinado', async () => {
  const hoje = dataSaoPaulo()
  const [ano, mes] = hoje.split('-').map(Number)
  const de = new Date(Date.UTC(ano, mes - 2, 1)).toISOString().slice(0, 10)
  const gerar = () => gestora.chamar('exportarDados', { empresaId: empresaA, tipo: 'aej', de, ate: hoje })
  // Sem o horário contratual (entradas e saídas), o AEJ não sai.
  await falha(gerar(), 'functions/failed-precondition', /horário contratual.*João Lima, Maria Souza/)

  // O horário é conferido, e a jornada de cada dia passa a ser calculada dele.
  const COMERCIAL = '08:00-12:00 13:00-17:00'
  const horario = ['', COMERCIAL, COMERCIAL, COMERCIAL, COMERCIAL, COMERCIAL, '08:00-12:00']
  await falha(
    gestora.chamar('salvarFuncionario', { ...cadastroMaria(), horario: ['', '8h-12h', '', '', '', '', ''] }),
    'functions/invalid-argument',
    /seg: use "HH:MM-HH:MM"/,
  )
  await gestora.chamar('salvarFuncionario', { ...cadastroMaria(), horario: horario.map((d) => `  ${d}  `), jornada: [0, 0, 0, 0, 0, 0, 0] })
  await gestora.chamar('salvarFuncionario', { ...cadastroJoao(), horario })
  const maria2 = (await getDoc(doc(gestora.db, 'empresas', empresaA, 'funcionarios', maria))).data()
  assert.deepEqual(maria2.horario, horario)
  assert.deepEqual(maria2.jornada, [0, 480, 480, 480, 480, 480, 240])

  const aej = await gerar()
  const nome = `AEJ_11222333000181_${de}_${hoje}.txt`
  assert.equal(aej.nomeArquivo, nome.replace(/[.]txt$/, '.zip'))
  const arquivos = lerZip(Buffer.from(aej.arquivo, 'base64'))
  assert.deepEqual(Object.keys(arquivos), [nome, `${nome}.p7s`])
  assert.ok(assinaturaConfere(arquivos[`${nome}.p7s`], arquivos[nome]))
  const texto = arquivos[nome].toString('latin1')
  assert.ok(texto.endsWith('\r\n'))
  const linhas = texto.slice(0, -2).split('\r\n')
  const assinatura = linhas.pop()
  assert.equal(assinatura, 'ASSINATURA_DIGITAL_EM_ARQUIVO_P7S'.padEnd(100, ' '))
  const registros = linhas.map((l) => l.split('|'))
  const doTipo = (tipo) => registros.filter((r) => r[0] === tipo)

  // Cabeçalho, REP-P (INPI só com dígitos) e vínculos em ordem de nome.
  const [cabecalho] = doTipo('01')
  assert.deepEqual(cabecalho.slice(0, 8), ['01', '1', '11222333000181', '', '', 'Loja Centro', de, hoje])
  assert.match(cabecalho[8], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00-0300$/)
  assert.equal(cabecalho[9], '001')
  assert.deepEqual(doTipo('02'), [['02', '1', '3', '5120260001234']])
  assert.deepEqual(doTipo('03'), [
    ['03', '1', CPF_JOAO, 'João Lima'],
    ['03', '2', CPF_MARIA, 'Maria Souza'],
  ])
  // Horários contratuais distintos: 8h em dois pares e 4h num par só (o 2º par vazio).
  assert.deepEqual(doTipo('04'), [
    ['04', 'H1', '480', '0800', '1200', '1300', '1700'],
    ['04', 'H2', '240', '0800', '1200', '', ''],
  ])

  // Marcações: 9 campos; originais do REP com o REP 1; incluídas pelo gestor sem REP e com a justificativa; desconsideradas com o motivo.
  const marcacoes = doTipo('05')
  assert.ok(marcacoes.length > 0)
  for (const m of marcacoes) {
    assert.equal(m.length, 9, m.join('|'))
    assert.match(m[2], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00-0300$/)
    assert.ok(['E', 'S', 'D'].includes(m[4]))
    assert.match(m[5], /^\d{3}$/)
    assert.equal(m[3], m[6] === 'O' ? '1' : '')
    if (m[4] === 'D' || m[6] === 'I') assert.ok(m[8].length > 0, `sem motivo: ${m.join('|')}`)
    // Só a 1ª entrada do dia leva o código do horário (pode faltar em dia de folga).
    if (m[4] !== 'E' || m[5] !== '001') assert.equal(m[7], '')
  }
  assert.ok(marcacoes.some((m) => m[6] === 'I' && m[8] === 'Esqueceu de registrar'))
  assert.ok(marcacoes.some((m) => m[4] === 'D' && m[8] === 'Lançada em duplicidade'))
  for (const falta of doTipo('07')) assert.match(falta.join('|'), /^07\|[12]\|2\|\d{4}-\d{2}-\d{2}\|\|$/)

  // Programa de tratamento e desenvolvedor (Administração → Portaria 671) e o trailer.
  assert.deepEqual(doTipo('08'), [['08', 'Ponto Digital', '2.0', '1', '11444777000161', 'Desenvolvedor Teste', 'dev@teste.com']])
  const [trailer] = doTipo('99')
  assert.deepEqual(trailer, ['99', ...['01', '02', '03', '04', '05', '06', '07', '08'].map((t) => String(doTipo(t).length))])
  assert.equal(aej.quantidade, marcacoes.length + doTipo('07').length)
})

await etapa('só o administrador apaga uma marcação: some das telas e exportações, a foto vai junto e a cadeia continua íntegra', async () => {
  const registroRef = doc(gestora.db, 'empresas', empresaA, 'registros', primeiro.registroId)
  const { fotoPath, nsr } = (await getDoc(registroRef)).data()
  const fotoNoStorage = () =>
    fetch(`http://127.0.0.1:9199/v0/b/${config.storageBucket}/o/${encodeURIComponent(fotoPath)}`, { headers: { Authorization: 'Bearer owner' } }).then(
      (r) => r.status,
    )
  assert.equal(await fotoNoStorage(), 200)
  const apagar = (quem, motivo) => quem.chamar('apagarMarcacao', { empresaId: empresaA, registroId: primeiro.registroId, motivo })

  await falha(apagar(gestora, 'Batida de teste'), 'functions/permission-denied', /Só o administrador/)
  await falha(apagar(outraGestora, 'Batida de teste'), 'functions/permission-denied')
  await falha(apagar(aparelho, 'Batida de teste'), 'functions/permission-denied')
  await falha(apagar(admin, ''), 'functions/invalid-argument', /Motivo/)
  await apagar(admin, 'Batida de teste na implantação')

  // Sem foto nem miniatura; fica só o que entra no hash, marcado como apagado.
  const apagada = (await getDoc(registroRef)).data()
  assert.equal(apagada.apagado.motivo, 'Batida de teste na implantação')
  assert.equal(apagada.apagado.por.nome, 'Ana Admin')
  assert.ok(apagada.desconsiderado)
  assert.equal(apagada.fotoPath, undefined)
  assert.equal(apagada.miniatura, undefined)
  assert.equal(apagada.nsr, nsr)
  assert.equal(await fotoNoStorage(), 404)
  await falha(gestora.chamar('obterFoto', { empresaId: empresaA, registroId: primeiro.registroId }), 'functions/not-found')
  // Não volta nem é apagada duas vezes.
  await falha(
    gestora.chamar('desconsiderarMarcacao', { empresaId: empresaA, registroId: primeiro.registroId, restaurar: true }),
    'functions/not-found',
  )
  await falha(apagar(admin, 'De novo, por engano'), 'functions/not-found')

  // Fora da exportação, mesmo pedindo as desconsideradas.
  const hoje = dataSaoPaulo()
  const exportadas = await admin.chamar('exportarDados', {
    empresaId: empresaA,
    de: hoje,
    ate: hoje,
    funcionarioIds: null,
    incluirDesconsideradas: true,
    origem: 'todas',
    tipo: 'marcacoes',
  })
  assert.ok(exportadas.quantidade > 0)
  assert.ok(!exportadas.linhas.slice(1).some((l) => Number(l[9]) === nsr), 'a marcação apagada saiu na exportação')

  // A cadeia de hashes continua íntegra (o NSR apagado não vira "marcação apagada direto no banco").
  const integridade = await admin.chamar('verificarIntegridade', { empresaId: empresaA })
  assert.equal(integridade.totalProblemas, 0)
  const auditoria = (await getDocs(query(collection(gestora.db, 'empresas', empresaA, 'auditoria'), where('acao', '==', 'marcacao.apagada')))).docs
  assert.equal(auditoria.length, 1)
  assert.equal(auditoria[0].get('detalhes').motivo, 'Batida de teste na implantação')
  assert.match(auditoria[0].get('descricao'), /Marcação de Maria Souza em .* apagada/)
})

await etapa('escalas de horário: criar (também em outra empresa), associar vários de uma vez, mudar a escala muda o horário de todos, tirar e excluir', async () => {
  const PARES = '07:00-11:00 12:00-16:00'
  const MANHA = ['', PARES, PARES, PARES, PARES, PARES, '07:00-11:00']
  const SEM_SABADO = [...MANHA.slice(0, 6), '']
  const lerFuncionario = async (id) => (await getDoc(doc(gestora.db, 'empresas', empresaA, 'funcionarios', id))).data()
  const escalasDaShopping = async () => (await getDocs(collection(outraGestora.db, 'empresas', empresaB, 'escalas'))).docs

  // Nome, horário conferido e pelo menos um dia de trabalho; outra empresa, só com acesso a ela.
  const manha = { empresaId: empresaA, nome: 'Manhã', horario: MANHA }
  await falha(gestora.chamar('salvarEscala', { ...manha, nome: 'X' }), 'functions/invalid-argument', /Nome da escala/)
  await falha(gestora.chamar('salvarEscala', { ...manha, horario: ['', '', '', '', '', '', ''] }), 'functions/invalid-argument', /pelo menos um dia/)
  await falha(gestora.chamar('salvarEscala', { ...manha, horario: ['', '7h-11h', '', '', '', '', ''] }), 'functions/invalid-argument', /seg: use/)
  await falha(gestora.chamar('salvarEscala', { ...manha, copiarPara: [empresaB] }), 'functions/permission-denied', /não tem acesso/)
  await falha(outraGestora.chamar('salvarEscala', manha), 'functions/permission-denied')

  // O admin cria na Loja Centro e, junto, na Loja Shopping: cada uma fica com a sua.
  const criada = await admin.chamar('salvarEscala', { ...manha, horario: MANHA.map((dia) => ` ${dia} `), copiarPara: [empresaB] })
  assert.equal(criada.copias, 1)
  const escala = (await getDoc(doc(gestora.db, 'empresas', empresaA, 'escalas', criada.id))).data()
  assert.deepEqual(escala.horario, MANHA)
  assert.deepEqual(escala.jornada, [0, 480, 480, 480, 480, 480, 240])
  assert.deepEqual((await escalasDaShopping()).map((d) => d.get('nome')), ['Manhã'])
  await falha(getDocs(collection(gestora.db, 'empresas', empresaB, 'escalas')), 'permission-denied')
  await falha(setDoc(doc(gestora.db, 'empresas', empresaA, 'escalas', 'falsa'), { nome: 'Hack' }), 'permission-denied')
  // Nome repetido na empresa (sem contar acento e maiúscula), não.
  await falha(gestora.chamar('salvarEscala', { ...manha, nome: 'MANHA' }), 'functions/already-exists', /Já existe uma escala/)

  // Associar vários de uma vez: cada um recebe o horário e a jornada da escala.
  const associar = (adicionar, remover = []) => gestora.chamar('associarEscala', { empresaId: empresaA, escalaId: criada.id, adicionar, remover })
  await falha(associar([fulano]), 'functions/not-found', /Funcionário não encontrado/)
  await falha(associar([maria], [maria]), 'functions/invalid-argument')
  assert.deepEqual(await associar([maria, joao]), { adicionados: 2, removidos: 0 })
  for (const id of [maria, joao]) {
    const f = await lerFuncionario(id)
    assert.equal(f.escalaId, criada.id)
    assert.deepEqual(f.horario, MANHA)
    assert.deepEqual(f.jornada, [0, 480, 480, 480, 480, 480, 240])
  }
  assert.deepEqual(await associar([maria]), { adicionados: 0, removidos: 0 })

  // Mudar a escala muda o horário (e a jornada) de todos dela; a da outra empresa continua igual.
  const editada = await gestora.chamar('salvarEscala', { empresaId: empresaA, id: criada.id, nome: 'Manhã 40h', horario: SEM_SABADO })
  assert.equal(editada.funcionariosAtualizados, 2)
  for (const id of [maria, joao]) {
    const f = await lerFuncionario(id)
    assert.deepEqual(f.horario, SEM_SABADO)
    assert.deepEqual(f.jornada, [0, 480, 480, 480, 480, 480, 0])
  }
  assert.deepEqual((await escalasDaShopping())[0].get('horario'), MANHA)

  // No cadastro, com a escala vale o horário dela (mesmo vindo outro); "horário próprio" tira da escala.
  await gestora.chamar('salvarFuncionario', { ...cadastroMaria(), horario: MANHA, escalaId: criada.id })
  assert.deepEqual((await lerFuncionario(maria)).horario, SEM_SABADO)
  await falha(gestora.chamar('salvarFuncionario', { ...cadastroMaria(), escalaId: 'naoExiste' }), 'functions/not-found', /Escala não encontrada/)
  // Painel de antes das escalas (sem o campo): continua na escala com o mesmo horário; sem nenhum horário, também.
  await gestora.chamar('salvarFuncionario', { ...cadastroMaria(), horario: SEM_SABADO })
  await gestora.chamar('salvarFuncionario', cadastroMaria())
  assert.equal((await lerFuncionario(maria)).escalaId, criada.id)
  await gestora.chamar('salvarFuncionario', { ...cadastroMaria(), horario: MANHA, escalaId: null })
  const mariaPropria = await lerFuncionario(maria)
  assert.equal(mariaPropria.escalaId, undefined)
  assert.deepEqual(mariaPropria.horario, MANHA)
  assert.deepEqual(mariaPropria.jornada, [0, 480, 480, 480, 480, 480, 240])

  // Tirar da escala: fica com o mesmo horário, como horário próprio (quem já não era dela não conta).
  assert.deepEqual(await associar([], [joao, maria]), { adicionados: 0, removidos: 1 })
  const joaoProprio = await lerFuncionario(joao)
  assert.equal(joaoProprio.escalaId, undefined)
  assert.deepEqual(joaoProprio.horario, SEM_SABADO)

  // Excluir a escala: quem era dela também fica com o mesmo horário.
  await associar([joao])
  assert.deepEqual(await gestora.chamar('removerEscala', { empresaId: empresaA, escalaId: criada.id }), { ok: true, funcionarios: 1 })
  assert.equal((await getDoc(doc(gestora.db, 'empresas', empresaA, 'escalas', criada.id))).exists(), false)
  const joaoDepois = await lerFuncionario(joao)
  assert.equal(joaoDepois.escalaId, undefined)
  assert.deepEqual(joaoDepois.horario, SEM_SABADO)
  await falha(associar([joao]), 'functions/not-found', /Escala não encontrada/)

  // Tudo na auditoria de cada empresa.
  const ACOES_ESCALA = ['escala.criada', 'escala.atualizada', 'escala.associada', 'escala.removida']
  const auditoria = await getDocs(query(collection(gestora.db, 'empresas', empresaA, 'auditoria'), where('acao', 'in', ACOES_ESCALA)))
  assert.deepEqual([...new Set(auditoria.docs.map((d) => d.get('acao')))].sort(), [...ACOES_ESCALA].sort())
  const daShopping = await getDocs(query(collection(outraGestora.db, 'empresas', empresaB, 'auditoria'), where('acao', '==', 'escala.criada')))
  assert.match(daShopping.docs[0].get('descricao'), /Escala Manhã criada \(junto com a de Loja Centro\)/)
})

await etapa('aparelho desativado para de registrar na hora', async () => {
  await gestora.chamar('desativarDispositivo', { empresaId: empresaA, dispositivoId: uidAparelho })
  await falha(
    aparelho.chamar('registrarPonto', { idRequisicao: id(), pin: PIN_MARIA, foto: jpeg(900), miniatura: jpeg(200) }),
    'functions/permission-denied',
    /desativado/,
  )
  assert.equal((await aparelho.chamar('sincronizarDispositivo')).ativo, false)
  // A conta do aparelho foi apagada: não entra mais.
  const erro = await aparelho.entrar(credAparelho.email, credAparelho.senha).then(
    () => null,
    (e) => e,
  )
  assert.ok(['auth/user-not-found', 'auth/invalid-credential'].includes(erro?.code), `login deveria falhar, veio ${erro?.code}`)
})

console.log(`\nTodas as ${total} etapas passaram.\n`)
process.exit(0)
