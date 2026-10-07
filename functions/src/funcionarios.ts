import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/https";
import { db } from "./admin";
import { autor, exigirAcessoEmpresa } from "./acesso";
import { auditarNa } from "./auditoria";
import { gerarHashPin } from "./seguranca";
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

  if (!id && !novoPin) throw new HttpsError("invalid-argument", "PIN: defina um PIN para o funcionário.");

  const colecao = db.collection(`empresas/${empresaId}/funcionarios`);
  const ref = id ? colecao.doc(id) : colecao.doc();
  const credenciaisRef = db.doc(`empresas/${empresaId}/credenciais/${ref.id}`);
  const credenciais = novoPin ? await gerarHashPin(novoPin) : null;

  // Transação: garante matrícula e CPF únicos mesmo com dois cadastros simultâneos.
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
        ...(id ? {} : { criadoEm: agora, pinDefinido: false }),
        ...(credenciais ? { pinDefinido: true, pinProvisorio: true, pinAtualizadoEm: agora } : {}),
      },
      { merge: true },
    );
    if (credenciais) {
      // O PIN do gestor é provisório: o funcionário cria o dele no primeiro uso
      // (ver pinPessoal.ts). Redefinir também desbloqueia quem errou demais.
      tx.set(credenciaisRef, { ...credenciais, provisorio: true, falhas: 0, bloqueios: 0, bloqueadoAte: null }, { merge: true });
    }
    auditarNa(tx, {
      empresaId,
      autor: autor(usuario),
      acao: id ? "funcionario.atualizado" : "funcionario.criado",
      descricao:
        `Funcionário ${nome} (matrícula ${matriculaFuncionario}) ${id ? "atualizado" : "cadastrado"}` +
        `${novoPin && id ? "; PIN provisório redefinido" : ""}${ativo ? "" : "; inativo"}.`,
      detalhes: { funcionarioId: ref.id, matricula: matriculaFuncionario, cargo, ativo, pinAlterado: Boolean(novoPin) },
    });
  });

  return { id: ref.id };
});
