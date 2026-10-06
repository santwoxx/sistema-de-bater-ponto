import { HttpsError, type CallableRequest } from "firebase-functions/https";
import { db } from "./admin";

// Papéis:
//  - admin:       vê e gerencia todas as empresas, usuários e configurações.
//  - gestor:      gerencia apenas as empresas listadas no seu cadastro.
//  - dispositivo: aparelho de ponto ativado para UMA empresa; só registra ponto.

export type Papel = "admin" | "gestor";

export interface Usuario {
  uid: string;
  nome: string;
  email: string;
  papel: Papel;
  empresas: string[];
}

export interface Autor {
  uid: string;
  nome: string;
}

export interface Empresa {
  id: string;
  nome: string;
  cnpj: string;
  fusoHorario: string;
  ativo: boolean;
  intervaloMinimoMinutos: number;
  toleranciaMinutos: number;
}

export const PADROES_EMPRESA = {
  fusoHorario: "America/Sao_Paulo",
  intervaloMinimoMinutos: 2,
  toleranciaMinutos: 10,
};

export function autor(usuario: Usuario): Autor {
  return { uid: usuario.uid, nome: usuario.nome };
}

export async function exigirUsuario(request: CallableRequest): Promise<Usuario> {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Faça login para continuar.");
  if (request.auth?.token.papel === "dispositivo") {
    throw new HttpsError("permission-denied", "Ação não permitida para aparelhos de ponto.");
  }
  const snap = await db.doc(`usuarios/${uid}`).get();
  const dados = snap.data();
  if (!dados || dados.ativo !== true) {
    throw new HttpsError("permission-denied", "Seu usuário não tem acesso ao sistema.");
  }
  return {
    uid,
    nome: String(dados.nome ?? ""),
    email: String(dados.email ?? ""),
    papel: dados.papel === "admin" ? "admin" : "gestor",
    empresas: Array.isArray(dados.empresas) ? dados.empresas : [],
  };
}

export async function exigirAdmin(request: CallableRequest): Promise<Usuario> {
  const usuario = await exigirUsuario(request);
  if (usuario.papel !== "admin") {
    throw new HttpsError("permission-denied", "Apenas administradores podem realizar esta ação.");
  }
  return usuario;
}

export async function carregarEmpresa(empresaId: string): Promise<Empresa> {
  const snap = await db.doc(`empresas/${empresaId}`).get();
  const dados = snap.data();
  if (!dados) throw new HttpsError("not-found", "Empresa não encontrada.");
  return {
    id: snap.id,
    nome: String(dados.nome ?? ""),
    cnpj: String(dados.cnpj ?? ""),
    fusoHorario: dados.fusoHorario ?? PADROES_EMPRESA.fusoHorario,
    ativo: dados.ativo !== false,
    intervaloMinimoMinutos: dados.intervaloMinimoMinutos ?? PADROES_EMPRESA.intervaloMinimoMinutos,
    toleranciaMinutos: dados.toleranciaMinutos ?? PADROES_EMPRESA.toleranciaMinutos,
  };
}

export async function exigirAcessoEmpresa(
  request: CallableRequest,
  empresaId: string,
): Promise<{ usuario: Usuario; empresa: Empresa }> {
  const usuario = await exigirUsuario(request);
  if (usuario.papel !== "admin" && !usuario.empresas.includes(empresaId)) {
    throw new HttpsError("permission-denied", "Você não tem acesso a esta empresa.");
  }
  return { usuario, empresa: await carregarEmpresa(empresaId) };
}

export function exigirDispositivo(request: CallableRequest): { dispositivoId: string; empresaId: string } {
  const token = request.auth?.token;
  if (!request.auth || token?.papel !== "dispositivo" || typeof token.empresaId !== "string") {
    throw new HttpsError("permission-denied", "Este aparelho não está ativado como ponto.");
  }
  return { dispositivoId: request.auth.uid, empresaId: token.empresaId };
}

// Converte erros do Firebase Auth (Admin SDK) em mensagens para o usuário.
export function erroAuth(erro: unknown): HttpsError {
  const codigo = (erro as { code?: string })?.code ?? "";
  switch (codigo) {
    case "auth/email-already-exists":
      return new HttpsError("already-exists", "Já existe um usuário com este e-mail.");
    case "auth/invalid-email":
      return new HttpsError("invalid-argument", "E-mail inválido.");
    case "auth/invalid-password":
      return new HttpsError("invalid-argument", "Senha inválida: use pelo menos 8 caracteres.");
    case "auth/user-not-found":
      return new HttpsError("not-found", "Usuário não encontrado.");
    default:
      return erro instanceof HttpsError ? erro : new HttpsError("internal", "Falha ao atualizar a autenticação.");
  }
}
