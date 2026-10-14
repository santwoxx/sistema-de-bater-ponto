import { createHash, createPrivateKey, sign, type KeyObject } from "node:crypto";
import forge from "node-forge";

// Assinatura eletrônica dos documentos do REP-P (Portaria 671, arts. 86 a 88),
// com o certificado digital ICP-Brasil (A1) do desenvolvedor: AFD e AEJ em
// CAdES, num arquivo .p7s separado, e o comprovante do trabalhador em PAdES
// (PDF). A estrutura CMS (SignedData) é montada aqui, com os atributos
// assinados que o CAdES pede: tipo do conteúdo, resumo (SHA-256), certificado
// do assinante (signing-certificate-v2) e, fora do PDF, a hora da assinatura.

const asn1 = forge.asn1;
type No = forge.asn1.Asn1;

const OID = {
  data: "1.2.840.113549.1.7.1",
  signedData: "1.2.840.113549.1.7.2",
  sha256: "2.16.840.1.101.3.4.2.1",
  rsa: "1.2.840.113549.1.1.1",
  ecdsaSha256: "1.2.840.10045.4.3.2",
  contentType: "1.2.840.113549.1.9.3",
  messageDigest: "1.2.840.113549.1.9.4",
  signingTime: "1.2.840.113549.1.9.5",
  signingCertificateV2: "1.2.840.113549.1.9.16.2.47",
};

export interface Certificado {
  chave: KeyObject;
  /** Certificado do titular primeiro, depois a cadeia (ACs), em DER. */
  cadeia: Buffer[];
  titular: string;
  /** CNPJ ou CPF do titular, quando o certificado traz (padrão ICP-Brasil: "NOME:DOCUMENTO" no CN). */
  documento: string;
  emissor: string;
  validoDe: Date;
  validoAte: Date;
  /** A cadeia termina na ICP-Brasil (O=ICP-Brasil). */
  icpBrasil: boolean;
}

const binario = (buffer: Buffer) => forge.util.createBuffer(buffer.toString("binary"));
const paraBuffer = (no: No) => Buffer.from(asn1.toDer(no).getBytes(), "binary");

function oid(valor: string): No {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(valor).getBytes());
}
function sequencia(itens: No[]): No {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, itens);
}
function conjunto(itens: No[]): No {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, itens);
}
function octetos(dados: Buffer): No {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, dados.toString("binary"));
}
function inteiro(valor: number): No {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, asn1.integerToDer(valor).getBytes());
}
function algoritmo(identificador: string, comNull: boolean): No {
  return sequencia(comNull ? [oid(identificador), asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, "")] : [oid(identificador)]);
}
function atributo(tipo: string, valor: No): No {
  return sequencia([oid(tipo), conjunto([valor])]);
}

/** SET OF em DER: os elementos vão em ordem crescente da codificação (exigência do DER). */
function conjuntoOrdenado(itens: No[], classe = asn1.Class.UNIVERSAL, tipo: number = asn1.Type.SET): No {
  const ordenados = itens.map((item) => ({ item, der: paraBuffer(item) })).sort((a, b) => Buffer.compare(a.der, b.der));
  return asn1.create(classe, tipo, true, ordenados.map((o) => o.item));
}

/** Emissor e número de série, como estão no próprio certificado (sem recodificar). */
function emissorESerie(der: Buffer): { emissor: No; serie: No } {
  const tbs = (asn1.fromDer(binario(der)).value as No[])[0];
  const campos = tbs.value as No[];
  const deslocamento = campos[0].tagClass === asn1.Class.CONTEXT_SPECIFIC ? 1 : 0;
  return { serie: campos[deslocamento], emissor: campos[deslocamento + 2] };
}

