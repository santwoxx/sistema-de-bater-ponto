import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/https";
import { db } from "./admin";
import { autor, exigirAcessoEmpresa } from "./acesso";
import { auditarNa } from "./auditoria";
import { credenciaisComPinAntigo, donosDoPinAntigo, indiceDoPin } from "./pin";
import {
  booleano,
  cpf,
  dataISO,
  idDocumento,
  idOpcional,
  jornada,
  matricula,
  objeto,
  pin,
  texto,
  textoOpcional,
} from "./validacao";

export async function salvarFuncionario(request: CallableRequest) {
  const dados = objeto(request.data);
  const empresaId = idDocumento(dados.empresaId, "Empresa");
  const { usuario } = await exigirAcessoEmpresa(request, empresaId);

  const id = idOpcional(dados.id, "Funcionário");
  const nome = texto(dados.nome, "Nome", { min: 3, max: 120 });
  const cpfFuncionario = cpf(dados.cpf);
  const matriculaFuncionario = matricula(dados.matricula);
  const cargo = textoOpcional(dados.cargo, "Cargo", { max: 80 });
  const admissao = dados.admissao ? dataISO(dados.admissao, "Admissão") : null;
  const jornadaSemanal = jornada(dados.jornada);
  const ativo = dados.ativo === undefined ? true : booleano(dados.ativo, "Ativo");
  const novoPin = dados.pin ? pin(dados.pin) : null;

  if (!id && !novoPin) throw new HttpsError("invalid-argument", "PIN: defina o PIN de 4 números do funcionário.");

  const empresaRef = db.doc(`empresas/${empresaId}`);
  const colecao = empresaRef.collection("funcionarios");
  const ref = id ? colecao.doc(id) : colecao.doc();
  const credenciaisRef = empresaRef.collection("credenciais").doc(ref.id);
  // O PIN não é gravado: só o índice dele na empresa (ver pin.ts).
  const indice = novoPin ? await indiceDoPin(empresaId, novoPin) : null;
  const pinRef = indice ? empresaRef.collection("pins").doc(indice) : null;

  // Transação: garante matrícula, CPF e PIN únicos mesmo com dois cadastros
  // simultâneos (o PIN sozinho identifica o funcionário no aparelho).
  await db.runTransaction(async (tx) => {
    const [mesmaMatricula, mesmoCpf, atual, credenciais, donoDoPin, pinsAntigos] = await Promise.all([
      tx.get(colecao.where("matricula", "==", matriculaFuncionario).limit(2)),
      tx.get(colecao.where("cpf", "==", cpfFuncionario).limit(2)),
      id ? tx.get(ref) : Promise.resolve(null),
      tx.get(credenciaisRef),
      pinRef ? tx.get(pinRef) : Promise.resolve(null),
      novoPin ? tx.get(credenciaisComPinAntigo(empresaRef)) : Promise.resolve(null),
    ]);
    if (id && !atual?.exists) throw new HttpsError("not-found", "Funcionário não encontrado.");
    if (mesmaMatricula.docs.some((doc) => doc.id !== ref.id)) {
      throw new HttpsError("already-exists", `A matrícula ${matriculaFuncionario} já pertence a outro funcionário.`);
    }
    if (mesmoCpf.docs.some((doc) => doc.id !== ref.id)) {
      throw new HttpsError("already-exists", "Este CPF já está cadastrado nesta empresa.");
    }
    if (novoPin) {
      const dono: unknown = donoDoPin?.get("funcionarioId");
      const antigos = await donosDoPinAntigo(pinsAntigos?.docs.filter((doc) => doc.id !== ref.id) ?? [], empresaId, novoPin);
      if ((typeof dono === "string" && dono !== ref.id) || antigos.length > 0) {
        throw new HttpsError(
          "already-exists",
          "Este PIN já é de outro funcionário desta empresa (cada um precisa de um PIN diferente). Escolha outro ou clique em Gerar PIN.",
        );
      }
    }

    const agora = FieldValue.serverTimestamp();
    tx.set(
      ref,
      {
        nome,
        cpf: cpfFuncionario,
        matricula: matriculaFuncionario,
        cargo,
        admissao,
        jornada: jornadaSemanal,
        ativo,
        atualizadoEm: agora,
        ...(id ? {} : { criadoEm: agora, pinAtivo: false }),
        // PIN antigo (provisório/pessoal, com matrícula) dá lugar ao de 4 números.
        ...(indice ? { pinAtivo: true, pinAtualizadoEm: agora, pinDefinido: FieldValue.delete(), pinProvisorio: FieldValue.delete() } : {}),
      },
      { merge: true },
    );
    if (indice && pinRef) {
      // O PIN anterior deixa de valer (e fica livre para outro funcionário).
      const anterior: unknown = credenciais.get("pinIndice");
      if (typeof anterior === "string" && anterior !== indice) tx.delete(empresaRef.collection("pins").doc(anterior));
      tx.set(pinRef, { funcionarioId: ref.id, criadoEm: agora });
      // Trocar o PIN também desbloqueia quem errou demais.
      tx.set(
        credenciaisRef,
        {
          pinIndice: indice,
          pinChave: FieldValue.delete(),
          pinAtualizadoEm: agora,
          falhas: 0,
          bloqueios: 0,
          bloqueadoAte: null,
          pinHash: FieldValue.delete(),
          pinSal: FieldValue.delete(),
          provisorio: FieldValue.delete(),
        },
        { merge: true },
      );
    }
    auditarNa(tx, {
      empresaId,
      autor: autor(usuario),
      acao: id ? "funcionario.atualizado" : "funcionario.criado",
      descricao:
        `Funcionário ${nome} (matrícula ${matriculaFuncionario}) ${id ? "atualizado" : "cadastrado"}` +
        `${novoPin && id ? "; PIN redefinido" : ""}${ativo ? "" : "; inativo"}.`,
      detalhes: { funcionarioId: ref.id, matricula: matriculaFuncionario, cargo, ativo, pinAlterado: Boolean(novoPin) },
    });
  });

  return { id: ref.id };
}
