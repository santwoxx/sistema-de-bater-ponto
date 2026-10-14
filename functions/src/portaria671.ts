import { createHash } from "node:crypto";
import { partesNoFuso } from "./tempo";

// Formatos da Portaria MTP nº 671/2021 para o REP-P (registrador eletrônico de
// ponto via programa): registros da ARP (Anexo IX), Arquivo Fonte de Dados -
// AFD (Anexo V) e Arquivo Eletrônico de Jornada - AEJ (Anexo VI).

/** Identificador do coletor das marcações (AFD, tipo 7, campo 6): o aparelho de ponto é um navegador. */
export const COLETOR_NAVEGADOR = "02";

/** Inclusão ou alteração da identificação do empregador no REP (AFD, tipo 2). */
export interface OperacaoEmpregador {
  tipo: 2;
  /** "1": CNPJ; "2": CPF. */
  tpIdtEmpregador: "1" | "2";
  idtEmpregador: string;
  cnoCaepf: string;
  razaoSocial: string;
  /** Local da prestação do serviço (ou endereço do estabelecimento). */
  local: string;
  /** CPF de quem incluiu ou alterou ("" se o usuário não tem CPF cadastrado). */
  cpfResponsavel: string;
}

/** Inclusão, alteração ou exclusão de empregado no REP (AFD, tipo 5). */
export interface OperacaoEmpregado {
  tipo: 5;
  operacao: "I" | "A" | "E";
  cpf: string;
  nome: string;
  /** Demais dados de identificação do empregado (até 4 caracteres). */
  demais: string;
  cpfResponsavel: string;
}

export type OperacaoRep = OperacaoEmpregador | OperacaoEmpregado;

/** Marcação do REP-P (AFD, tipo 7). */
export interface MarcacaoRep {
  nsr: number;
  /** Data e hora da marcação. */
  dataHora: Date;
  cpf: string;
  /** Data e hora da gravação do registro (na batida sem internet, quando ela chegou). */
  gravadoEm: Date;
  offline: boolean;
}

const dois = (n: number) => String(n).padStart(2, "0");

/** Texto em ISO-8859-1 numa linha só: o que não existe na tabela vira "?". */
export function latin1(texto: string): string {
  return texto.replace(/[\r\n\t]+/g, " ").replace(/[^ -~ -ÿ]/g, "?");
}

/**
 * Campo de largura fixa do AFD: preenchido a partir da esquerda e completado
 * com espaços (o que passar do tamanho é cortado).
 */
export function fixo(valor: string | number, tamanho: number): string {
  return latin1(String(valor)).slice(0, tamanho).padEnd(tamanho, " ");
}

/** Número com zeros à esquerda (NSR e quantidades do AFD). */
export function numero(valor: number, tamanho: number): string {
  return String(valor).padStart(tamanho, "0").slice(-tamanho);
}

/** Só os dígitos (número de registro no INPI, CPF, CNPJ numérico). */
export function digitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

/** Deslocamento do fuso no instante, no formato da portaria: "-0300". */
export function deslocamento(data: Date, fuso: string): string {
  const p = partesNoFuso(data, fuso);
  const minutos = Math.round((Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo) - (data.getTime() - data.getMilliseconds())) / 60_000);
  const absoluto = Math.abs(minutos);
  return `${minutos < 0 ? "-" : "+"}${dois(Math.floor(absoluto / 60))}${dois(absoluto % 60)}`;
}

/** Data e hora da portaria: "2021-04-27T16:44:00-0300" (os segundos são sempre "00"). */
export function dataHoraRep(data: Date, fuso: string): string {
  const p = partesNoFuso(data, fuso);
  return `${p.ano}-${dois(p.mes)}-${dois(p.dia)}T${dois(p.hora)}:${dois(p.minuto)}:00${deslocamento(data, fuso)}`;
}

/**
 * CRC-16 dos registros dos tipos 1 a 5 do AFD. A portaria não diz qual
 * variante: usamos a CRC-16/KERMIT (polinômio 0x1021 refletido, valor inicial
 * 0), sobre os bytes ISO-8859-1 do registro sem o próprio CRC, em 4 dígitos
 * hexadecimais maiúsculos.
 */
export function crc16(registro: string): string {
  let crc = 0;
  for (const byte of Buffer.from(registro, "latin1")) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0x8408 : crc >>> 1;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Campos 1 a 7 do registro do tipo 7 do AFD (a marcação, sem o hash), no fuso da empresa. */
export function inicioDoRegistro7(m: MarcacaoRep, fuso: string): string {
  return (
    numero(m.nsr, 9) +
    "7" +
    dataHoraRep(m.dataHora, fuso) +
    fixo(digitos(m.cpf), 12) +
    dataHoraRep(m.gravadoEm, fuso) +
    COLETOR_NAVEGADOR +
    (m.offline ? "1" : "0")
  );
}

/**
 * Código hash SHA-256 da marcação (AFD, tipo 7, campo 8, e o comprovante do
 * trabalhador): calculado sobre os campos 1 a 7 do registro, como gravados no
 * AFD, seguidos do hash da marcação anterior, se houver.
 */
export function hashDaMarcacaoRep(m: MarcacaoRep, fuso: string, hashAnterior: string): string {
  return createHash("sha256")
    .update(Buffer.from(inicioDoRegistro7(m, fuso) + hashAnterior, "latin1"))
    .digest("hex");
}

/** Na marcação gravada, a data da gravação e se foi sem internet saem dos dados que entram na cadeia de hashes. */
export function marcacaoRepDe(registro: {
  nsr: number;
  dataHora: Date;
  funcionarioCpf: string;
  semInternetRecebidoEm: Date | null;
}): MarcacaoRep {
  return {
    nsr: registro.nsr,
    dataHora: registro.dataHora,
    cpf: registro.funcionarioCpf,
    gravadoEm: registro.semInternetRecebidoEm ?? registro.dataHora,
    offline: registro.semInternetRecebidoEm !== null,
  };
}

/** Tipo do identificador do empregador: "1" para CNPJ (14 caracteres), "2" para CPF (11 dígitos). */
export function tipoDoIdentificador(documento: string): "1" | "2" {
  return documento.length === 11 ? "2" : "1";
}
