import { randomUUID } from "node:crypto";
import { FieldValue, Timestamp, type DocumentData, type DocumentSnapshot, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { bucket } from "./admin";
import { HASH_INICIAL, hashDoRegistro } from "./cadeia";
import { sha256 } from "./seguranca";
import { dataLocal, horaLocal } from "./tempo";

// Gravação de uma marcação do aparelho, comum à batida online (ponto.ts) e à
// batida feita sem internet e enviada depois (semInternet.ts).

export const MAX_FOTO_BYTES = 400 * 1024;

/** Batida feita sem internet: quando chegou e como o horário foi apurado. */
export interface SemInternetRegistro {
  recebidoEm: Date;
  /** O horário merece conferência do gestor (relógio do aparelho mudou, aparelho reiniciado...). */
  conferir: boolean;
  motivo: string | null;
  /** Horário pelo relógio do aparelho e pelo tempo decorrido desde a última conexão. */
  horarioRelogio: Date;
  horarioDecorrido: Date | null;
  ultimaConexaoEm: Date;
}

/** Grava a foto antes do registro, com nome único por tentativa (o registro aponta para ela). */
export async function guardarFoto(params: {
  empresaId: string;
  registroId: string;
  dataLocal: string;
  foto: Buffer;
  funcionarioId: string;
  dispositivoId: string;
}): Promise<{ fotoPath: string; fotoSha256: string; apagar: () => Promise<void> }> {
  const { empresaId, registroId, foto, funcionarioId, dispositivoId } = params;
  const fotoPath = `empresas/${empresaId}/registros/${params.dataLocal.slice(0, 7)}/${registroId}-${randomUUID().slice(0, 8)}.jpg`;
  const arquivo = bucket().file(fotoPath);
  // Sem token de download: a foto só sai pelo servidor (função obterFoto), para quem tem acesso à empresa.
  await arquivo.save(foto, {
    resumable: false,
    contentType: "image/jpeg",
    metadata: { cacheControl: "private, max-age=31536000", metadata: { empresaId, funcionarioId, dispositivoId } },
  });
  return {
    fotoPath,
    fotoSha256: sha256(foto),
    apagar: () => arquivo.delete({ ignoreNotFound: true }).then(
      () => undefined,
      () => undefined,
    ),
  };
}

export interface NovaMarcacao {
  empresaId: string;
  funcionarioId: string;
  funcionario: DocumentData;
  dispositivoId: string;
  dispositivoNome: string;
  dataHora: Date;
  fuso: string;
  fotoPath: string;
  fotoSha256: string;
  miniatura: Buffer;
  semInternet?: SemInternetRegistro;
}

/**
 * Monta o registro com o NSR seguinte e o hash encadeado ao anterior (ver
 * cadeia.ts), a partir do contador da empresa lido na mesma transação.
 * Devolve o registro e o novo valor do contador.
 */
export function montarMarcacao(controle: DocumentSnapshot, m: NovaMarcacao): { registro: DocumentData; contador: DocumentData } {
  const nsr = ((controle.get("ultimoNsr") as number | undefined) ?? 0) + 1;
  const hashAnterior = (controle.get("ultimoHash") as string | undefined) ?? HASH_INICIAL;
  const campos = {
    hashAnterior,
    nsr,
    empresaId: m.empresaId,
    funcionarioId: m.funcionarioId,
    funcionarioCpf: String(m.funcionario.cpf),
    dataHora: m.dataHora,
    dataLocal: dataLocal(m.dataHora, m.fuso),
    horaLocal: horaLocal(m.dataHora, m.fuso),
    fotoSha256: m.fotoSha256,
    dispositivoId: m.dispositivoId,
    semInternet: m.semInternet ? { recebidoEm: m.semInternet.recebidoEm, conferir: m.semInternet.conferir } : null,
  };
  const hash = hashDoRegistro(campos);
  const s = m.semInternet;
  const registro = {
    funcionarioId: m.funcionarioId,
    funcionarioNome: m.funcionario.nome,
    funcionarioMatricula: m.funcionario.matricula,
    funcionarioCpf: campos.funcionarioCpf,
    dataHora: Timestamp.fromDate(m.dataHora),
    dataLocal: campos.dataLocal,
    horaLocal: campos.horaLocal,
    origem: "dispositivo",
    dispositivoId: m.dispositivoId,
    dispositivoNome: m.dispositivoNome,
    nsr,
    hash,
    hashAnterior,
    fotoPath: m.fotoPath,
    fotoSha256: m.fotoSha256,
    miniatura: `data:image/jpeg;base64,${m.miniatura.toString("base64")}`,
    desconsiderado: null,
    ...(s
      ? {
          semInternet: {
            recebidoEm: Timestamp.fromDate(s.recebidoEm),
            conferir: s.conferir,
            motivo: s.motivo,
            horarioRelogio: Timestamp.fromDate(s.horarioRelogio),
            horarioDecorrido: s.horarioDecorrido ? Timestamp.fromDate(s.horarioDecorrido) : null,
            ultimaConexaoEm: Timestamp.fromDate(s.ultimaConexaoEm),
          },
        }
      : {}),
    criadoEm: FieldValue.serverTimestamp(),
  };
  return { registro, contador: { ultimoNsr: nsr, ultimoHash: hash, atualizadoEm: FieldValue.serverTimestamp() } };
}

/** Posição da marcação no dia (1ª, 2ª...), contando só as válidas do mesmo dia até ela. */
export function ordinalNoDia(doDia: QueryDocumentSnapshot[], registroId: string, dataHora: number): number {
  const antes = doDia.filter(
    (doc) => doc.id !== registroId && !doc.get("desconsiderado") && (doc.get("dataHora") as Timestamp).toMillis() <= dataHora,
  ).length;
  return antes + 1;
}

/** Comprovante devolvido ao aparelho. */
export function comprovante(registroId: string, registro: DocumentData, ordinal: number, empresaNome: string) {
  return {
    registroId,
    nsr: registro.nsr as number,
    dataHora: (registro.dataHora as Timestamp).toMillis(),
    dataLocal: registro.dataLocal as string,
    horaLocal: registro.horaLocal as string,
    funcionarioNome: registro.funcionarioNome as string,
    ordinal,
    tipo: ordinal % 2 === 1 ? "entrada" : "saida",
    empresaNome,
    codigoVerificacao: String(registro.hash).slice(0, 12).toUpperCase(),
  };
}
