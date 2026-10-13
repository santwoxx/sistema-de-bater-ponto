// Ponto de entrada das Cloud Functions. Toda escrita no banco passa por
// estas funções; o navegador só tem permissão de leitura (ver firestore.rules).

export { configurarPrimeiroAdmin } from "./sistema";
export { painel } from "./painel";
export { sincronizarDispositivo } from "./dispositivos";
export { registrarPonto } from "./ponto";
export { registrarPontoGuardado } from "./semInternet";
export { fecharEspelhos } from "./fechamentos";
export { exportarDados } from "./exportacao";
export { verificarIntegridade, verificarIntegridadeSemanal } from "./integridade";
