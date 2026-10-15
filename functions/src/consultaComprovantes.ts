import { Timestamp, type DocumentData } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/https";
import * as logger from "firebase-functions/logger";
import { db } from "./admin";
import { carregarEmpresa } from "./acesso";
import { consultaDasMarcacoes, hashesDasMarcacoes } from "./afd";
import { carregarCertificado } from "./certificado";
import { carregarConfiguracaoRep } from "./configuracaoRep";
import { buscarDonoDoPin, lerPin, minutosDeBloqueio } from "./identificacao";
import { sha256 } from "./seguranca";
import { dataLocal } from "./tempo";
import { cpfValido, idDocumento, objeto } from "./validacao";

// Comprovantes do trabalhador (Portaria 671, art. 80): numa página aberta, ele
// informa CPF e PIN e baixa o comprovante (PDF assinado) de cada marcação feita
// no aparelho nos últimos dias, sem pedir a ninguém. CPF e PIN errados 5 vezes
// seguidas bloqueiam aquele CPF por 15 minutos (30, 60 se repetir). Cada
// tentativa é contada antes da conferência, como no aparelho.

const DIAS = 31;
const MAX_FALHAS = 5;

function erroCredenciais(): HttpsError {
  return new HttpsError("permission-denied", "CPF ou PIN incorretos.");
}

/** Conta a tentativa (antes da conferência) e diz se o CPF está bloqueado. */
async function reservarTentativa(cpf: string): Promise<void> {
  const ref = db.doc(`consultasComprovante/${sha256(cpf)}`);
  await db.runTransaction(async (tx) => {
    const atual = (await tx.get(ref)).data() ?? {};
    const agora = Date.now();
    const bloqueadoAte = (atual.bloqueadoAte as Timestamp | null | undefined)?.toMillis() ?? 0;
    if (bloqueadoAte > agora) {
      const minutos = Math.max(1, Math.ceil((bloqueadoAte - agora) / 60_000));
      throw new HttpsError("resource-exhausted", `Muitas tentativas erradas. Tente de novo em ${minutos} min.`);
    }
    const falhas = ((atual.falhas as number | undefined) ?? 0) + 1;
    if (falhas >= MAX_FALHAS) {
      const bloqueios = ((atual.bloqueios as number | undefined) ?? 0) + 1;
      tx.set(ref, { falhas: 0, bloqueios, bloqueadoAte: Timestamp.fromMillis(agora + minutosDeBloqueio(bloqueios) * 60_000) });
    } else {
      tx.set(ref, { falhas }, { merge: true });
    }
  });
}

async function confirmarAcerto(cpf: string) {
  await db.doc(`consultasComprovante/${sha256(cpf)}`).delete();
}

export const comprovantes = onCall({ memory: "512MiB", maxInstances: 2 }, async (request) => {
  const dados = objeto(request.data);
  const cpf = String(dados.cpf ?? "").replace(/\D/g, "");
  if (!cpfValido(cpf)) throw new HttpsError("invalid-argument", "CPF inválido: confira os números.");
  const pin = lerPin(dados);
  const registroId = dados.registroId === undefined || dados.registroId === null ? null : idDocumento(dados.registroId, "Marcação");

  await reservarTentativa(cpf);
  const dono = await buscarDonoDoPin(pin);
  const funcionarioSnap = dono ? await db.doc(`empresas/${dono.empresaId}/funcionarios/${dono.funcionarioId}`).get() : null;
  // O PIN acha o funcionário; o CPF tem que ser o dele (os dois juntos identificam).
  if (!dono || funcionarioSnap?.get("cpf") !== cpf) {
    logger.warn("CPF ou PIN incorretos na consulta de comprovantes");
    throw erroCredenciais();
  }
  await confirmarAcerto(cpf);

  const empresa = await carregarEmpresa(dono.empresaId);
  const empresaRef = db.doc(`empresas/${dono.empresaId}`);
  const desde = dataLocal(new Date(Date.now() - DIAS * 86_400_000), empresa.fusoHorario);
  const doFuncionario = await empresaRef
    .collection("registros")
    .where("funcionarioId", "==", dono.funcionarioId)
    .where("dataLocal", ">=", desde)
    .select("nsr", "dataHora", "dataLocal", "horaLocal", "origem")
    .get();
  // Só as marcações feitas no aparelho têm comprovante (as incluídas pelo gestor não são do REP).
  const marcacoes = doFuncionario.docs.filter((doc) => doc.get("origem") === "dispositivo");

  if (!registroId) {
    return {
      trabalhador: String(funcionarioSnap.get("nome")),
      empresa: empresa.nome,
      dias: DIAS,
      comprovantes: marcacoes
        .map((doc) => ({
          registroId: doc.id,
          nsr: Number(doc.get("nsr")),
          dataHora: (doc.get("dataHora") as Timestamp).toMillis(),
          dataLocal: String(doc.get("dataLocal")),
          horaLocal: String(doc.get("horaLocal")).slice(0, 5),
        }))
        .sort((a, b) => b.dataHora - a.dataHora),
    };
  }

  const escolhida = marcacoes.find((doc) => doc.id === registroId);
  if (!escolhida) throw new HttpsError("not-found", "Comprovante não encontrado.");
  const [registro, empresaSnap, configuracao, certificado] = await Promise.all([
    empresaRef.collection("registros").doc(registroId).get(),
    empresaRef.get(),
    carregarConfiguracaoRep(),
    carregarCertificado(),
  ]);
  const r = registro.data() as DocumentData;
  let hash = (r.rep?.hash as string | undefined) ?? "";
  // Marcação de antes do REP-P: o hash é refeito na sequência das marcações da empresa.
  if (!hash) hash = hashesDasMarcacoes((await consultaDasMarcacoes(empresaRef).get()).docs, empresa.fusoHorario).get(registroId) ?? "";
  // O gerador de PDF (pdf-lib) só carrega para baixar um comprovante, não para a lista.
  const { gerarComprovantePdf } = await import("./comprovantePdf.js");
  const pdf = await gerarComprovantePdf(
    {
      nsr: Number(r.nsr),
      empregador: { nome: empresa.nome, documento: empresa.cnpj, endereco: String(empresaSnap.get("endereco") ?? "") },
      trabalhador: { nome: String(r.funcionarioNome), cpf: String(r.funcionarioCpf) },
      dataHora: (r.dataHora as Timestamp).toDate(),
      fuso: empresa.fusoHorario,
      inpi: configuracao.inpi,
      hash,
    },
    certificado,
  );
  logger.info("Comprovante baixado pelo trabalhador", { empresaId: dono.empresaId, registroId });
  return { nome: `comprovante-NSR-${String(r.nsr).padStart(9, "0")}.pdf`, pdf: pdf.toString("base64") };
});
