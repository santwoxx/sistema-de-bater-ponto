import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/https";
import { db } from "./admin";
import { autor, exigirAcessoEmpresa } from "./acesso";
import { auditarNa } from "./auditoria";
import { chaveDoPin } from "./pin";
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

export const salvarFuncionario = onCall(async (request) => {
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

  const colecao = db.collection(`empresas/${empresaId}/funcionarios`);
  const ref = id ? colecao.doc(id) : colecao.doc();
  const credenciaisRef = db.doc(`empresas/${empresaId}/credenciais/${ref.id}`);
  // O PIN não é gravado: só a chave dele (ver pin.ts).
  const chave = novoPin ? await chaveDoPin(empresaId, ref.id, novoPin) : null;

  // Transação: garante matrícula e CPF únicos mesmo com dois cadastros simultâneos
  // (o CPF identifica o funcionário no aparelho da loja).
  await db.runTransaction(async (tx) => {
    const [mesmaMatricula, mesmoCpf, atual] = await Promise.all([
      tx.get(colecao.where("matricula", "==", matriculaFuncionario).limit(2)),
      tx.get(colecao.where("cpf", "==", cpfFuncionario).limit(2)),
      id ? tx.get(ref) : Promise.resolve(null),
    ]);
    if (id && !atual?.exists) throw new HttpsError("not-found", "Funcionário não encontrado.");
    if (mesmaMatricula.docs.some((doc) => doc.id !== ref.id)) {
      throw new HttpsError("already-exists", `A matrícula ${matriculaFuncionario} já pertence a outro funcionário.`);
    }
    if (mesmoCpf.docs.some((doc) => doc.id !== ref.id)) {
      throw new HttpsError("already-exists", "Este CPF já está cadastrado nesta empresa.");
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
        ...(chave ? { pinAtivo: true, pinAtualizadoEm: agora, pinDefinido: FieldValue.delete(), pinProvisorio: FieldValue.delete() } : {}),
      },
      { merge: true },
    );
    if (chave) {
      // Trocar o PIN também desbloqueia quem errou demais.
      tx.set(
        credenciaisRef,
        {
          pinChave: chave,
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
});