/** Lê o certificado A1 (arquivo .pfx/.p12, PKCS#12) com a senha. */
export function lerCertificado(pfx: Buffer, senha: string): Certificado {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1.fromDer(binario(pfx)), false, senha);
  } catch {
    throw new Error("Não foi possível abrir o certificado: confira o arquivo (.pfx ou .p12) e a senha.");
  }
  const chaves = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ];
  const certificados = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [])
    .map((bag) => bag.cert)
    .filter((cert): cert is forge.pki.Certificate => Boolean(cert));
  const chaveForge = chaves[0]?.key;
  if (!chaveForge || certificados.length === 0) throw new Error("O arquivo não tem a chave privada e o certificado (precisa ser um certificado A1 completo).");

  const chave = createPrivateKey(forge.pki.privateKeyToPem(chaveForge));
  const publica = forge.pki.publicKeyToPem(forge.pki.rsa.setPublicKey((chaveForge as forge.pki.rsa.PrivateKey).n, (chaveForge as forge.pki.rsa.PrivateKey).e));
  const titular = certificados.find((cert) => forge.pki.publicKeyToPem(cert.publicKey) === publica);
  if (!titular) throw new Error("O certificado do arquivo não corresponde à chave privada.");
  const der = (cert: forge.pki.Certificate) => paraBuffer(forge.pki.certificateToAsn1(cert));
  const outros = certificados.filter((cert) => cert !== titular);

  const nome = String(titular.subject.getField("CN")?.value ?? "");
  const [titularNome, documento = ""] = nome.split(":");
  const organizacoes = certificados.flatMap((cert) => [cert.issuer.getField("O")?.value, cert.subject.getField("O")?.value]);
  return {
    chave,
    cadeia: [der(titular), ...outros.map(der)],
    titular: titularNome,
    documento: documento.replace(/\D/g, ""),
    emissor: String(titular.issuer.getField("CN")?.value ?? ""),
    validoDe: titular.validity.notBefore,
    validoAte: titular.validity.notAfter,
    icpBrasil: organizacoes.some((o) => String(o ?? "").includes("ICP-Brasil")),
  };
}

/**
 * Assinatura CMS destacada (o conteúdo não vai junto) no padrão CAdES. comHora:
 * inclui a hora da assinatura (no PAdES ela vai no próprio PDF, não aqui).
 * Devolve o SignedData em DER (o conteúdo do .p7s).
 */
export function assinarCms(conteudo: Buffer, certificado: Certificado, opcoes: { comHora: boolean; quando?: Date }): Buffer {
  const titularDer = certificado.cadeia[0];
  const { emissor, serie } = emissorESerie(titularDer);
  const resumoDoCertificado = createHash("sha256").update(titularDer).digest();
  const atributos = [
    atributo(OID.contentType, oid(OID.data)),
    atributo(OID.messageDigest, octetos(createHash("sha256").update(conteudo).digest())),
    // ESSCertIDv2 com SHA-256 (o algoritmo padrão, por isso omitido) e o emissor/série do certificado.
    atributo(
      OID.signingCertificateV2,
      sequencia([
        sequencia([
          sequencia([
            octetos(resumoDoCertificado),
            sequencia([sequencia([asn1.create(asn1.Class.CONTEXT_SPECIFIC, 4, true, [emissor])]), serie]),
          ]),
        ]),
      ]),
    ),
    ...(opcoes.comHora ? [atributo(OID.signingTime, asn1.create(asn1.Class.UNIVERSAL, asn1.Type.UTCTIME, false, asn1.dateToUtcTime(opcoes.quando ?? new Date())))] : []),
  ];
  // A assinatura é sobre os atributos codificados como SET; no SignerInfo eles vão com a marca [0].
  const assinado = paraBuffer(conjuntoOrdenado(atributos));
  const ec = certificado.chave.asymmetricKeyType === "ec";
  const assinatura = sign("sha256", assinado, certificado.chave);

  const signerInfo = sequencia([
    inteiro(1),
    sequencia([emissor, serie]),
    algoritmo(OID.sha256, true),
    conjuntoOrdenado(atributos, asn1.Class.CONTEXT_SPECIFIC, 0),
    ec ? algoritmo(OID.ecdsaSha256, false) : algoritmo(OID.rsa, true),
    octetos(assinatura),
  ]);
  const signedData = sequencia([
    inteiro(1),
    conjunto([algoritmo(OID.sha256, true)]),
    sequencia([oid(OID.data)]),
    asn1.create(
      asn1.Class.CONTEXT_SPECIFIC,
      0,
      true,
      certificado.cadeia.map((der) => asn1.fromDer(binario(der))),
    ),
    conjunto([signerInfo]),
  ]);
  return paraBuffer(sequencia([oid(OID.signedData), asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [signedData])]));
}
