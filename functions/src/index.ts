// Ponto de entrada das Cloud Functions. Toda escrita no banco passa por
// estas funções; o navegador só tem permissão de leitura (ver firestore.rules).

export { configurarPrimeiroAdmin } from "./sistema";
export { salvarEmpresa } from "./empresas";
export { salvarUsuario } from "./usuarios";
export { salvarFuncionario } from "./funcionarios";
export { ativarDispositivo, desativarDispositivo, sincronizarDispositivo } from "./dispositivos";
export { registrarPonto } from "./ponto";
export { definirPin } from "./pinPessoal";
export { obterFoto } from "./fotos";
export { incluirMarcacao, desconsiderarMarcacao } from "./ajustes";
export { incluirAbono, removerAbono } from "./abonos";
export { solicitarMarcacao, criarSolicitacao, decidirSolicitacao } from "./solicitacoes";
export { fecharEspelhos, consultarEspelhosPendentes, assinarEspelho } from "./fechamentos";
export { exportarDados } from "./exportacao";
export { verificarIntegridade, verificarIntegridadeSemanal } from "./integridade";
