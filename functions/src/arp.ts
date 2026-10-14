import { Timestamp, type DocumentData, type DocumentReference, type DocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import { db } from "./admin";
import { HASH_INICIAL, hashDaOperacao } from "./cadeia";
import { digitos, hashDaMarcacaoRep, marcacaoRepDe, tipoDoIdentificador, type OperacaoEmpregado, type OperacaoEmpregador, type OperacaoRep } from "./portaria671";

// Armazenamento de Registro de Ponto (ARP, Portaria 671, Anexo IX). Além das
// marcações (empresas/{id}/registros, tipo 7 do AFD), ficam gravadas com NSR,
// na mesma sequência por empresa, a inclusão e as alterações do empregador
// (tipo 2) e a inclusão, alteração e exclusão de empregados (tipo 5), em
// empresas/{id}/arp. Nada disso é apagado ou alterado depois.

export interface Contador {
  ultimoNsr: number;
  ultimoHash: string;
}

export function contadorDe(controle: DocumentSnapshot): Contador {
  return {
    ultimoNsr: (controle.get("ultimoNsr") as number | undefined) ?? 0,
    ultimoHash: (controle.get("ultimoHash") as string | undefined) ?? HASH_INICIAL,
  };
}

/** Id do documento de uma operação na ARP: o NSR com 9 dígitos (a ordem dos ids é a do NSR). */
export function idDoNsr(nsr: number): string {
  return String(nsr).padStart(9, "0");
}

/**
 * Grava as operações com os NSRs seguintes, encadeadas na cadeia de hashes.
 * Chamar depois de todas as leituras da transação; quem chama grava o contador
 * devolvido no controle da empresa.
 */
export function gravarOperacoes(
  tx: Transaction,
  empresaRef: DocumentReference,
  contador: Contador,
  operacoes: OperacaoRep[],
  agora: Date,
): Contador {
  let { ultimoNsr, ultimoHash } = contador;
  for (const operacao of operacoes) {
    const nsr = ultimoNsr + 1;
    const hash = hashDaOperacao({ hashAnterior: ultimoHash, nsr, empresaId: empresaRef.id, gravadoEm: agora, operacao });
    tx.create(empresaRef.collection("arp").doc(idDoNsr(nsr)), {
      ...operacao,
      nsr,
      gravadoEm: Timestamp.fromDate(agora),
      hash,
      hashAnterior: ultimoHash,
    });
    ultimoNsr = nsr;
    ultimoHash = hash;
  }
  return { ultimoNsr, ultimoHash };
}

/** Identificação do empregador como vai para a ARP (tipo 2). */
export function operacaoEmpregador(empresa: DocumentData, cpfResponsavel: string): OperacaoEmpregador {
  const documento = String(empresa.cnpj ?? "");
  return {
    tipo: 2,
    tpIdtEmpregador: tipoDoIdentificador(documento),
    idtEmpregador: documento,
    cnoCaepf: "",
    razaoSocial: String(empresa.nome ?? ""),
    local: String(empresa.endereco ?? ""),
    cpfResponsavel: digitos(cpfResponsavel),
  };
}

/** Mudou algo da identificação do empregador que vai para a ARP? */
export function empregadorMudou(antes: DocumentData, depois: DocumentData): boolean {
  const a = operacaoEmpregador(antes, "");
  const d = operacaoEmpregador(depois, "");
  return a.idtEmpregador !== d.idtEmpregador || a.razaoSocial !== d.razaoSocial || a.local !== d.local;
}

/** Inclusão, alteração ou exclusão de um empregado na ARP (tipo 5). */
export function operacaoEmpregado(operacao: OperacaoEmpregado["operacao"], funcionario: DocumentData, cpfResponsavel: string): OperacaoEmpregado {
  return {
    tipo: 5,
    operacao,
    cpf: digitos(String(funcionario.cpf ?? "")),
    nome: String(funcionario.nome ?? ""),
    demais: "",
    cpfResponsavel: digitos(cpfResponsavel),
  };
}

/**
 * O que o cadastro de um empregado muda no REP: entrar ativo é inclusão; sair
 * de ativo, exclusão (ele deixa de bater ponto); trocar nome, CPF ou PIN (o que
 * o identifica no REP), alteração. Mudar só a jornada ou o cargo não é operação do REP.
 */
export function operacaoDoCadastro(antes: DocumentData | null, depois: DocumentData, pinAlterado: boolean): OperacaoEmpregado["operacao"] | null {
  const ativoAntes = antes?.ativo === true;
  const ativoDepois = depois.ativo === true;
  if (!ativoAntes && ativoDepois) return "I";
  if (ativoAntes && !ativoDepois) return "E";
  if (!ativoDepois) return null;
  return antes && (antes.nome !== depois.nome || antes.cpf !== depois.cpf || pinAlterado) ? "A" : null;
}

const iniciadas = new Set<string>();

/**
 * Prepara a ARP da empresa na primeira operação depois desta versão: grava a
 * identificação do empregador e a inclusão dos empregados ativos (com os NSRs
 * seguintes) e refaz o código hash SHA-256 das marcações já feitas, para as
 * próximas continuarem a sequência. Feito uma vez por empresa.
 */
export async function garantirRepIniciado(empresaId: string): Promise<void> {
  if (iniciadas.has(empresaId)) return;
  const empresaRef = db.doc(`empresas/${empresaId}`);
  const controleRef = empresaRef.collection("privado").doc("controle");
  if ((await controleRef.get()).get("repIniciadoEm")) {
    iniciadas.add(empresaId);
    return;
  }
  await db.runTransaction(async (tx) => {
    const controle = await tx.get(controleRef);
    if (controle.get("repIniciadoEm")) return;
    const [empresa, funcionarios, marcacoes] = await Promise.all([
      tx.get(empresaRef),
      tx.get(empresaRef.collection("funcionarios").where("ativo", "==", true)),
      tx.get(empresaRef.collection("registros").where("origem", "==", "dispositivo").select("nsr", "dataHora", "funcionarioCpf", "semInternet")),
    ]);
    const dadosEmpresa = empresa.data();
    if (!dadosEmpresa) return;
    const fuso = String(dadosEmpresa.fusoHorario ?? "America/Sao_Paulo");

    let hashRep = "";
    for (const m of [...marcacoes.docs].sort((a, b) => Number(a.get("nsr")) - Number(b.get("nsr")))) {
      const recebidoEm = (m.get("semInternet.recebidoEm") as Timestamp | undefined)?.toDate() ?? null;
      const marcacao = marcacaoRepDe({
        nsr: Number(m.get("nsr")),
        dataHora: (m.get("dataHora") as Timestamp).toDate(),
        funcionarioCpf: String(m.get("funcionarioCpf")),
        semInternetRecebidoEm: recebidoEm,
      });
      hashRep = hashDaMarcacaoRep(marcacao, fuso, hashRep);
    }

    const criadoEm = (doc: DocumentSnapshot) => (doc.get("criadoEm") as Timestamp | undefined)?.toMillis() ?? 0;
    const agora = new Date();
    const operacoes: OperacaoRep[] = [
      operacaoEmpregador(dadosEmpresa, ""),
      ...[...funcionarios.docs].sort((a, b) => criadoEm(a) - criadoEm(b)).map((f) => operacaoEmpregado("I", f.data(), "")),
    ];
    const contador = gravarOperacoes(tx, empresaRef, contadorDe(controle), operacoes, agora);
    tx.set(controleRef, { ...contador, ultimoHashRep: hashRep, repIniciadoEm: Timestamp.fromDate(agora) }, { merge: true });
  });
  iniciadas.add(empresaId);
}

/** Empresa criada nesta versão: a ARP já começa com a identificação do empregador (NSR 1). */
export function iniciarRepDaEmpresaNova(
  tx: Transaction,
  empresaRef: DocumentReference,
  empresa: DocumentData,
  cpfResponsavel: string,
  agora: Date,
) {
  const contador = gravarOperacoes(tx, empresaRef, { ultimoNsr: 0, ultimoHash: HASH_INICIAL }, [operacaoEmpregador(empresa, cpfResponsavel)], agora);
  tx.set(empresaRef.collection("privado").doc("controle"), { ...contador, ultimoHashRep: "", repIniciadoEm: Timestamp.fromDate(agora) });
}
