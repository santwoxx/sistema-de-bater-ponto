import { createHash, createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import forge from "node-forge";
import { describe, expect, it } from "vitest";
import { assinarCms, lerCertificado } from "./assinatura";
import { gerarComprovantePdf } from "./comprovantePdf";
import { criarZip } from "./zip";

const asn1 = forge.asn1;
const SENHA = "senha-de-teste";

/** Certificado A1 de teste (autoassinado, não ICP-Brasil), no formato PKCS#12 como o de verdade. */
function certificadoDeTeste(): Buffer {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const chave = forge.pki.privateKeyFromPem(privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.setRsaPublicKey(chave.n, chave.e);
  cert.serialNumber = "0a1b2c";
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  const nome = [
    { name: "commonName", value: "EMPRESA TESTE:11444777000161" },
    { name: "organizationName", value: "Teste" },
  ];
  cert.setSubject(nome);
  cert.setIssuer(nome);
  cert.sign(chave, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(chave, [cert], SENHA, { algorithm: "3des" });
  return Buffer.from(asn1.toDer(p12).getBytes(), "binary");
}

/** Confere uma assinatura CMS destacada: resumo do conteúdo e assinatura RSA sobre os atributos. */
function conferirCms(cms: Buffer, conteudo: Buffer, chavePublicaDer: Buffer) {
  const raiz = asn1.fromDer(forge.util.createBuffer(cms.toString("binary")));
  const signedData = ((raiz.value as forge.asn1.Asn1[])[1].value as forge.asn1.Asn1[])[0];
  const partes = signedData.value as forge.asn1.Asn1[];
  const signerInfo = (partes[partes.length - 1].value as forge.asn1.Asn1[])[0];
  const campos = signerInfo.value as forge.asn1.Asn1[];
  const atributos = campos[3];
  const assinatura = Buffer.from(campos[5].value as string, "binary");
  const resumo = (atributos.value as forge.asn1.Asn1[])
    .map((a) => a.value as forge.asn1.Asn1[])
    .find((a) => asn1.derToOid(a[0].value as string) === "1.2.840.113549.1.9.4");
  const resumoGravado = Buffer.from(((resumo?.[1].value as forge.asn1.Asn1[])[0].value as string) ?? "", "binary");
  expect(resumoGravado.equals(createHash("sha256").update(conteudo).digest())).toBe(true);
  // A assinatura é sobre os atributos como SET (marca 0x31 no lugar de [0]).
  const der = Buffer.from(asn1.toDer(atributos).getBytes(), "binary");
  der[0] = 0x31;
  const publica = createPublicKey({ key: chavePublicaDer, format: "der", type: "spki" });
  return verify("sha256", der, publica, assinatura);
}

const pfx = certificadoDeTeste();

function chavePublicaDe(certificadoDer: Buffer): Buffer {
  const cert = forge.pki.certificateFromAsn1(asn1.fromDer(forge.util.createBuffer(certificadoDer.toString("binary"))));
  return Buffer.from(asn1.toDer(forge.pki.publicKeyToAsn1(cert.publicKey)).getBytes(), "binary");
}

describe("assinatura dos documentos do REP-P", () => {
  it("lê o certificado A1 com a senha; senha errada dá mensagem clara", () => {
    const certificado = lerCertificado(pfx, SENHA);
    expect(certificado.titular).toBe("EMPRESA TESTE");
    expect(certificado.documento).toBe("11444777000161");
    expect(certificado.icpBrasil).toBe(false);
    expect(certificado.cadeia).toHaveLength(1);
    expect(() => lerCertificado(pfx, "errada")).toThrow(/confira o arquivo .* e a senha/);
  });

  it("CAdES destacado (AFD): resumo SHA-256 do arquivo e assinatura que confere; arquivo alterado não confere", () => {
    const certificado = lerCertificado(pfx, SENHA);
    const afd = Buffer.from("000000000111222333000181\r\n", "latin1");
    const p7s = assinarCms(afd, certificado, { comHora: true });
    const chavePublica = chavePublicaDe(certificado.cadeia[0]);
    expect(conferirCms(p7s, afd, chavePublica)).toBe(true);
    expect(() => conferirCms(p7s, Buffer.from("alterado", "latin1"), chavePublica)).toThrow();
  });

  it("comprovante em PDF assinado (PAdES): ByteRange cobre tudo menos a assinatura, que confere", async () => {
    const certificado = lerCertificado(pfx, SENHA);
    const pdf = await gerarComprovantePdf(
      {
        nsr: 4,
        empregador: { nome: "Loja Centro", documento: "11222333000181", endereco: "Rua A, 1 - Centro" },
        trabalhador: { nome: "Maria Souza", cpf: "52998224725" },
        dataHora: new Date("2026-10-14T11:02:00Z"),
        fuso: "America/Sao_Paulo",
        inpi: "5120260001234",
        hash: "a".repeat(64),
      },
      certificado,
    );
    const texto = pdf.toString("latin1");
    expect(texto.startsWith("%PDF-")).toBe(true);
    expect(texto).toContain("/ETSI.CAdES.detached");
    const [, a, b, c, d] = /\/ByteRange \[\s*(\d+) (\d+) (\d+) (\d+)\s*\]/.exec(texto)!.map(Number);
    expect(a).toBe(0);
    expect(c + d).toBe(pdf.length);
    expect(texto[b]).toBe("<");
    expect(texto[c - 1]).toBe(">");
    // O espaço reservado é maior que a assinatura: o tamanho real vem do próprio DER (30 82 LL LL).
    const reservado = Buffer.from(texto.slice(b + 1, c - 1), "hex");
    expect(reservado.subarray(0, 2).toString("hex")).toBe("3082");
    const cms = reservado.subarray(0, 4 + reservado.readUInt16BE(2));
    const chavePublica = chavePublicaDe(certificado.cadeia[0]);
    const assinado = Buffer.concat([pdf.subarray(0, b), pdf.subarray(c)]);
    expect(conferirCms(cms, assinado, chavePublica)).toBe(true);
  });

  it("sem certificado, o comprovante sai sem assinatura (e diz isso)", async () => {
    const pdf = await gerarComprovantePdf(
      {
        nsr: 1,
        empregador: { nome: "Loja", documento: "11222333000181", endereco: "" },
        trabalhador: { nome: "Maria", cpf: "52998224725" },
        dataHora: new Date(),
        fuso: "America/Sao_Paulo",
        inpi: "",
        hash: "b".repeat(64),
      },
      null,
    );
    expect(pdf.toString("latin1")).not.toContain("/ByteRange");
  });

  it("ZIP com o AFD e o .p7s", () => {
    const zip = criarZip([
      { nome: "AFD.txt", conteudo: Buffer.from("linha\r\n") },
      { nome: "AFD.txt.p7s", conteudo: Buffer.from([0x30, 0x82]) },
    ]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
    expect(zip.readUInt16LE(zip.length - 12)).toBe(2);
    expect(zip.toString("latin1")).toContain("AFD.txt.p7s");
  });
});
