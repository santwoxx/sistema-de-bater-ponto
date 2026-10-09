// Teste de ponta a ponta contra os emuladores do Firebase (nada vai para a nuvem).
// Exige Java 21+ e o Firebase CLI. Na pasta "web":  npm run test:e2e

import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
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
// No aparelho da loja: CPF + PIN de 4 números (definido pelo gestor). No celular pessoal, só o PIN.
const CPF_MARIA = '52998224725'
const CPF_JOAO = '11144477735'
const PIN_MARIA = '2580'
const PIN_JOAO_INICIAL = '1357'
// O gestor troca o PIN do João no meio do teste ("esqueceu o PIN").
const PIN_JOAO = '8642'

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
  const chamar = async (funcao, dados = {}) => (await httpsCallable(functions, funcao)(dados)).data
  const entrar = (email, senha) => signInWithEmailAndPassword(auth, email, senha)
  return { auth, db, storage, chamar, entrar }
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
function cpfValido(base) {
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
let empresaA, empresaB, maria, joao, credAparelho, uidAparelho, primeiro

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

await etapa('no aparelho da loja, CPF + PIN de 4 números; o aparelho não cria nem troca PIN', async () => {
  const bater = (dados) => aparelho.chamar('registrarPonto', { idRequisicao: id(), foto: jpeg(900), miniatura: jpeg(200), ...dados })
  // Formato errado (PIN que não tem 4 números, CPF com dígito verificador errado ou com pontos) nem é procurado.
  for (const dados of [
    { cpf: CPF_MARIA, pin: '258' },
    { cpf: CPF_MARIA, pin: '25801' },
    { cpf: '52998224726', pin: PIN_MARIA },
    { cpf: '529.982.247-25', pin: PIN_MARIA },
  ]) {
    await falha(bater(dados), 'functions/permission-denied', /CPF ou PIN incorretos/)
  }
  // Sem CPF, só no celular pessoal (que já tem dono).
  await falha(bater({ pin: PIN_MARIA }), 'functions/permission-denied', /CPF ou PIN incorretos/)
  // Tela antiga (aberta desde antes da atualização) manda a matrícula: pede para recarregar, sem "erro de matrícula".
  const antiga = await falha(bater({ matricula: '12', pin: PIN_MARIA }), 'functions/failed-precondition', /versão antiga do ponto.*Recarregue a página/)
  assert.equal(antiga.details?.motivo, 'versao-antiga')
  await naoExiste(aparelho.chamar('definirPin', { cpf: CPF_MARIA, pin: PIN_MARIA, novoPin: '4826' }))
  assert.equal((await getDocs(collection(gestora.db, 'empresas', empresaA, 'registros'))).size, 0)
})

const fotoMaria = jpeg(3000)
await etapa('registro de ponto com foto gera NSR, hash e comprovante', async () => {
  const idRequisicao = id()
  primeiro = await aparelho.chamar('registrarPonto', { idRequisicao, cpf: CPF_MARIA, pin: PIN_MARIA, foto: fotoMaria, miniatura: jpeg(500) })
  assert.equal(primeiro.nsr, 1)
  assert.equal(primeiro.tipo, 'entrada')
  assert.equal(primeiro.ordinal, 1)
  assert.equal(primeiro.funcionarioNome, 'Maria Souza')
  assert.equal(primeiro.dataLocal, dataSaoPaulo())
  assert.ok(Math.abs(primeiro.dataHora - Date.now()) < 60_000)

  // Reenvio da mesma requisição (ex.: internet caiu na resposta) não duplica.
  const reenvio = await aparelho.chamar('registrarPonto', { idRequisicao, cpf: CPF_MARIA, pin: PIN_MARIA, foto: fotoMaria, miniatura: jpeg(500) })
  assert.equal(reenvio.nsr, 1)
  assert.equal(reenvio.registroId, primeiro.registroId)
  // O reenvio também exige o PIN certo: sem ele, não devolve nem o comprovante.
  await falha(
    aparelho.chamar('registrarPonto', { idRequisicao, cpf: CPF_MARIA, pin: '9998', foto: fotoMaria, miniatura: jpeg(500) }),
    'functions/permission-denied',
  )
})

await etapa('batida repetida em seguida é bloqueada; PIN errado e CPF de quem não é funcionário dão a mesma recusa', async () => {
  const novo = () => ({ idRequisicao: id(), cpf: CPF_MARIA, pin: PIN_MARIA, foto: jpeg(1000), miniatura: jpeg(300) })
  await falha(aparelho.chamar('registrarPonto', novo()), 'functions/failed-precondition', /já registrado/)
  const pinErrado = await falha(aparelho.chamar('registrarPonto', { ...novo(), pin: '9999' }), 'functions/permission-denied', /CPF ou PIN incorretos/)
  const cpfDeNinguem = await falha(
    aparelho.chamar('registrarPonto', { ...novo(), cpf: cpfValido('123456789') }),
    'functions/permission-denied',
    /CPF ou PIN incorretos/,
  )
  assert.equal(pinErrado.details?.motivo, 'credenciais-invalidas')
  assert.deepEqual(cpfDeNinguem.details, pinErrado.details)
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
  assert.equal(r.hashAnterior, '0'.repeat(64))
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
  const segundo = await aparelho.chamar('registrarPonto', { idRequisicao: id(), cpf: CPF_MARIA, pin: PIN_MARIA, foto: jpeg(1200), miniatura: jpeg(300) })
  assert.equal(segundo.nsr, 2)
  assert.equal(segundo.tipo, 'saida')
  assert.equal(segundo.ordinal, 2)
  const regs = (await getDocs(query(collection(gestora.db, 'empresas', empresaA, 'registros'), orderBy('nsr')))).docs.map((d) => d.data())
  assert.equal(regs[1].hashAnterior, regs[0].hash)
})

await etapa('PIN errado: 5 erros bloqueiam o PIN (com foto na auditoria), mesmo em paralelo; o gestor troca o PIN', async () => {
  const tentativa = (pin) => aparelho.chamar('registrarPonto', { idRequisicao: id(), cpf: CPF_JOAO, pin, foto: jpeg(800), miniatura: jpeg(200) })
  for (let i = 0; i < 5; i++) await falha(tentativa('0001'), 'functions/permission-denied')
  await falha(tentativa(PIN_JOAO_INICIAL), 'functions/resource-exhausted', /Muitas tentativas/)
  const bloqueios = (await getDocs(query(collection(gestora.db, 'empresas', empresaA, 'auditoria'), where('acao', '==', 'pin.bloqueado')))).docs
  assert.equal(bloqueios.length, 1)
  assert.match(bloqueios[0].get('descricao'), /PIN de João Lima bloqueado por 15 min/)
  assert.ok(bloqueios[0].get('detalhes').foto.startsWith('data:image/jpeg;base64,'))

  // O gestor troca o PIN (o que também desbloqueia).
  const trocarPin = (pin) =>
    gestora.chamar('salvarFuncionario', {
      empresaId: empresaA,
      id: joao,
      nome: 'João Lima',
      cpf: CPF_JOAO,
      matricula: '7',
      cargo: '',
      admissao: null,
      jornada: JORNADA,
      ativo: true,
      pin,
    })
  await falha(trocarPin('1111'), 'functions/invalid-argument', /adivinhar/)
  await trocarPin(PIN_JOAO)

  // Ataque em paralelo: 12 PINs errados disparados juntos. Cada tentativa é
  // reservada antes da conferência, então no máximo 5 PINs chegam a ser testados.
  const resultados = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => tentativa(String(4000 + i * 7))))
  assert.equal(resultados.filter((r) => r.status === 'fulfilled').length, 0)
  const testados = resultados.filter((r) => r.reason?.code === 'functions/permission-denied').length
  assert.ok(testados <= 5, testados + ' PINs foram testados em paralelo (o máximo é 5)')
  for (let i = testados; i < 5; i++) await falha(tentativa('0002'), 'functions/permission-denied')
  await falha(tentativa(PIN_JOAO), 'functions/resource-exhausted', /Muitas tentativas/)

  // Trocado de novo pelo gestor: o PIN antigo deixa de valer e o novo bate o ponto.
  await trocarPin(PIN_JOAO)
  await falha(tentativa(PIN_JOAO_INICIAL), 'functions/permission-denied')
  const ok = await tentativa(PIN_JOAO)
  assert.equal(ok.nsr, 3)
  assert.equal(ok.funcionarioNome, 'João Lima')
  const auditoria = (await getDocs(query(collection(gestora.db, 'empresas', empresaA, 'auditoria'), where('acao', '==', 'funcionario.atualizado')))).docs
  assert.ok(auditoria.some((d) => /João Lima \(matrícula 7\) atualizado; PIN redefinido/.test(d.get('descricao'))))
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
  assert.equal(limpa.ultimoNsr, 3)
  assert.ok(limpa.marcacoesManuais > 0)
  assert.equal((await integridade()).problemas, 0)
  await falha(outraGestora.chamar('verificarIntegridade', { empresaId: empresaA }), 'functions/permission-denied')

  // Alguém muda o horário de uma marcação direto no banco (como pelo Console do Firebase).
  const alvo = (await getDocs(query(collection(gestora.db, 'empresas', empresaA, 'registros'), where('nsr', '==', 2)))).docs[0]
  const original = alvo.get('horaLocal')
  await adulterar(`empresas/${empresaA}/registros/${alvo.id}`, 'horaLocal', '06:00:00')
  const adulterada = await gestora.chamar('verificarIntegridade', { empresaId: empresaA })
  assert.equal(adulterada.totalProblemas, 1)
  assert.equal(adulterada.problemas[0].registroId, alvo.id)
  assert.match(adulterada.problemas[0].descricao, /NSR 2 .*alterados/)
  // O painel mostra o alerta (faixa no topo) e a auditoria registra.
  assert.equal((await integridade()).problemas, 1)
  const alerta = await getDocs(query(collection(gestora.db, 'empresas', empresaA, 'auditoria'), where('acao', '==', 'integridade.alerta')))
  assert.equal(alerta.size, 1)

  await adulterar(`empresas/${empresaA}/registros/${alvo.id}`, 'horaLocal', original)
  assert.equal((await gestora.chamar('verificarIntegridade', { empresaId: empresaA })).totalProblemas, 0)
  assert.equal((await integridade()).problemas, 0)

  // Limite de uso: nos emuladores o máximo é 4 por hora (LIMITE_VERIFICAR_INTEGRIDADE em functions/.env.demo-ponto).
  await gestora.chamar('verificarIntegridade', { empresaId: empresaA })
  await falha(gestora.chamar('verificarIntegridade', { empresaId: empresaA }), 'functions/resource-exhausted', /Limite de 4/)
})

