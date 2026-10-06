import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/https";
import { auth, db } from "./admin";
import { autor, erroAuth, exigirAdmin } from "./acesso";
import { registrarAuditoria } from "./auditoria";
import { booleano, email, idOpcional, listaIds, objeto, opcao, senha, texto } from "./validacao";

export const salvarUsuario = onCall(async (request) => {
  const admin = await exigirAdmin(request);
  const dados = objeto(request.data);

  const uidExistente = idOpcional(dados.uid, "Usuário");
  const nome = texto(dados.nome, "Nome", { min: 3, max: 120 });
  const emailUsuario = email(dados.email);
  const papel = opcao(dados.papel, "Papel", ["admin", "gestor"] as const);
  const empresas = papel === "admin" ? [] : listaIds(dados.empresas ?? [], "Empresas", 300);
  const ativo = dados.ativo === undefined ? true : booleano(dados.ativo, "Ativo");
  const novaSenha = dados.senha ? senha(dados.senha) : null;

  if (!uidExistente && !novaSenha) throw new HttpsError("invalid-argument", "Senha: defina uma senha inicial.");
  if (uidExistente === admin.uid && (papel !== "admin" || !ativo)) {
    throw new HttpsError("failed-precondition", "Você não pode remover o seu próprio acesso de administrador.");
  }

  if (empresas.length > 0) {
    const snaps = await db.getAll(...empresas.map((id) => db.doc(`empresas/${id}`)));
    if (snaps.some((snap) => !snap.exists)) throw new HttpsError("invalid-argument", "Empresas: há empresa inexistente na lista.");
  }

  const agora = FieldValue.serverTimestamp();
  let uid: string;
  try {
    if (uidExistente) {
      const ref = db.doc(`usuarios/${uidExistente}`);
      if (!(await ref.get()).exists) throw new HttpsError("not-found", "Usuário não encontrado.");
      await auth.updateUser(uidExistente, {
        email: emailUsuario,
        displayName: nome,
        disabled: !ativo,
        ...(novaSenha ? { password: novaSenha } : {}),
      });
      // Desativar ou trocar a senha encerra as sessões abertas do usuário.
      if (!ativo || novaSenha) await auth.revokeRefreshTokens(uidExistente);
      await ref.set({ nome, email: emailUsuario, papel, empresas, ativo, atualizadoEm: agora }, { merge: true });
      uid = uidExistente;
    } else {
      const criado = await auth.createUser({ email: emailUsuario, password: novaSenha!, displayName: nome, disabled: !ativo });
      await db.doc(`usuarios/${criado.uid}`).set({
        nome,
        email: emailUsuario,
        papel,
        empresas,
        ativo,
        criadoEm: agora,
        atualizadoEm: agora,
      });
      uid = criado.uid;
    }
  } catch (erro) {
    throw erroAuth(erro);
  }

  await registrarAuditoria({
    empresaId: null,
    autor: autor(admin),
    acao: uidExistente ? "usuario.atualizado" : "usuario.criado",
    descricao: `Usuário ${nome} (${emailUsuario}) ${uidExistente ? "atualizado" : "cadastrado"} como ${papel}${ativo ? "" : " (inativo)"}.`,
    detalhes: { uid, papel, empresas, ativo, senhaAlterada: Boolean(novaSenha) },
  });

  return { uid };
});
