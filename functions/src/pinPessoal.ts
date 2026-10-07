import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/https";
import { db } from "./admin";
import { exigirDispositivo } from "./acesso";
import { auditarNa } from "./auditoria";
import { decodificarJpeg, identificarNoAparelho, lerMatriculaPin, MAX_MINIATURA_BYTES } from "./identificacao";
import { gerarHashPin } from "./seguranca";
import { objeto, pin } from "./validacao";

// PIN pessoal: o PIN que o gestor cadastra é PROVISÓRIO e só serve para o
// funcionário criar o dele no aparelho, no primeiro uso. Assim ninguém da
// empresa conhece o PIN que bate o ponto e assina o espelho. O funcionário
// também pode trocar o PIN quando quiser; o gestor só consegue redefinir
// (e o PIN volta a ser provisório).

export const definirPin = onCall(async (request) => {
  const { dispositivoId, empresaId } = exigirDispositivo(request);
  const dados = objeto(request.data);
  const { matricula, pin: pinAtual } = lerMatriculaPin(dados);
  const novoPin = pin(dados.novoPin);
  if (novoPin === pinAtual) throw new HttpsError("invalid-argument", "PIN: escolha um PIN diferente do atual.");
  const miniatura = dados.miniatura ? decodificarJpeg(dados.miniatura, "Foto", MAX_MINIATURA_BYTES) : null;

  const { empresaRef, dispositivo, funcionarioId, funcionario, credenciaisRef, provisorio } = await identificarNoAparelho({
    empresaId,
    dispositivoId,
    matricula,
    pin: pinAtual,
    miniatura,
    aceitarProvisorio: true,
  });

  const credenciais = await gerarHashPin(novoPin);
  const agora = FieldValue.serverTimestamp();
  const lote = db.batch();
  lote.update(credenciaisRef, { ...credenciais, provisorio: false, falhas: 0, bloqueios: 0, bloqueadoAte: null, pinAtualizadoEm: agora });
  lote.update(empresaRef.collection("funcionarios").doc(funcionarioId), { pinProvisorio: false, pinAtualizadoEm: agora });
  auditarNa(lote, {
    empresaId,
    autor: { uid: funcionarioId, nome: String(funcionario.nome) },
    acao: provisorio ? "pin.criado" : "pin.trocado",
    descricao: `${funcionario.nome} ${provisorio ? "criou o PIN pessoal" : "trocou o PIN"} no aparelho "${dispositivo.nome}".`,
    detalhes: { funcionarioId, dispositivoId },
  });
  await lote.commit();

  return { funcionarioNome: String(funcionario.nome) };
});
