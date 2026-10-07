import { setGlobalOptions } from "firebase-functions";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

// Região de São Paulo: menor latência para lojas no Brasil.
//
// CPU e cópias: projetos novos têm 20 vCPU por região no Cloud Run, e cada cópia
// em execução reserva a CPU dela (o deploy sobe uma cópia de cada função para o
// teste de saúde). O padrão das funções de 2ª geração é 1 vCPU por cópia; com
// "gcf_gen1" a CPU acompanha a memória, como nas de 1ª geração (256MiB = 1/6 de
// vCPU), e cada cópia atende uma chamada por vez. maxInstances limita as cópias
// de cada função: contém o custo em caso de tráfego anormal e mantém a soma
// abaixo da cota, conferida em cota.test.ts. Uma loja usa bem menos que isso.
export const REGIAO = "southamerica-east1";
setGlobalOptions({ region: REGIAO, cpu: "gcf_gen1", maxInstances: 3 });

const app = initializeApp();

export const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });

export const auth = getAuth(app);

export function bucket() {
  return getStorage(app).bucket();
}
