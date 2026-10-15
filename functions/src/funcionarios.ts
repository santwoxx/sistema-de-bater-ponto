import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/https";
import { db } from "./admin";
import { autor, exigirAcessoEmpresa } from "./acesso";
import { contadorDe, garantirRepIniciado, gravarOperacoes, operacaoDoCadastro, operacaoEmpregado } from "./arp";
import { auditarNa } from "./auditoria";
import { jornadaDoHorario } from "./horario";
import { donosDoPinAntigo, indiceDoPin } from "./pin";
import {
  booleano,
  cpf,
  dataISO,
  horario,
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
  // Com o horário contratual (Portaria 671: espelho e AEJ), a jornada de cada dia sai dele.
  const horarioContratual = dados.horario === undefined || dados.horario === null ? null : horario(dados.horario);
  const jornadaSemanal = horarioContratual ? jornadaDoHorario(horarioContratual) : jornada(dados.jornada);
  const ativo = dados.ativo === undefined ? true : booleano(dados.ativo, "Ativo");
  const novoPin = dados.pin ? pin(dados.pin) : null;

  if (!id && !novoPin) throw new HttpsError("invalid-argument", "PIN: defina o PIN de 4 números do funcionário.");

  const empresaRef = db.doc(`empresas/${empresaId}`);
  const colecao = empresaRef.collection("funcionarios");
  const ref = id ? colecao.doc(id) : colecao.doc();
  const credenciaisRef = empresaRef.collection("credenciais").doc(ref.id);
  // O PIN não é gravado: só o índice dele (ver pin.ts).
  const indice = novoPin ? await indiceDoPin(novoPin) : null;
  const pinRef = indice ? db.collection("pins").doc(indice) : null;
  const eleMesmo = (dono: { empresaId?: unknown; funcionarioId?: unknown }) => dono.empresaId === empresaId && dono.funcionarioId === ref.id;

  // A ARP da empresa precisa estar preparada antes de gravar a operação do empregado.
  await garantirRepIniciado(empresaId);
  const controleRef = empresaRef.collection("privado").doc("controle");

  // Transação: garante matrícula e CPF únicos na empresa, e o PIN único em todas
  // as empresas (um aparelho da loja pode atender várias, e o PIN sozinho
  // identifica o funcionário), mesmo com dois cadastros simultâneos.
  await db.runTransaction(async (tx) => {
    const [mesmaMatricula, mesmoCpf, atual, credenciais, donoDoPin, empresas, controle] = await Promise.all([
      tx.get(colecao.where("matricula", "==", matriculaFuncionario).limit(2)),
      tx.get(colecao.where("cpf", "==", cpfFuncionario).limit(2)),
      id ? tx.get(ref) : Promise.resolve(null),
      tx.get(credenciaisRef),
      pinRef ? tx.get(pinRef) : Promise.resolve(null),
      novoPin ? tx.get(db.collection("empresas").select()) : Promise.resolve(null),
      tx.get(controleRef),
    ]);
    // PINs antigos (sem índice) de todas as empresas, conferidos um a um.
    const pinsAntigos =
      novoPin && empresas
        ? await donosDoPinAntigo(
            empresas.docs.map((doc) => doc.id),
            novoPin,
            (consulta) => tx.get(consulta),
          )
        : [];
    if (id && !atual?.exists) throw new HttpsError("not-found", "Funcionário não encontrado.");
    if (mesmaMatricula.docs.some((doc) => doc.id !== ref.id)) {
      throw new HttpsError("already-exists", `A matrícula ${matriculaFuncionario} já pertence a outro funcionário.`);
    }
    if (mesmoCpf.docs.some((doc) => doc.id !== ref.id)) {
      throw new HttpsError("already-exists", "Este CPF já está cadastrado nesta empresa.");
    }
    if (novoPin && ((donoDoPin?.exists && !eleMesmo(donoDoPin.data() ?? {})) || pinsAntigos.some((dono) => !eleMesmo(dono)))) {
      throw new HttpsError(
        "already-exists",
        "Este PIN já é de outro funcionário (desta ou de outra empresa): cada um precisa de um PIN diferente. Escolha outro ou clique em Gerar PIN.",
      );
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
        ...(horarioContratual ? { horario: horarioContratual } : {}),
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
      if (typeof anterior === "string" && anterior !== indice) tx.delete(db.collection("pins").doc(anterior));
      tx.set(pinRef, { empresaId, funcionarioId: ref.id, criadoEm: agora });
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
    // ARP (Portaria 671): inclusão, alteração (nome, CPF ou PIN) ou exclusão (desativado) do empregado no REP.
    const depois = { nome, cpf: cpfFuncionario, ativo };
    const operacao = operacaoDoCadastro(atual?.data() ?? null, depois, Boolean(novoPin) && Boolean(id));
    if (operacao) {
      const contador = gravarOperacoes(tx, empresaRef, contadorDe(controle), [operacaoEmpregado(operacao, depois, usuario.cpf)], new Date());
      tx.set(controleRef, contador, { merge: true });
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
