import { setGlobalOptions } from "firebase-functions";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

// Região de São Paulo: menor latência para lojas no Brasil.
// maxInstances limita o custo em caso de tráfego anormal.
export const REGIAO = "southamerica-east1";
setGlobalOptions({ region: REGIAO, maxInstances: 10 });

const app = initializeApp();

export const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });

export const auth = getAuth(app);

export function bucket() {
  return getStorage(app).bucket();
}
