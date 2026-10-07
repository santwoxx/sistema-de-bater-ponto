import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { db } from "./admin";

// Limite de uso por usuário nas funções mais pesadas ou sensíveis. Se uma conta
// de gestor for invadida (ou um script sair do controle), o estrago e o custo
// ficam contidos. Janela fixa: N usos a cada X minutos, contados numa coleção
// que nenhum navegador lê (limites/{uid}_{acao}).

interface Limite {
  descricao: string;
  maximo: number;
  janelaMinutos: number;
}

export const LIMITES = {
  exportarDados: { descricao: "exportações", maximo: 30, janelaMinutos: 60 },
  fecharEspelhos: { descricao: "fechamentos", maximo: 30, janelaMinutos: 60 },
  verificarIntegridade: { descricao: "verificações de integridade", maximo: 10, janelaMinutos: 60 },
  obterFoto: { descricao: "fotos abertas", maximo: 300, janelaMinutos: 60 },
} satisfies Record<string, Limite>;

export type AcaoLimitada = keyof typeof LIMITES;

export interface Janela {
  inicio: number;
  quantidade: number;
}

/** Decide se mais um uso cabe na janela atual (função pura). */
export function proximoUso(
  atual: Janela | null,
  agora: number,
  limite: Pick<Limite, "maximo" | "janelaMinutos">,
): { permitido: true; janela: Janela } | { permitido: false; liberaEm: number } {
  const duracao = limite.janelaMinutos * 60_000;
  if (!atual || agora - atual.inicio >= duracao) return { permitido: true, janela: { inicio: agora, quantidade: 1 } };
  if (atual.quantidade >= limite.maximo) return { permitido: false, liberaEm: atual.inicio + duracao };
  return { permitido: true, janela: { inicio: atual.inicio, quantidade: atual.quantidade + 1 } };
}

/** O máximo pode ser ajustado por projeto: LIMITE_<ACAO> no functions/.env.<projeto>. */
function limiteConfigurado(acao: AcaoLimitada): Limite {
  const limite = LIMITES[acao];
  const variavel = `LIMITE_${acao.replace(/[A-Z]/g, (letra) => `_${letra}`).toUpperCase()}`;
  const ajuste = Number(process.env[variavel]);
  return Number.isInteger(ajuste) && ajuste > 0 ? { ...limite, maximo: ajuste } : limite;
}

/** Conta um uso de `acao` por `uid`; recusa com "resource-exhausted" se passou do limite. */
export async function consumirLimite(uid: string, acao: AcaoLimitada): Promise<void> {
  const limite = limiteConfigurado(acao);
  const ref = db.doc(`limites/${uid}_${acao}`);
  await db.runTransaction(async (tx) => {
    const dados = (await tx.get(ref)).data();
    const atual = dados ? { inicio: (dados.inicio as Timestamp).toMillis(), quantidade: dados.quantidade as number } : null;
    const resultado = proximoUso(atual, Date.now(), limite);
    if (!resultado.permitido) {
      const minutos = Math.max(1, Math.ceil((resultado.liberaEm - Date.now()) / 60_000));
      const janela = limite.janelaMinutos === 60 ? "por hora" : `a cada ${limite.janelaMinutos} minutos`;
      throw new HttpsError(
        "resource-exhausted",
        `Limite de ${limite.maximo} ${limite.descricao} ${janela} atingido. Tente de novo em ${minutos} min.`,
      );
    }
    tx.set(ref, {
      inicio: Timestamp.fromMillis(resultado.janela.inicio),
      quantidade: resultado.janela.quantidade,
      atualizadoEm: FieldValue.serverTimestamp(),
    });
  });
}
