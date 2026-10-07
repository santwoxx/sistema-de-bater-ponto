import { HttpsError } from "firebase-functions/https";

// Validação de toda entrada recebida pelas funções. Nada que vem do
// navegador é confiável: cada campo é conferido e normalizado aqui.

function invalido(campo: string, detalhe: string): never {
  throw new HttpsError("invalid-argument", `${campo}: ${detalhe}`);
}

function vazio(valor: unknown): boolean {
  return valor === undefined || valor === null || valor === "";
}

export function objeto(valor: unknown): Record<string, unknown> {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) {
    throw new HttpsError("invalid-argument", "Dados da requisição inválidos.");
  }
  return valor as Record<string, unknown>;
}

interface OpcoesTexto {
  min?: number;
  max?: number;
  padrao?: RegExp;
  mensagemPadrao?: string;
}

// Caracteres invisíveis de formatação (inversão da direção do texto, espaço de
// largura zero etc.) permitiriam disfarçar nomes e motivos na tela, no CSV e na
// impressão; caracteres de controle viram espaço.
const FORMATACAO_INVISIVEL = /\p{Cf}/gu;
const CONTROLE = /\p{Cc}/gu;

export function texto(valor: unknown, campo: string, opcoes: OpcoesTexto = {}): string {
  const { min = 1, max = 200, padrao, mensagemPadrao } = opcoes;
  if (typeof valor !== "string") invalido(campo, "campo obrigatório.");
  if (valor.length > max * 4) invalido(campo, `máximo de ${max} caracteres.`);
  const limpo = valor.normalize("NFC").replace(FORMATACAO_INVISIVEL, "").replace(CONTROLE, " ").trim().replace(/\s+/g, " ");
  if (limpo.length === 0) invalido(campo, "campo obrigatório.");
  if (limpo.length < min) invalido(campo, `mínimo de ${min} caracteres.`);
  if (limpo.length > max) invalido(campo, `máximo de ${max} caracteres.`);
  if (padrao && !padrao.test(limpo)) invalido(campo, mensagemPadrao ?? "formato inválido.");
  return limpo;
}

export function textoOpcional(valor: unknown, campo: string, opcoes: OpcoesTexto = {}): string {
  return vazio(valor) ? "" : texto(valor, campo, opcoes);
}

export function inteiro(valor: unknown, campo: string, min: number, max: number): number {
  const numero = typeof valor === "string" && valor.trim() !== "" ? Number(valor) : valor;
  if (typeof numero !== "number" || !Number.isInteger(numero)) invalido(campo, "deve ser um número inteiro.");
  if (numero < min || numero > max) invalido(campo, `deve estar entre ${min} e ${max}.`);
  return numero;
}

export function booleano(valor: unknown, campo: string): boolean {
  if (typeof valor !== "boolean") invalido(campo, "valor inválido.");
  return valor;
}

export function opcao<T extends string>(valor: unknown, campo: string, opcoes: readonly T[]): T {
  if (typeof valor !== "string" || !opcoes.includes(valor as T)) invalido(campo, "opção inválida.");
  return valor as T;
}

export function idDocumento(valor: unknown, campo: string): string {
  if (typeof valor !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(valor)) invalido(campo, "identificador inválido.");
  return valor;
}

export function idOpcional(valor: unknown, campo: string): string | null {
  return vazio(valor) ? null : idDocumento(valor, campo);
}

export function listaIds(valor: unknown, campo: string, max: number): string[] {
  if (!Array.isArray(valor)) invalido(campo, "lista inválida.");
  if (valor.length > max) invalido(campo, `máximo de ${max} itens.`);
  return [...new Set(valor.map((item) => idDocumento(item, campo)))];
}

export function email(valor: unknown): string {
  const limpo = texto(valor, "E-mail", { max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpo)) invalido("E-mail", "formato inválido.");
  return limpo;
}

// Senhas que aparecem no topo das listas de vazamentos (e variações locais).
const SENHAS_COMUNS = new Set([
  "12345678", "123456789", "1234567890", "87654321", "12341234", "11223344", "00000000", "11111111",
  "123123123", "password", "password1", "password123", "passw0rd", "qwerty123", "qwertyuiop", "abc12345",
  "abcd1234", "iloveyou", "admin123", "admin1234", "administrador", "senha123", "senha1234", "senha12345",
  "minhasenha", "mudar123", "trocar123", "brasil123", "brasil2026", "teste123", "teste1234", "ponto123",
]);

