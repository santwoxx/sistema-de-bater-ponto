import { crc32 } from "node:zlib";

// Arquivo ZIP simples (sem compressão), para entregar o AFD junto com a
// assinatura (.p7s) num download só.

function horaDos(data: Date): { hora: number; dia: number } {
  return {
    hora: (data.getHours() << 11) | (data.getMinutes() << 5) | Math.floor(data.getSeconds() / 2),
    dia: ((data.getFullYear() - 1980) << 9) | ((data.getMonth() + 1) << 5) | data.getDate(),
  };
}

export function criarZip(arquivos: Array<{ nome: string; conteudo: Buffer }>, quando = new Date()): Buffer {
  const { hora, dia } = horaDos(quando);
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let posicao = 0;
  for (const { nome, conteudo } of arquivos) {
    const nomeBytes = Buffer.from(nome, "utf8");
    const crc = crc32(conteudo);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nome em UTF-8
    local.writeUInt16LE(0, 8); // sem compressão
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(dia, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(conteudo.length, 18);
    local.writeUInt32LE(conteudo.length, 22);
    local.writeUInt16LE(nomeBytes.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(hora, 12);
    central.writeUInt16LE(dia, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(conteudo.length, 20);
    central.writeUInt32LE(conteudo.length, 24);
    central.writeUInt16LE(nomeBytes.length, 28);
    central.writeUInt32LE(posicao, 42);
    locais.push(local, nomeBytes, conteudo);
    centrais.push(central, nomeBytes);
    posicao += local.length + nomeBytes.length + conteudo.length;
  }
  const diretorio = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(diretorio.length, 12);
  fim.writeUInt32LE(posicao, 16);
  return Buffer.concat([...locais, diretorio, fim]);
}
