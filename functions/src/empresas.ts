import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/https";
import { db } from "./admin";
import { PADROES_EMPRESA, autor, exigirAdmin } from "./acesso";
import { contadorDe, empregadorMudou, garantirRepIniciado, gravarOperacoes, iniciarRepDaEmpresaNova, operacaoEmpregador } from "./arp";
import { auditarNa } from "./auditoria";
import { dataLocal } from "./tempo";
import { booleano, cnpjOpcional, dataISO, fusoHorario, idOpcional, inteiro, objeto, texto, textoOpcional } from "./validacao";

export async function salvarEmpresa(request: CallableRequest) {
  const usuario = await exigirAdmin(request);
  const dados = objeto(request.data);

  const id = idOpcional(dados.id, "Empresa");
  const nome = texto(dados.nome, "Nome", { min: 2, max: 120 });
  const cnpj = cnpjOpcional(dados.cnpj);
  // Local da prestação do serviço ou endereço do estabelecimento (comprovante e AFD, Portaria 671).
  const endereco = textoOpcional(dados.endereco, "Endereço", { max: 100 });
  const fuso = fusoHorario(dados.fusoHorario ?? PADROES_EMPRESA.fusoHorario);
  const intervaloMinimoMinutos = inteiro(
    dados.intervaloMinimoMinutos ?? PADROES_EMPRESA.intervaloMinimoMinutos,
    "Intervalo mínimo entre marcações",
    0,
    60,
  );
  const toleranciaMinutos = inteiro(dados.toleranciaMinutos ?? PADROES_EMPRESA.toleranciaMinutos, "Tolerância diária", 0, 60);
  const ativo = dados.ativo === undefined ? true : booleano(dados.ativo, "Ativo");
  // Início do controle de ponto: antes dele, dias sem marcação não contam como falta.
  // Na criação, assume a data de hoje; na edição, só muda se o campo for enviado.
  const inicioInformado = dados.inicioControle !== undefined;
  const inicioControle = dados.inicioControle ? dataISO(dados.inicioControle, "Início do controle") : null;

  if (cnpj) {
    const mesmoCnpj = await db.collection("empresas").where("cnpj", "==", cnpj).limit(2).get();
    if (mesmoCnpj.docs.some((doc) => doc.id !== id)) {
      throw new HttpsError("already-exists", "Já existe uma empresa com este CNPJ.");
    }
  }

  const ref = id ? db.doc(`empresas/${id}`) : db.collection("empresas").doc();
  const controleRef = ref.collection("privado").doc("controle");
  // Empresa existente: a ARP dela (Portaria 671) precisa estar preparada antes de gravar a alteração.
  if (id) {
    if (!(await ref.get()).exists) throw new HttpsError("not-found", "Empresa não encontrada.");
    await garantirRepIniciado(id);
  }

  const identificacao = { nome, cnpj, endereco };
  await db.runTransaction(async (tx) => {
    const [atual, controle] = id ? await Promise.all([tx.get(ref), tx.get(controleRef)]) : [null, null];
    if (id && !atual?.exists) throw new HttpsError("not-found", "Empresa não encontrada.");

    const agora = FieldValue.serverTimestamp();
    tx.set(
      ref,
      {
        nome,
        cnpj,
        endereco,
        fusoHorario: fuso,
        intervaloMinimoMinutos,
        toleranciaMinutos,
        ativo,
        atualizadoEm: agora,
        ...(id
          ? inicioInformado
            ? { inicioControle }
            : {}
          : { criadoEm: agora, inicioControle: inicioControle ?? dataLocal(new Date(), fuso) }),
      },
      { merge: true },
    );

    // ARP: a empresa nova começa com a identificação do empregador (NSR 1); na
    // existente, mudar o CNPJ, o nome ou o endereço é uma alteração gravada.
    const instante = new Date();
    if (!id) {
      iniciarRepDaEmpresaNova(tx, ref, identificacao, usuario.cpf, instante);
    } else if (atual && controle && empregadorMudou(atual.data() ?? {}, identificacao)) {
      const contador = gravarOperacoes(tx, ref, contadorDe(controle), [operacaoEmpregador(identificacao, usuario.cpf)], instante);
      tx.set(controleRef, contador, { merge: true });
    }

    auditarNa(tx, {
      empresaId: null,
      autor: autor(usuario),
      acao: id ? "empresa.atualizada" : "empresa.criada",
      descricao: `Empresa "${nome}" ${id ? "atualizada" : "cadastrada"}.`,
      detalhes: {
        empresaId: ref.id,
        nome,
        cnpj,
        endereco,
        fusoHorario: fuso,
        intervaloMinimoMinutos,
        toleranciaMinutos,
        ativo,
        ...(inicioInformado ? { inicioControle } : {}),
      },
    });
  });

  return { id: ref.id };
}