await etapa('aparelho bloqueia depois de 25 tentativas erradas (CPFs diferentes, nenhum chega a 5 erros); os outros seguem', async () => {
  const celular = cliente('celular')
  const cred = await gestora.chamar('ativarDispositivo', { empresaId: empresaA, nome: 'Celular de teste' })
  await celular.entrar(cred.email, cred.senha)
  const tentativa = (cpf, pin) => celular.chamar('registrarPonto', { idRequisicao: id(), cpf, pin, foto: jpeg(800), miniatura: jpeg(200) })
  for (let i = 0; i < 25; i++) await falha(tentativa(cpfValido(String(300000000 + i)), '2468'), 'functions/permission-denied')
  await falha(tentativa(CPF_MARIA, PIN_MARIA), 'functions/resource-exhausted', /neste aparelho/)
  const bloqueios = (await getDocs(query(collection(gestora.db, 'empresas', empresaA, 'auditoria'), where('acao', '==', 'aparelho.bloqueado')))).docs
  assert.equal(bloqueios.length, 1)
  assert.match(bloqueios[0].get('descricao'), /Celular de teste" bloqueado por 15 min depois de 25 tentativas erradas/)
  assert.ok(bloqueios[0].get('detalhes').foto.startsWith('data:image/jpeg;base64,'))
  // O outro aparelho da loja continua funcionando.
  const ok = await aparelho.chamar('registrarPonto', { idRequisicao: id(), cpf: CPF_MARIA, pin: PIN_MARIA, foto: jpeg(900), miniatura: jpeg(200) })
  assert.equal(ok.nsr, 4)
})

await etapa('auditoria registra as ações; a do sistema é só do admin', async () => {
  const acoes = (await getDocs(collection(gestora.db, 'empresas', empresaA, 'auditoria'))).docs.map((d) => d.get('acao'))
  for (const acao of [
    'pin.bloqueado',
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
  // Consulta do cartão "Alertas de segurança" (página Hoje): bloqueios e integridade dos últimos 7 dias.
  const alertas = await getDocs(
    query(
      collection(gestora.db, 'empresas', empresaA, 'auditoria'),
      where('acao', 'in', ['pin.bloqueado', 'aparelho.bloqueado', 'integridade.alerta']),
      where('em', '>=', Timestamp.fromMillis(Date.now() - 7 * 86_400_000)),
      orderBy('em', 'desc'),
      limit(10),
    ),
  )
  assert.deepEqual(new Set(alertas.docs.map((d) => d.get('acao'))), new Set(['pin.bloqueado', 'aparelho.bloqueado', 'integridade.alerta']))
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
  const guardar = async ({ cpf = CPF_MARIA, pin = PIN_MARIA, decorrido = 2_000, desvio = 0, idRequisicao = id(), ...outros } = {}) => ({
    idRequisicao,
    pacote: await selar(semInternet.chavePublica, {
      dispositivoId: outros.dispositivoId ?? uidAparelho,
      idRequisicao,
      cpf,
      matricula: outros.matricula,
      pin,
      foto: jpeg(1100),
      miniatura: jpeg(300),
      horario: { ancora: outros.ancora ?? semInternet.ancora, relogioNaAncora, relogioAgora: relogioNaAncora + decorrido + desvio, decorrido },
    }),
  })
  const enviar = (pacote) => aparelho.chamar('registrarPontoGuardado', { pacote })

  // Batida normal: entra na cadeia com o NSR seguinte, marcada "sem internet", no horário certo.
  const ok = await guardar()
  const resultado = await enviar(ok.pacote)
  assert.equal(resultado.resultado, 'registrada')
  assert.equal(resultado.conferir, false)
  assert.equal(resultado.comprovante.nsr, 5)
  assert.ok(Math.abs(resultado.comprovante.dataHora - (semInternet.ancora.em + 2_000)) < 1_000)
  // Reenvio (a resposta se perdeu): mesmo registro, sem duplicar.
  assert.equal((await enviar(ok.pacote)).comprovante.registroId, ok.idRequisicao)
  const r = (await getDoc(doc(gestora.db, 'empresas', empresaA, 'registros', ok.idRequisicao))).data()
  assert.equal(r.semInternet.conferir, false)
  // A marca "sem internet" entra no hash: não dá para escondê-la direto no banco.
  const base = [r.hashAnterior, r.nsr, empresaA, r.funcionarioId, r.funcionarioCpf, r.dataHora.toDate().toISOString(), r.dataLocal, r.horaLocal, r.fotoSha256, r.dispositivoId]
  assert.equal(r.hash, sha256([...base, 'sem-internet', r.semInternet.recebidoEm.toDate().toISOString(), 'ok'].join('|')))

  // Relógio do aparelho atrasado 10 min para fingir chegada mais cedo: vale o tempo decorrido, e o gestor confere.
  const atrasado = await guardar({ cpf: CPF_JOAO, pin: PIN_JOAO, decorrido: 3_000, desvio: -10 * 60_000 })
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
  await recusa({ pin: '9999' }, /CPF ou PIN incorretos/)
  await recusa({ ancora: { ...semInternet.ancora, em: semInternet.ancora.em - 3_600_000 } }, /confirmação do servidor/)
  await recusa({ dispositivoId: 'disp_outro' }, /outro aparelho/)
  // Guardada pela tela antiga (matrícula, sem CPF): sai da fila com um aviso claro para o gestor.
  await recusa({ cpf: null, matricula: '12' }, /versão antiga do aparelho/)
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
  assert.equal(integridade.ultimoNsr, 6)
  // O aparelho nunca lê a chave privada do servidor.
  await falha(getDoc(doc(aparelho.db, 'sistema', 'semInternet')), 'permission-denied')
  await falha(getDoc(doc(admin.db, 'sistema', 'semInternet')), 'permission-denied')
})

await etapa('celular pessoal: só o dono bate ponto nele (digitando só o PIN), e a gestora muda o uso pelo painel', async () => {
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
  // Outro funcionário, mesmo com o PIN certo dele (e até mandando o CPF dele), é recusado no celular da Maria.
  const recusa = await falha(bater(PIN_JOAO), 'functions/permission-denied', /CPF ou PIN incorretos/)
  assert.equal(recusa.details?.motivo, 'credenciais-invalidas')
  await falha(
    pessoal.chamar('registrarPonto', { idRequisicao: id(), cpf: CPF_JOAO, pin: PIN_JOAO, foto: jpeg(900), miniatura: jpeg(200) }),
    'functions/permission-denied',
  )
  assert.equal((await bater(PIN_MARIA)).funcionarioNome, 'Maria Souza')

  // Só quem gerencia a empresa muda o uso; vale na hora no servidor e na próxima sincronização da tela.
  const mudar = (quem, funcionarioId) => quem.chamar('salvarDispositivo', { empresaId: empresaA, dispositivoId: user.uid, funcionarioId })
  await falha(mudar(outraGestora, null), 'functions/permission-denied')
  await falha(mudar(pessoal, null), 'functions/permission-denied')
  await falha(mudar(gestora, 'nao-existe'), 'functions/invalid-argument', /Dono do aparelho/)
  await mudar(gestora, null)
  assert.equal((await pessoal.chamar('sincronizarDispositivo')).dispositivo.funcionario, null)
  // Virou aparelho da loja: o PIN sozinho não basta, precisa do CPF.
  await falha(bater(PIN_JOAO), 'functions/permission-denied')
  const peloCpf = await pessoal.chamar('registrarPonto', { idRequisicao: id(), cpf: CPF_JOAO, pin: PIN_JOAO, foto: jpeg(900), miniatura: jpeg(200) })
  assert.equal(peloCpf.funcionarioNome, 'João Lima')
  await mudar(gestora, joao)
  assert.deepEqual((await pessoal.chamar('sincronizarDispositivo')).dispositivo.funcionario, { nome: 'João Lima' })
  await falha(bater(PIN_MARIA), 'functions/permission-denied', /CPF ou PIN incorretos/)
  const usos = (await getDocs(query(collection(gestora.db, 'empresas', empresaA, 'auditoria'), where('acao', '==', 'dispositivo.uso')))).docs
  assert.deepEqual(usos.map((d) => d.get('descricao')).sort(), [
    'Aparelho "Celular da Maria" passou a ser o aparelho da loja (todos os funcionários).',
    'Aparelho "Celular da Maria" passou a ser o celular pessoal de João Lima.',
  ])
  await gestora.chamar('desativarDispositivo', { empresaId: empresaA, dispositivoId: user.uid })
  await falha(mudar(gestora, maria), 'functions/not-found')
})

await etapa('aparelho desativado para de registrar na hora', async () => {
  await gestora.chamar('desativarDispositivo', { empresaId: empresaA, dispositivoId: uidAparelho })
  await falha(
    aparelho.chamar('registrarPonto', { idRequisicao: id(), cpf: CPF_MARIA, pin: PIN_MARIA, foto: jpeg(900), miniatura: jpeg(200) }),
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
