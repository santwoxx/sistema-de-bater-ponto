import type { DocumentReference, QueryDocumentSnapshot, Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { db } from "./admin";
import type { Empresa } from "./acesso";
import { operacaoDoDocumento } from "./cadeia";
import type { ConfiguracaoRep } from "./configuracaoRep";
import {
  crc16,
  dataHoraRep,
  digitos,
  fixo,
  hashDaMarcacaoRep,
  inicioDoRegistro7,
  marcacaoRepDe,
  numero,
  tipoDoIdentificador,
  type MarcacaoRep,
} from "./portaria671";
import { dataLocal } from "./tempo";

// Arquivo Fonte de Dados - AFD do REP-P (Portaria 671, art. 81 e Anexo V):
// todos os registros da ARP do período (identificação do empregador, tipo 2;
// empregados, tipo 5; marcações, tipo 7), na ordem do NSR, em texto ISO-8859-1
// com linhas de largura fixa terminadas em CR LF. Gerado quando pedido (o
// Auditor-Fiscal do Trabalho pode pedir a qualquer momento).

/** Última linha do AFD quando a assinatura vai em arquivo separado (.p7s, CAdES). */
export const ASSINATURA_EM_ARQUIVO = "ASSINATURA_DIGITAL_EM_ARQUIVO_P7S";

export interface ArquivoRep {
  nome: string;
  conteudo: Buffer;
  /** Registros de dados no arquivo (sem cabeçalho, trailer e assinatura). */
  quantidade: number;
  /** O que falta para o arquivo ficar completo (INPI, desenvolvedor, CPF de responsáveis, assinatura). */
  avisos: string[];
}

/** Junta as linhas em ISO-8859-1, cada uma terminada em CR LF. */
export function textoDoArquivo(linhas: string[]): Buffer {
  return Buffer.from(linhas.map((linha) => `${linha}\r\n`).join(""), "latin1");
}

/** Marcação do aparelho como vai para o AFD (tipo 7), a partir do registro gravado. */
export function marcacaoDoRegistro(doc: QueryDocumentSnapshot): MarcacaoRep {
  return marcacaoRepDe({
    nsr: Number(doc.get("nsr")),
    dataHora: (doc.get("dataHora") as Timestamp).toDate(),
    funcionarioCpf: String(doc.get("funcionarioCpf")),
    semInternetRecebidoEm: (doc.get("semInternet.recebidoEm") as Timestamp | undefined)?.toDate() ?? null,
  });
}

/** Marcações do aparelho da empresa, só com os campos do AFD (sem as fotos). */
export function consultaDasMarcacoes(empresaRef: DocumentReference) {
  return empresaRef
    .collection("registros")
    .where("origem", "==", "dispositivo")
    .select("nsr", "dataHora", "dataLocal", "funcionarioCpf", "semInternet", "rep");
}

/**
 * Código hash SHA-256 de cada marcação (id do registro → hash). As gravadas
 * antes do REP-P não têm o hash guardado: ele é refeito em sequência desde a primeira.
 */
export function hashesDasMarcacoes(marcacoes: QueryDocumentSnapshot[], fuso: string): Map<string, string> {
  const hashes = new Map<string, string>();
  let anterior = "";
  for (const doc of [...marcacoes].sort((a, b) => Number(a.get("nsr")) - Number(b.get("nsr")))) {
    anterior = (doc.get("rep.hash") as string | undefined) ?? hashDaMarcacaoRep(marcacaoDoRegistro(doc), fuso, anterior);
    hashes.set(doc.id, anterior);
  }
  return hashes;
}

/** Registro com o CRC-16 no fim (tipos 1 a 5). */
function comCrc(registro: string): string {
  return registro + crc16(registro);
}

export async function gerarAfd(empresa: Empresa, de: string, ate: string, configuracao: ConfiguracaoRep, agora = new Date()): Promise<ArquivoRep> {
  if (!empresa.cnpj) throw new HttpsError("failed-precondition", "Cadastre o CNPJ da empresa (Empresas → editar) para gerar o AFD.");
  const fuso = empresa.fusoHorario;
  const empresaRef = db.doc(`empresas/${empresa.id}`);
  const [operacoesSnap, marcacoesSnap] = await Promise.all([
    empresaRef.collection("arp").get(),
    // Todas as marcações do aparelho: as gravadas antes do REP-P não têm o hash
    // SHA-256 guardado, e ele é refeito em sequência desde a primeira.
    consultaDasMarcacoes(empresaRef).get(),
  ]);

  type Item = { nsr: number; linha: string; tipo: 2 | 5 | 7; semResponsavel?: boolean };
  const itens: Item[] = [];

  for (const doc of operacoesSnap.docs) {
    const op = operacaoDoDocumento(doc.data());
    const gravadoEm = (doc.get("gravadoEm") as Timestamp).toDate();
    const dia = dataLocal(gravadoEm, fuso);
    if (!op || dia < de || dia > ate) continue;
    const nsr = Number(doc.get("nsr"));
    const inicio = numero(nsr, 9) + String(op.tipo) + dataHoraRep(gravadoEm, fuso);
    const linha =
      op.tipo === 2
        ? inicio +
          fixo(op.cpfResponsavel, 14) +
          op.tpIdtEmpregador +
          fixo(op.idtEmpregador, 14) +
          fixo(op.cnoCaepf, 14) +
          fixo(op.razaoSocial, 150) +
          fixo(op.local, 100)
        : inicio + op.operacao + fixo(op.cpf, 12) + fixo(op.nome, 52) + fixo(op.demais, 4) + fixo(op.cpfResponsavel, 11);
    itens.push({ nsr, linha: comCrc(linha), tipo: op.tipo, semResponsavel: op.cpfResponsavel === "" });
  }

  const hashes = hashesDasMarcacoes(marcacoesSnap.docs, fuso);
  for (const doc of marcacoesSnap.docs) {
    const dia = String(doc.get("dataLocal"));
    if (dia < de || dia > ate) continue;
    const marcacao = marcacaoDoRegistro(doc);
    itens.push({ nsr: marcacao.nsr, linha: inicioDoRegistro7(marcacao, fuso) + hashes.get(doc.id), tipo: 7 });
  }
  itens.sort((a, b) => a.nsr - b.nsr);

  const desenvolvedor = configuracao.desenvolvedor.documento;
  const cabecalho = comCrc(
    "000000000" +
      "1" +
      tipoDoIdentificador(empresa.cnpj) +
      fixo(empresa.cnpj, 14) +
      fixo("", 14) +
      fixo(empresa.nome, 150) +
      fixo(digitos(configuracao.inpi), 17) +
      de +
      ate +
      dataHoraRep(agora, fuso) +
      "003" +
      (desenvolvedor ? tipoDoIdentificador(desenvolvedor) : " ") +
      fixo(desenvolvedor, 14) +
      fixo("", 30),
  );
  const quantos = (tipo: number) => itens.filter((i) => i.tipo === tipo).length;
  const trailer = "999999999" + [2, 3, 4, 5, 6, 7].map((tipo) => numero(quantos(tipo), 9)).join("") + "9";
  const linhas = [cabecalho, ...itens.map((i) => i.linha), trailer, fixo(ASSINATURA_EM_ARQUIVO, 100)];

  const avisos: string[] = [];
  if (!configuracao.inpi) avisos.push("Número do registro no INPI não configurado (Administração → Portaria 671): vai em branco no arquivo.");
  if (!desenvolvedor) avisos.push("CNPJ ou CPF do desenvolvedor não configurado (Administração → Portaria 671): vai em branco no arquivo.");
  const semResponsavel = itens.filter((i) => i.semResponsavel).length;
  if (semResponsavel > 0) {
    avisos.push(
      `${semResponsavel} registro(s) de inclusão ou alteração sem o CPF do responsável (cadastre o CPF de cada usuário em Usuários; vale para as próximas alterações).`,
    );
  }

  return {
    nome: `AFD${digitos(configuracao.inpi)}${empresa.cnpj}REP_P.txt`,
    conteudo: textoDoArquivo(linhas),
    quantidade: itens.length,
    avisos,
  };
}
