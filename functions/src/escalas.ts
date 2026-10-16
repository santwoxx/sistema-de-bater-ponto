import { FieldValue, type DocumentSnapshot } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/https";
import { db } from "./admin";
import { autor, exigirAcessoEmpresa, type Usuario } from "./acesso";
import { auditarNa } from "./auditoria";
import { jornadaDoHorario, mesmoHorario, textoDoHorario } from "./horario";
import { horario, idDocumento, idOpcional, listaIds, objeto, texto } from "./validacao";

// Escalas de horário de cada empresa: um nome e o horário contratual da semana
// (ver horario.ts). Associar um funcionário a uma escala copia o horário dela
// para o cadastro dele, de onde o espelho, o fechamento e o AEJ continuam
// lendo; mudar a escala muda, na mesma transação, o horário de todos os
// funcionários dela. Excluir a escala (ou tirar alguém dela) deixa cada um
// com o mesmo horário, agora como horário próprio.

const MAX_FUNCIONARIOS_POR_VEZ = 500;
const MAX_EMPRESAS_DA_COPIA = 20;

/** Para comparar nomes: sem acentos, minúsculas e espaços simples ("Comercial  44H" = "comercial 44h"). */
function chaveDoNome(nome: string): string {
  return nome.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** "Ana, Bia e Caio"; com muitos, os primeiros e quantos faltam. */
function listaDeNomes(funcionarios: DocumentSnapshot[]): string {
  const nomes = funcionarios.map((snap) => String(snap.get("nome") ?? snap.id));
  if (nomes.length > 10) return `${nomes.slice(0, 10).join(", ")} e mais ${nomes.length - 10}`;
  return nomes.length > 1 ? `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}` : (nomes[0] ?? "");
}

/** Outras empresas em que a escala nova também é criada (ex.: do mesmo grupo, na mesma loja). */
async function empresasDaCopia(usuario: Usuario, empresaId: string, valor: unknown): Promise<{ id: string; nome: string }[]> {
  if (valor === undefined || valor === null) return [];
  const ids = listaIds(valor, "Criar também em", MAX_EMPRESAS_DA_COPIA).filter((id) => id !== empresaId);
  if (ids.length === 0) return [];
  if (usuario.papel !== "admin" && ids.some((id) => !usuario.empresas.includes(id))) {
    throw new HttpsError("permission-denied", "Você não tem acesso a uma das empresas escolhidas para a escala.");
  }
  const snaps = await db.getAll(...ids.map((id) => db.doc(`empresas/${id}`)));
  if (snaps.some((snap) => !snap.exists || snap.get("ativo") === false)) {
    throw new HttpsError("invalid-argument", "Criar também em: escolha só empresas ativas.");
  }
  return snaps.map((snap) => ({ id: snap.id, nome: String(snap.get("nome") ?? "") }));
}

export async function salvarEscala(request: CallableRequest) {
  const dados = objeto(request.data);
  const empresaId = idDocumento(dados.empresaId, "Empresa");
  const { usuario, empresa } = await exigirAcessoEmpresa(request, empresaId);
  const id = idOpcional(dados.id, "Escala");
  const nome = texto(dados.nome, "Nome da escala", { min: 2, max: 60 });
  const horarioDaEscala = horario(dados.horario);
  const jornada = jornadaDoHorario(horarioDaEscala);
  if (jornada.every((minutos) => minutos === 0)) throw new HttpsError("invalid-argument", "A escala precisa de pelo menos um dia de trabalho.");
  const copias = id ? [] : await empresasDaCopia(usuario, empresaId, dados.copiarPara);

  const empresaRef = db.doc(`empresas/${empresaId}`);
  const ref = id ? empresaRef.collection("escalas").doc(id) : empresaRef.collection("escalas").doc();
  const destinos = [{ id: empresaId, nome: empresa.nome, ref }, ...copias.map((c) => ({ ...c, ref: db.collection(`empresas/${c.id}/escalas`).doc() }))];

  const funcionariosAtualizados = await db.runTransaction(async (tx) => {
    const [atual, membros, existentes] = await Promise.all([
      id ? tx.get(ref) : Promise.resolve(null),
      id ? tx.get(empresaRef.collection("funcionarios").where("escalaId", "==", id)) : Promise.resolve(null),
      Promise.all(destinos.map((destino) => tx.get(destino.ref.parent))),
    ]);
    if (id && !atual?.exists) throw new HttpsError("not-found", "Escala não encontrada.");
    for (const [i, destino] of destinos.entries()) {
      const repetida = existentes[i].docs.some((doc) => doc.id !== destino.ref.id && chaveDoNome(String(doc.get("nome") ?? "")) === chaveDoNome(nome));
      if (repetida) throw new HttpsError("already-exists", `Já existe uma escala chamada "${nome}" ${i === 0 ? "nesta empresa" : `em ${destino.nome}`}.`);
    }

    const agora = FieldValue.serverTimestamp();
    const quem = autor(usuario);
    const escala = { nome, horario: horarioDaEscala, jornada, atualizadaEm: agora, atualizadaPor: quem };
    if (id) {
      tx.update(ref, escala);
    } else {
      for (const destino of destinos) tx.create(destino.ref, { ...escala, criadaEm: agora, criadaPor: quem });
    }
    // Quem é da escala fica com o horário dela (só grava em quem está diferente).
    const desatualizados = (membros?.docs ?? []).filter((doc) => !mesmoHorario(doc.get("horario"), horarioDaEscala));
    for (const doc of desatualizados) tx.update(doc.ref, { horario: horarioDaEscala, jornada, atualizadoEm: agora });

    for (const [i, destino] of destinos.entries()) {
      auditarNa(tx, {
        empresaId: destino.id,
        autor: quem,
        acao: id ? "escala.atualizada" : "escala.criada",
        descricao:
          `Escala ${nome} ${id ? "atualizada" : "criada"}${i > 0 ? ` (junto com a de ${empresa.nome})` : ""}: ${textoDoHorario(horarioDaEscala)}` +
          `${desatualizados.length > 0 ? `; horário de ${listaDeNomes(desatualizados)} atualizado` : ""}.`,
        detalhes: { escalaId: destino.ref.id, nome, horario: horarioDaEscala, funcionarios: desatualizados.map((doc) => doc.id) },
      });
    }
    return desatualizados.length;
  });

  return { id: ref.id, funcionariosAtualizados, copias: copias.length };
}

export async function removerEscala(request: CallableRequest) {
  const dados = objeto(request.data);
  const empresaId = idDocumento(dados.empresaId, "Empresa");
  const { usuario } = await exigirAcessoEmpresa(request, empresaId);
  const escalaId = idDocumento(dados.escalaId, "Escala");
  const empresaRef = db.doc(`empresas/${empresaId}`);
  const ref = empresaRef.collection("escalas").doc(escalaId);

  const funcionarios = await db.runTransaction(async (tx) => {
    const [escala, membros] = await Promise.all([tx.get(ref), tx.get(empresaRef.collection("funcionarios").where("escalaId", "==", escalaId))]);
    if (!escala.exists) throw new HttpsError("not-found", "Escala não encontrada.");
    const agora = FieldValue.serverTimestamp();
    tx.delete(ref);
    // Cada um continua com o mesmo horário, agora como horário próprio.
    for (const doc of membros.docs) tx.update(doc.ref, { escalaId: FieldValue.delete(), atualizadoEm: agora });
    auditarNa(tx, {
      empresaId,
      autor: autor(usuario),
      acao: "escala.removida",
      descricao:
        `Escala ${String(escala.get("nome"))} excluída` +
        `${membros.empty ? "" : `; ${listaDeNomes(membros.docs)} ficaram com o mesmo horário, como horário próprio`}.`,
      detalhes: { escalaId, nome: escala.get("nome"), funcionarios: membros.docs.map((doc) => doc.id) },
    });
    return membros.size;
  });

  return { ok: true, funcionarios };
}

/**
 * Entra e sai da escala de uma vez (os funcionários marcados e desmarcados na
 * tela). Quem entra recebe o horário da escala (mesmo vindo de outra escala);
 * quem sai fica com o mesmo horário, como horário próprio.
 */
export async function associarEscala(request: CallableRequest) {
  const dados = objeto(request.data);
  const empresaId = idDocumento(dados.empresaId, "Empresa");
  const { usuario } = await exigirAcessoEmpresa(request, empresaId);
  const escalaId = idDocumento(dados.escalaId, "Escala");
  const adicionar = dados.adicionar === undefined ? [] : listaIds(dados.adicionar, "Funcionários", MAX_FUNCIONARIOS_POR_VEZ);
  const remover = dados.remover === undefined ? [] : listaIds(dados.remover, "Funcionários", MAX_FUNCIONARIOS_POR_VEZ);
  if (adicionar.length + remover.length === 0) throw new HttpsError("invalid-argument", "Funcionários: escolha pelo menos um.");
  if (adicionar.some((id) => remover.includes(id))) {
    throw new HttpsError("invalid-argument", "Funcionários: o mesmo funcionário não pode entrar e sair da escala.");
  }
  const empresaRef = db.doc(`empresas/${empresaId}`);
  const funcionarios = empresaRef.collection("funcionarios");

  return db.runTransaction(async (tx) => {
    const [escala, ...snaps] = await tx.getAll(
      empresaRef.collection("escalas").doc(escalaId),
      ...[...adicionar, ...remover].map((id) => funcionarios.doc(id)),
    );
    if (!escala.exists) throw new HttpsError("not-found", "Escala não encontrada.");
    if (snaps.some((snap) => !snap.exists)) throw new HttpsError("not-found", "Funcionário não encontrado nesta empresa.");
    const horarioDaEscala = escala.get("horario") as string[];
    const nome = String(escala.get("nome"));
    // Só grava em quem muda de verdade.
    const entram = snaps
      .slice(0, adicionar.length)
      .filter((snap) => snap.get("escalaId") !== escalaId || !mesmoHorario(snap.get("horario"), horarioDaEscala));
    const saem = snaps.slice(adicionar.length).filter((snap) => snap.get("escalaId") === escalaId);

    const agora = FieldValue.serverTimestamp();
    for (const snap of entram) {
      tx.update(snap.ref, { escalaId, horario: horarioDaEscala, jornada: jornadaDoHorario(horarioDaEscala), atualizadoEm: agora });
    }
    for (const snap of saem) tx.update(snap.ref, { escalaId: FieldValue.delete(), atualizadoEm: agora });
    if (entram.length + saem.length > 0) {
      const partes = [
        ...(entram.length > 0 ? [`${listaDeNomes(entram)} ${entram.length > 1 ? "entraram" : "entrou"}`] : []),
        ...(saem.length > 0 ? [`${listaDeNomes(saem)} ${saem.length > 1 ? "saíram" : "saiu"} (com o mesmo horário, como horário próprio)`] : []),
      ];
      auditarNa(tx, {
        empresaId,
        autor: autor(usuario),
        acao: "escala.associada",
        descricao: `Escala ${nome}: ${partes.join("; ")}.`,
        detalhes: { escalaId, nome, entraram: entram.map((snap) => snap.id), sairam: saem.map((snap) => snap.id) },
      });
    }
    return { adicionados: entram.length, removidos: saem.length };
  });
}
