import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/https";
import { auth, db } from "./admin";
import { erroAuth } from "./acesso";
import { registrarAuditoria } from "./auditoria";
import { email, objeto, senha, texto } from "./validacao";

// Primeiro acesso: cria o administrador inicial. Só funciona uma vez;
// depois disso, novos usuários são criados pelo próprio administrador.
export const configurarPrimeiroAdmin = onCall(async (request) => {
  const dados = objeto(request.data);
  const nome = texto(dados.nome, "Nome", { min: 3, max: 120 });
  const emailAdmin = email(dados.email);
  const senhaAdmin = senha(dados.senha);

  const estadoRef = db.doc("sistema/estado");
  if ((await estadoRef.get()).exists) {
    throw new HttpsError("failed-precondition", "O sistema já foi configurado. Faça login.");
  }

  let uid: string;
  try {
    uid = (await auth.createUser({ email: emailAdmin, password: senhaAdmin, displayName: nome })).uid;
  } catch (erro) {
    throw erroAuth(erro);
  }

  try {
    await db.runTransaction(async (tx) => {
      if ((await tx.get(estadoRef)).exists) {
        throw new HttpsError("failed-precondition", "O sistema já foi configurado. Faça login.");
      }
      const agora = FieldValue.serverTimestamp();
      tx.create(estadoRef, { inicializado: true, inicializadoEm: agora });
      tx.set(db.doc(`usuarios/${uid}`), {
        nome,
        email: emailAdmin,
        papel: "admin",
        empresas: [],
        ativo: true,
        criadoEm: agora,
        atualizadoEm: agora,
      });
    });
  } catch (erro) {
    await auth.deleteUser(uid).catch(() => undefined);
    throw erro;
  }

  await registrarAuditoria({
    empresaId: null,
    autor: { uid, nome },
    acao: "sistema.configurado",
    descricao: `Sistema configurado; administrador inicial ${nome} (${emailAdmin}).`,
  });

  return { ok: true };
});
