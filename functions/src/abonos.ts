import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/https";
import { db } from "./admin";
import { autor, exigirAcessoEmpresa } from "./acesso";
import { auditarNa } from "./auditoria";
import { dataISO, idDocumento, idOpcional, inteiro, objeto, opcao, texto } from "./validacao";

// Abonos: dias (ou horas) em que a ausência é justificada — feriado, atestado,
// férias, folga. No espelho, o dia abonado não conta como falta. Um abono sem
// funcionário vale para todos da empresa (ex.: feriado).

export const TIPOS_ABONO = ["feriado", "atestado", "ferias", "folga", "outro"] as const;
type TipoAbono = (typeof TIPOS_ABONO)[number];

const ROTULOS: Record<TipoAbono, string> = {
  feriado: "Feriado",
  atestado: "Atestado",
  ferias: "Férias",
  folga: "Folga",
  outro: "Abono",
};

const MAX_DIAS = 62;

function diasDoPeriodo(de: string, ate: string): string[] {
  const [ano, mes, dia] = de.split("-").map(Number);
  const dias: string[] = [];
  for (let i = 0; ; i++) {
    const data = new Date(Date.UTC(ano, mes - 1, dia + i)).toISOString().slice(0, 10);
    if (data > ate) return dias;
    if (dias.length === MAX_DIAS) throw new HttpsError("invalid-argument", `Período: máximo de ${MAX_DIAS} dias por lançamento.`);
    dias.push(data);
  }
}

const formatar = (data: string) => data.split("-").reverse().join("/");

export const incluirAbono = onCall(async (request) => {
  const dados = objeto(request.data);
  const empresaId = idDocumento(dados.empresaId, "Empresa");
  const { usuario } = await exigirAcessoEmpresa(request, empresaId);
  const funcionarioId = idOpcional(dados.funcionarioId, "Funcionário");
  const tipo = opcao(dados.tipo, "Tipo", TIPOS_ABONO);
  const descricao = texto(dados.descricao, "Descrição", { min: 3, max: 300 });
  const de = dataISO(dados.de, "Data inicial");
  const ate = dados.ate ? dataISO(dados.ate, "Data final") : de;
  if (ate < de) throw new HttpsError("invalid-argument", "Período: a data final é anterior à inicial.");
  // Sem "minutos", o abono vale o dia inteiro; com "minutos", abate só essas horas da jornada.
  const minutos = dados.minutos === undefined || dados.minutos === null ? null : inteiro(dados.minutos, "Horas abonadas", 1, 24 * 60);
  const dias = diasDoPeriodo(de, ate);

  let funcionarioNome: string | null = null;
  if (funcionarioId) {
    const snap = await db.doc(`empresas/${empresaId}/funcionarios/${funcionarioId}`).get();
    if (!snap.exists) throw new HttpsError("not-found", "Funcionário não encontrado.");
    funcionarioNome = String(snap.get("nome"));
  }

  const colecao = db.collection(`empresas/${empresaId}/abonos`);
  const existentes = await colecao.where("data", ">=", de).where("data", "<=", ate).get();
  const jaAbonados = new Set(
    existentes.docs.filter((doc) => (doc.get("funcionarioId") ?? null) === funcionarioId).map((doc) => doc.get("data") as string),
  );
  const novos = dias.filter((data) => !jaAbonados.has(data));
  if (novos.length === 0) throw new HttpsError("already-exists", "Este período já está abonado.");

  const lote = db.batch();
  const agora = FieldValue.serverTimestamp();
  for (const data of novos) {
    lote.set(colecao.doc(), { data, funcionarioId, funcionarioNome, tipo, descricao, minutos, criadoPor: autor(usuario), criadoEm: agora });
  }
  const periodo = de === ate ? formatar(de) : `${formatar(de)} a ${formatar(ate)}`;
  auditarNa(lote, {
    empresaId,
    autor: autor(usuario),
    acao: "abono.incluido",
    descricao: `${ROTULOS[tipo]} lançado para ${funcionarioNome ?? "todos os funcionários"} em ${periodo}: ${descricao}.`,
    detalhes: { funcionarioId, tipo, de, ate, minutos, dias: novos.length },
  });
  await lote.commit();

  return { criados: novos.length };
});

export const removerAbono = onCall(async (request) => {
  const dados = objeto(request.data);
  const empresaId = idDocumento(dados.empresaId, "Empresa");
  const abonoId = idDocumento(dados.abonoId, "Abono");
  const { usuario } = await exigirAcessoEmpresa(request, empresaId);

  const ref = db.doc(`empresas/${empresaId}/abonos/${abonoId}`);
  await db.runTransaction(async (tx) => {
    const abono = (await tx.get(ref)).data();
    if (!abono) throw new HttpsError("not-found", "Abono não encontrado.");
    tx.delete(ref);
    auditarNa(tx, {
      empresaId,
      autor: autor(usuario),
      acao: "abono.removido",
      descricao: `${ROTULOS[abono.tipo as TipoAbono] ?? "Abono"} de ${abono.funcionarioNome ?? "todos os funcionários"} em ${formatar(abono.data)} removido.`,
      detalhes: {
        abonoId,
        data: abono.data,
        funcionarioId: abono.funcionarioId,
        tipo: abono.tipo,
        descricao: abono.descricao,
        minutos: abono.minutos,
      },
    });
  });

  return { ok: true };
});
