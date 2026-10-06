// Teste de ponta a ponta contra os emuladores do Firebase (nada vai para a nuvem).
// Exige Java 21+ e o Firebase CLI. Na pasta "web":  npm run test:e2e

import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth'
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  setDoc,
  where,
} from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions'
import { connectStorageEmulator, getDownloadURL, getStorage, ref } from 'firebase/storage'

const PROJETO = process.env.GCLOUD_PROJECT || 'demo-ponto'
const config = { apiKey: 'demo-chave', projectId: PROJETO, storageBucket: `${PROJETO}.appspot.com`, appId: 'demo-app' }

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

// "JPEG" sintético: o servidor confere a assinatura do arquivo e o tamanho.
function jpeg(tamanho) {
  return `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(tamanho)]).toString('base64')}`
}
const sha256 = (dados) => createHash('sha256').update(dados).digest('hex')
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

await etapa('configuração inicial cria o administrador uma única vez', async () => {
  assert.equal((await getDoc(doc(anonimo.db, 'sistema', 'estado'))).exists(), false)
  await anonimo.chamar('configurarPrimeiroAdmin', { nome: 'Ana Admin', email: 'admin@teste.com', senha: 'senha-forte-123' })
  await falha(
    anonimo.chamar('configurarPrimeiroAdmin', { nome: 'Intruso', email: 'x@teste.com', senha: 'senha-forte-123' }),
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

await etapa('funcionário: matrícula normalizada, PIN fraco recusado, duplicidade bloqueada', async () => {
  const dados = { empresaId: empresaA, nome: 'Maria Souza', cpf: '529.982.247-25', cargo: 'Vendedora', admissao: null, jornada: JORNADA, ativo: true }
  await falha(admin.chamar('salvarFuncionario', { ...dados, matricula: '12', pin: '1234' }), 'functions/invalid-argument', /PIN/)
  maria = (await admin.chamar('salvarFuncionario', { ...dados, matricula: '0012', pin: '2580' })).id
  const snap = await getDoc(doc(admin.db, 'empresas', empresaA, 'funcionarios', maria))
  assert.equal(snap.get('matricula'), '12')
  assert.equal(snap.get('pinDefinido'), true)
  assert.equal(snap.get('pinHash'), undefined)
  await falha(
    admin.chamar('salvarFuncionario', { ...dados, nome: 'Outra Pessoa', cpf: '111.444.777-35', matricula: '12', pin: '9137' }),
    'functions/already-exists',
    /matrícula/,
  )
  await falha(admin.chamar('salvarFuncionario', { ...dados, matricula: '99', pin: '9137' }), 'functions/already-exists', /CPF/)
})

await etapa('ninguém lê o hash do PIN nem grava direto no banco', async () => {
  await falha(getDoc(doc(admin.db, 'empresas', empresaA, 'credenciais', maria)), 'permission-denied')
  await falha(setDoc(doc(admin.db, 'empresas', empresaA, 'funcionarios', maria), { nome: 'Hack' }), 'permission-denied')
  await falha(setDoc(doc(admin.db, 'empresas', empresaA, 'registros', 'falso'), { nsr: 1 }), 'permission-denied')
})

await etapa('gestora só acessa as empresas liberadas para ela', async () => {
  await admin.chamar('salvarUsuario', {
    nome: 'Gisele Gestora',
    email: 'gestora@teste.com',
    senha: 'senha-gestora-1',
    papel: 'gestor',
    empresas: [empresaA],
    ativo: true,
  })
  await gestora.entrar('gestora@teste.com', 'senha-gestora-1')
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
      pin: '1357',
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

await etapa('gestora ativa um aparelho; ele só registra ponto', async () => {
  credAparelho = await gestora.chamar('ativarDispositivo', { empresaId: empresaA, nome: 'Tablet do caixa' })
  const { user } = await aparelho.entrar(credAparelho.email, credAparelho.senha)
  uidAparelho = user.uid
  const token = await user.getIdTokenResult()
  assert.equal(token.claims.papel, 'dispositivo')
  assert.equal(token.claims.empresaId, empresaA)
  assert.equal((await getDoc(doc(aparelho.db, 'empresas', empresaA))).get('nome'), 'Loja Centro')
  await falha(getDocs(collection(aparelho.db, 'empresas', empresaA, 'funcionarios')), 'permission-denied')
  await falha(getDocs(collection(aparelho.db, 'empresas', empresaA, 'registros')), 'permission-denied')
  await falha(getDoc(doc(aparelho.db, 'empresas', empresaB)), 'permission-denied')
  await falha(aparelho.chamar('salvarFuncionario', { empresaId: empresaA }), 'functions/permission-denied')
  const sinc = await aparelho.chamar('sincronizarDispositivo')
  assert.equal(sinc.ativo, true)
  assert.equal(sinc.empresa.nome, 'Loja Centro')
  assert.ok(Math.abs(sinc.agora - Date.now()) < 60_000)
})

const fotoMaria = jpeg(3000)
await etapa('registro de ponto com foto gera NSR, hash e comprovante', async () => {
  const idRequisicao = id()
  primeiro = await aparelho.chamar('registrarPonto', { idRequisicao, matricula: '0012', pin: '2580', foto: fotoMaria, miniatura: jpeg(500) })
  assert.equal(primeiro.nsr, 1)
  assert.equal(primeiro.tipo, 'entrada')
  assert.equal(primeiro.ordinal, 1)
  assert.equal(primeiro.funcionarioNome, 'Maria Souza')
  assert.equal(primeiro.dataLocal, dataSaoPaulo())
  assert.ok(Math.abs(primeiro.dataHora - Date.now()) < 60_000)

  // Reenvio da mesma requisição (ex.: internet caiu na resposta) não duplica.
  const reenvio = await aparelho.chamar('registrarPonto', { idRequisicao, matricula: '12', pin: '2580', foto: fotoMaria, miniatura: jpeg(500) })
  assert.equal(reenvio.nsr, 1)
  assert.equal(reenvio.registroId, primeiro.registroId)
})

await etapa('batida repetida em seguida é bloqueada; PIN errado e matrícula inexistente recusados', async () => {
  const novo = () => ({ idRequisicao: id(), matricula: '12', pin: '2580', foto: jpeg(1000), miniatura: jpeg(300) })
  await falha(aparelho.chamar('registrarPonto', novo()), 'functions/failed-precondition', /já registrado/)
  await falha(aparelho.chamar('registrarPonto', { ...novo(), pin: '9999' }), 'functions/permission-denied', /inválidos/)
  await falha(aparelho.chamar('registrarPonto', { ...novo(), matricula: '4040' }), 'functions/permission-denied', /inválidos/)
  await falha(aparelho.chamar('registrarPonto', { ...novo(), foto: 'data:image/jpeg;base64,AAAA' }), 'functions/invalid-argument')
})

await etapa('gestora vê a marcação, a foto confere com o hash e a cadeia é verificável', async () => {
  const snaps = await getDocs(collection(gestora.db, 'empresas', empresaA, 'registros'))
  assert.equal(snaps.size, 1)
  const r = snaps.docs[0].data()
  assert.equal(r.funcionarioId, maria)
  assert.equal(r.origem, 'dispositivo')
  assert.equal(r.dispositivoId, uidAparelho)
  assert.equal(r.hashAnterior, '0'.repeat(64))
  const esperado = sha256(
    [r.hashAnterior, r.nsr, empresaA, r.funcionarioId, r.funcionarioCpf, r.dataHora.toDate().toISOString(), r.fotoSha256, r.dispositivoId].join('|'),
  )
  assert.equal(r.hash, esperado)
  assert.ok(r.miniatura.startsWith('data:image/jpeg;base64,'))

  const url = await getDownloadURL(ref(gestora.storage, r.fotoPath))
  const bytes = Buffer.from(await (await fetch(url)).arrayBuffer())
  assert.equal(sha256(bytes), r.fotoSha256)
  assert.equal(bytes.toString('base64'), fotoMaria.split(',')[1])
})

await etapa('foto não é visível para quem não tem acesso à empresa', async () => {
  await admin.chamar('salvarUsuario', {
    nome: 'Olga Outra',
    email: 'outra@teste.com',
    senha: 'senha-outra-12',
    papel: 'gestor',
    empresas: [empresaB],
    ativo: true,
  })
  await outraGestora.entrar('outra@teste.com', 'senha-outra-12')
  const r = (await getDocs(collection(gestora.db, 'empresas', empresaA, 'registros'))).docs[0].data()
  await falha(getDownloadURL(ref(outraGestora.storage, r.fotoPath)), 'storage/unauthorized')
  await falha(getDownloadURL(ref(aparelho.storage, r.fotoPath)), 'storage/unauthorized')
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
  const segundo = await aparelho.chamar('registrarPonto', { idRequisicao: id(), matricula: '12', pin: '2580', foto: jpeg(1200), miniatura: jpeg(300) })
  assert.equal(segundo.nsr, 2)
  assert.equal(segundo.tipo, 'saida')
  assert.equal(segundo.ordinal, 2)
  const regs = (await getDocs(query(collection(gestora.db, 'empresas', empresaA, 'registros'), orderBy('nsr')))).docs.map((d) => d.data())
  assert.equal(regs[1].hashAnterior, regs[0].hash)
})

await etapa('5 PINs errados bloqueiam a matrícula; redefinir o PIN desbloqueia', async () => {
  const tentativa = (pin) => aparelho.chamar('registrarPonto', { idRequisicao: id(), matricula: '7', pin, foto: jpeg(800), miniatura: jpeg(200) })
  for (let i = 0; i < 5; i++) await falha(tentativa('0001'), 'functions/permission-denied')
  await falha(tentativa('1357'), 'functions/resource-exhausted', /Muitas tentativas/)
  await gestora.chamar('salvarFuncionario', {
    empresaId: empresaA,
    id: joao,
    nome: 'João Lima',
    cpf: '11144477735',
    matricula: '7',
    cargo: '',
    admissao: null,
    jornada: JORNADA,
    ativo: true,
    pin: '8642',
  })
  const ok = await tentativa('8642')
  assert.equal(ok.nsr, 3)
  assert.equal(ok.funcionarioNome, 'João Lima')
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

await etapa('solicitações: funcionário pede no aparelho, gestora aprova ou recusa, admin registra pelo painel', async () => {
  const ontem = dataSaoPaulo(-1)
  const pedido = { matricula: '7', pin: '8642', data: ontem, hora: '18:00', motivo: 'Esqueci de registrar', miniatura: jpeg(400) }
  await falha(aparelho.chamar('solicitarMarcacao', { ...pedido, pin: '0001' }), 'functions/permission-denied', /inválidos/)
  await falha(aparelho.chamar('solicitarMarcacao', { ...pedido, data: dataSaoPaulo(1) }), 'functions/invalid-argument', /futuro/)
  await falha(aparelho.chamar('solicitarMarcacao', { ...pedido, data: dataSaoPaulo(-40) }), 'functions/invalid-argument', /últimos/)
  const criada = await aparelho.chamar('solicitarMarcacao', pedido)
  assert.equal(criada.funcionarioNome, 'João Lima')
  await falha(aparelho.chamar('solicitarMarcacao', pedido), 'functions/already-exists', /pendente/)

  // Enquanto pendente, não vira marcação.
  const doDia = () =>
    getDocs(query(collection(gestora.db, 'empresas', empresaA, 'registros'), where('funcionarioId', '==', joao), where('dataLocal', '==', ontem)))
  assert.equal((await doDia()).size, 0)
  const pendente = await getDoc(doc(gestora.db, 'empresas', empresaA, 'solicitacoes', criada.id))
  assert.equal(pendente.get('status'), 'pendente')
  assert.equal(pendente.get('origem'), 'funcionario')
  assert.ok(pendente.get('miniatura').startsWith('data:image/jpeg;base64,'))

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
  assert.match(registro.get('justificativa'), /Esqueci de registrar/)
  const fechada = await getDoc(doc(gestora.db, 'empresas', empresaA, 'solicitacoes', criada.id))
  assert.equal(fechada.get('status'), 'aprovada')
  assert.equal(fechada.get('decididoPor').nome, 'Gisele Gestora')
  await falha(gestora.chamar('decidirSolicitacao', decisao), 'functions/failed-precondition')
  await falha(aparelho.chamar('solicitarMarcacao', pedido), 'functions/already-exists', /marcação/)

  // Recusa exige motivo e não cria marcação.
  const outra = await aparelho.chamar('solicitarMarcacao', { ...pedido, hora: '12:00' })
  await falha(
    gestora.chamar('decidirSolicitacao', { empresaId: empresaA, solicitacaoId: outra.id, aprovar: false }),
    'functions/invalid-argument',
  )
  await gestora.chamar('decidirSolicitacao', { empresaId: empresaA, solicitacaoId: outra.id, aprovar: false, motivoRecusa: 'Estava de folga' })
  assert.equal((await getDoc(doc(gestora.db, 'empresas', empresaA, 'solicitacoes', outra.id))).get('status'), 'recusada')
  assert.equal((await doDia()).size, 1)

  // Pelo painel: o admin registra em nome do funcionário, já aprovada; ou deixa pendente.
  const peloAdmin = await admin.chamar('criarSolicitacao', {
    empresaId: empresaA,
    funcionarioId: joao,
    data: ontem,
    hora: '08:00',
    motivo: 'Avisou por telefone',
    aprovarAgora: true,
  })
  assert.ok(peloAdmin.registroId)
  assert.equal((await getDoc(doc(admin.db, 'empresas', empresaA, 'solicitacoes', peloAdmin.id))).get('status'), 'aprovada')
  const paraAnalise = await gestora.chamar('criarSolicitacao', {
    empresaId: empresaA,
    funcionarioId: joao,
    data: ontem,
    hora: '13:00',
    motivo: 'Confirmar com o gerente',
    aprovarAgora: false,
  })
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

await etapa('auditoria registra as ações; a do sistema é só do admin', async () => {
  const acoes = (await getDocs(collection(gestora.db, 'empresas', empresaA, 'auditoria'))).docs.map((d) => d.get('acao'))
  for (const acao of [
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
  ]) {
    assert.ok(acoes.includes(acao), `faltou ${acao} na auditoria`)
  }
  await falha(getDocs(collection(gestora.db, 'auditoria')), 'permission-denied')
  const sistema = (await getDocs(collection(admin.db, 'auditoria'))).docs.map((d) => d.get('acao'))
  assert.ok(sistema.includes('empresa.criada') && sistema.includes('usuario.criado') && sistema.includes('sistema.configurado'))
})

await etapa('aparelho desativado para de registrar na hora', async () => {
  await gestora.chamar('desativarDispositivo', { empresaId: empresaA, dispositivoId: uidAparelho })
  await falha(
    aparelho.chamar('registrarPonto', { idRequisicao: id(), matricula: '12', pin: '2580', foto: jpeg(900), miniatura: jpeg(200) }),
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