/** Senha de administrador ou gestor: cada login dá acesso aos dados das empresas. */
export function senha(valor: unknown, emailDoUsuario?: string): string {
  if (typeof valor !== "string" || valor.length < 8) invalido("Senha", "mínimo de 8 caracteres.");
  if (valor.length > 128) invalido("Senha", "máximo de 128 caracteres.");
  const minuscula = valor.toLowerCase();
  const sequencia = "0123456789012345678901234567890".includes(valor) || "abcdefghijklmnopqrstuvwxyz".includes(minuscula);
  if (SENHAS_COMUNS.has(minuscula) || /^(.)\1+$/.test(valor) || sequencia) {
    invalido("Senha", "muito comum ou fácil de adivinhar. Use uma frase ou combine palavras e números.");
  }
  const usuario = emailDoUsuario?.split("@")[0]?.toLowerCase() ?? "";
  if (usuario.length >= 4 && minuscula.includes(usuario)) invalido("Senha", "não use o seu e-mail na senha.");
  return valor;
}

export function somenteDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

export function cpfValido(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const digito = (tamanho: number) => {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += Number(cpf[i]) * (tamanho + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(9) === Number(cpf[9]) && digito(10) === Number(cpf[10]);
}

export function cpf(valor: unknown): string {
  const digitos = somenteDigitos(texto(valor, "CPF", { max: 20 }));
  if (!cpfValido(digitos)) invalido("CPF", "número inválido.");
  return digitos;
}

// Aceita o CNPJ numérico tradicional e o alfanumérico (vigente desde jul/2026):
// cada caractere vale (código ASCII − 48) no cálculo dos dígitos verificadores.
export function cnpjValido(cnpj: string): boolean {
  if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj) || /^(.)\1{13}$/.test(cnpj)) return false;
  const digito = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += (base.charCodeAt(i) - 48) * pesos[i];
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const d1 = digito(cnpj.slice(0, 12));
  const d2 = digito(cnpj.slice(0, 12) + d1);
  return d1 === Number(cnpj[12]) && d2 === Number(cnpj[13]);
}

export function normalizarCnpj(valor: string): string {
  return valor.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

export function cnpjOpcional(valor: unknown): string {
  if (vazio(valor)) return "";
  const limpo = normalizarCnpj(texto(valor, "CNPJ", { max: 30 }));
  if (!cnpjValido(limpo)) invalido("CNPJ", "número inválido.");
  return limpo;
}

// A matrícula é digitada no teclado numérico do ponto. Zeros à esquerda são
// ignorados para que "0012" e "12" identifiquem a mesma pessoa.
export function normalizarMatricula(valor: string): string {
  return valor.replace(/^0+(?=\d)/, "");
}

export function matricula(valor: unknown): string {
  const limpo = texto(valor, "Matrícula", { max: 10, padrao: /^\d+$/, mensagemPadrao: "use apenas números (até 10 dígitos)." });
  return normalizarMatricula(limpo);
}

export function pinTrivial(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true;
  const crescente = "01234567890123456789";
  const decrescente = "98765432109876543210";
  return crescente.includes(pin) || decrescente.includes(pin);
}

export function pin(valor: unknown): string {
  if (typeof valor !== "string" || !/^\d{4,6}$/.test(valor)) invalido("PIN", "use de 4 a 6 números.");
  if (pinTrivial(valor)) invalido("PIN", "muito fácil de adivinhar (evite sequências e números repetidos).");
  return valor;
}

export function dataISO(valor: unknown, campo: string): string {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) invalido(campo, "data inválida.");
  const [ano, mes, dia] = valor.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  if (data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== dia) {
    invalido(campo, "data inválida.");
  }
  return valor;
}

export function horaHHMM(valor: unknown, campo: string): string {
  if (typeof valor !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(valor)) invalido(campo, "hora inválida (use HH:MM).");
  return valor;
}

export function fusoHorario(valor: unknown): string {
  const fuso = texto(valor, "Fuso horário", { max: 60 });
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: fuso });
  } catch {
    invalido("Fuso horário", "fuso desconhecido.");
  }
  return fuso;
}

// Jornada prevista em minutos para cada dia da semana (0 = domingo ... 6 = sábado).
export function jornada(valor: unknown): number[] {
  if (!Array.isArray(valor) || valor.length !== 7) invalido("Jornada", "informe os 7 dias da semana.");
  return valor.map((minutos) => inteiro(minutos, "Jornada", 0, 24 * 60));
}
