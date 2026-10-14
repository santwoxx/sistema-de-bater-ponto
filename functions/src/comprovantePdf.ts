import { PDFArray, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString, StandardFonts, rgb } from "pdf-lib";
import { assinarCms, type Certificado } from "./assinatura";
import { deslocamento } from "./portaria671";
import { partesNoFuso } from "./tempo";

// Comprovante de Registro de Ponto do Trabalhador em PDF (Portaria 671, arts.
// 79 e 80), assinado em PAdES com o certificado do desenvolvedor: o PDF sai
// com um espaço reservado para a assinatura, e o CMS (ver assinatura.ts) é
// calculado sobre o arquivo inteiro, menos esse espaço (o ByteRange).

export interface DadosComprovante {
  nsr: number;
  empregador: { nome: string; documento: string; endereco: string };
  trabalhador: { nome: string; cpf: string };
  dataHora: Date;
  fuso: string;
  /** Número do registro do REP-P no INPI ("" se ainda não houver). */
  inpi: string;
  /** Código hash SHA-256 da marcação (o mesmo do AFD). */
  hash: string;
}

/** Espaço reservado para a assinatura CMS (certificado, cadeia e atributos cabem com folga). */
const TAMANHO_ASSINATURA = 16_384;

const dois = (n: number) => String(n).padStart(2, "0");

function formatarDocumento(documento: string): string {
  if (/^\d{11}$/.test(documento)) return documento.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (/^[0-9A-Z]{14}$/.test(documento)) return documento.replace(/(.{2})(.{3})(.{3})(.{4})(.{2})/, "$1.$2.$3/$4-$5");
  return documento;
}

/** Data e hora do registro no fuso da empresa: "14/10/2026 às 08:02 (UTC-03:00)". */
export function dataHoraDoComprovante(data: Date, fuso: string): string {
  const p = partesNoFuso(data, fuso);
  const z = deslocamento(data, fuso);
  return `${dois(p.dia)}/${dois(p.mes)}/${p.ano} às ${dois(p.hora)}:${dois(p.minuto)} (UTC${z.slice(0, 3)}:${z.slice(3)})`;
}

/** Data no formato de data do PDF: D:AAAAMMDDhhmmss+00'00'. */
function dataPdf(data: Date): string {
  const p = partesNoFuso(data, "UTC");
  return `D:${p.ano}${dois(p.mes)}${dois(p.dia)}${dois(p.hora)}${dois(p.minuto)}${dois(p.segundo)}+00'00'`;
}

export async function gerarComprovantePdf(dados: DadosComprovante, certificado: Certificado | null, quando = new Date()): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const titulo = "Comprovante de Registro de Ponto do Trabalhador";
  pdf.setTitle(titulo);
  pdf.setCreator("Ponto Digital (REP-P)");
  pdf.setProducer("Ponto Digital");
  pdf.setCreationDate(quando);
  pdf.setModificationDate(quando);
  const pagina = pdf.addPage([420, 420]);
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  const cinza = rgb(0.35, 0.35, 0.35);

  let y = 385;
  pagina.drawText(titulo, { x: 24, y, size: 13, font: negrito });
  y -= 30;
  const campo = (rotulo: string, valor: string) => {
    pagina.drawText(rotulo, { x: 24, y, size: 8, font: normal, color: cinza });
    y -= 13;
    for (const linha of valor.match(/.{1,60}(\s|$)|.{1,60}/g) ?? [valor]) {
      pagina.drawText(linha.trim(), { x: 24, y, size: 10.5, font: negrito });
      y -= 14;
    }
    y -= 6;
  };
  campo("NSR (Número Sequencial de Registro)", String(dados.nsr).padStart(9, "0"));
  campo("Empregador", `${dados.empregador.nome} · ${dados.empregador.documento.length === 11 ? "CPF" : "CNPJ"} ${formatarDocumento(dados.empregador.documento)}`);
  if (dados.empregador.endereco) campo("Local da prestação do serviço", dados.empregador.endereco);
  campo("Trabalhador", `${dados.trabalhador.nome} · CPF ${formatarDocumento(dados.trabalhador.cpf)}`);
  campo("Data e horário do registro", dataHoraDoComprovante(dados.dataHora, dados.fuso));
  campo("Registro do REP-P no INPI", dados.inpi || "não informado");
  campo("Código hash (SHA-256) da marcação", `${dados.hash.slice(0, 32)} ${dados.hash.slice(32)}`);
  pagina.drawText(
    certificado
      ? `Assinado eletronicamente (PAdES) com certificado de ${certificado.titular}.`
      : "Sem assinatura eletrônica: o certificado do desenvolvedor ainda não foi configurado.",
    { x: 24, y: 20, size: 7.5, font: normal, color: cinza },
  );

  if (!certificado) return Buffer.from(await pdf.save());

  // Assinatura: campo de assinatura invisível apontando para o dicionário /Sig.
  // O ByteRange e o Contents ficam com marcadores, preenchidos depois de salvar.
  const byteRange = PDFArray.withContext(pdf.context);
  byteRange.push(PDFNumber.of(0));
  for (let i = 0; i < 3; i++) byteRange.push(PDFName.of("**********"));
  const assinatura = pdf.context.register(
    pdf.context.obj({
      Type: "Sig",
      Filter: "Adobe.PPKLite",
      SubFilter: "ETSI.CAdES.detached",
      ByteRange: byteRange,
      Contents: PDFHexString.of("0".repeat(TAMANHO_ASSINATURA * 2)),
      M: PDFString.of(dataPdf(quando)),
      Name: PDFString.of(certificado.titular),
      Reason: PDFString.of(titulo),
    }),
  );
  const campoAssinatura = pdf.context.register(
    pdf.context.obj({
      Type: "Annot",
      Subtype: "Widget",
      FT: "Sig",
      Rect: [0, 0, 0, 0],
      V: assinatura,
      T: PDFString.of("Assinatura"),
      F: 132,
      P: pagina.ref,
    }),
  );
  pagina.node.set(PDFName.of("Annots"), pdf.context.obj([campoAssinatura]));
  pdf.catalog.set(PDFName.of("AcroForm"), pdf.context.obj({ SigFlags: 3, Fields: [campoAssinatura] }));

  const bytes = Buffer.from(await pdf.save({ useObjectStreams: false }));
  const reservado = Buffer.from(`<${"0".repeat(TAMANHO_ASSINATURA * 2)}>`, "latin1");
  const inicio = bytes.indexOf(reservado);
  const fim = inicio + reservado.length;
  const marca = bytes.indexOf(Buffer.from("/**********", "latin1"));
  const abre = bytes.lastIndexOf(Buffer.from("[", "latin1"), marca);
  const fecha = bytes.indexOf(Buffer.from("]", "latin1"), marca);
  if (inicio < 0 || abre < 0 || fecha < 0) throw new Error("PDF do comprovante sem o espaço da assinatura.");

  const valores = `0 ${inicio} ${fim} ${bytes.length - fim}`;
  const largura = fecha - abre - 1;
  if (valores.length > largura) throw new Error("ByteRange não cabe no espaço reservado.");
  bytes.write(valores.padEnd(largura, " "), abre + 1, "latin1");

  const cms = assinarCms(Buffer.concat([bytes.subarray(0, inicio), bytes.subarray(fim)]), certificado, { comHora: false });
  if (cms.length > TAMANHO_ASSINATURA) throw new Error("Assinatura maior que o espaço reservado no PDF.");
  bytes.write(cms.toString("hex").toUpperCase(), inicio + 1, "latin1");
  return bytes;
}
