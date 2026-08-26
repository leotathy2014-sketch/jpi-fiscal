import { DOMParser } from "@xmldom/xmldom";
import forge from "node-forge";
import { request as httpsRequest, type RequestOptions } from "node:https";
import type { ConnectionOptions } from "node:tls";
import { SignedXml } from "xml-crypto";

type ForgeCertificate = forge.pki.Certificate;
type ForgePrivateKey = forge.pki.rsa.PrivateKey;
type Asn1Node = { type: number; value: string | Asn1Node[] };
export type FiscalError = { codigo?: string; descricao?: string; complemento?: string };

const ICP_BRASIL_CNPJ_OID = "2.16.76.1.3.3";
export const digits = (value: unknown) => String(value || "").replace(/\D/g, "");

export function issueDateTime() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}-03:00`;
}

function sameRsaKey(certificate: ForgeCertificate, key: ForgePrivateKey) {
  const publicKey = certificate.publicKey as forge.pki.rsa.PublicKey;
  return Boolean(publicKey?.n && key?.n && publicKey.n.compareTo(key.n) === 0 && publicKey.e.compareTo(key.e) === 0);
}

function containsOid(node: Asn1Node, oid: string): boolean {
  if (node.type === forge.asn1.Type.OID && typeof node.value === "string") return forge.asn1.derToOid(node.value) === oid;
  return Array.isArray(node.value) && node.value.some(child => containsOid(child, oid));
}

function findFourteenDigits(node: Asn1Node): string {
  if (typeof node.value === "string") {
    const value = digits(node.value);
    return value.length === 14 ? value : "";
  }
  for (const child of node.value) {
    const value = findFourteenDigits(child);
    if (value) return value;
  }
  return "";
}

function certificateCnpj(certificate: ForgeCertificate) {
  const subjectCnpj = certificate.subject.attributes
    .filter(attribute => attribute.type === ICP_BRASIL_CNPJ_OID)
    .map(attribute => digits(attribute.value))
    .find(value => value.length === 14);
  if (subjectCnpj) return subjectCnpj;
  const subjectAltName = certificate.getExtension("subjectAltName") as { altNames?: Array<{ type: number; value: unknown }> } | null;
  for (const altName of subjectAltName?.altNames || []) {
    if (altName.type !== 0 || !Array.isArray(altName.value)) continue;
    const node: Asn1Node = { type: 0, value: altName.value as Asn1Node[] };
    if (containsOid(node, ICP_BRASIL_CNPJ_OID)) {
      const value = findFourteenDigits(node);
      if (value) return value;
    }
  }
  const commonName = String(certificate.subject.getField("CN")?.value || "");
  return (commonName.match(/\d{14}/g) || [])[0] || "";
}

export function readCertificate(pfx: Buffer, password: string, expectedCnpj: string) {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(pfx.toString("binary"));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  } catch {
    throw new Error("Não foi possível abrir o A1. Confira a senha do certificado.");
  }
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  const keyBags = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || []),
  ];
  const key = keyBags.map(bag => bag.key).find(Boolean) as ForgePrivateKey | undefined;
  const certificates = certBags.map(bag => bag.cert).filter(Boolean) as ForgeCertificate[];
  const leaf = key ? certificates.find(certificate => sameRsaKey(certificate, key)) : undefined;
  if (!key || !leaf) throw new Error("O A1 não contém uma chave RSA e um certificado compatíveis.");
  const now = Date.now();
  if (leaf.validity.notBefore.getTime() > now || leaf.validity.notAfter.getTime() < now) throw new Error("O certificado A1 está fora do período de validade.");
  if (certificateCnpj(leaf) !== digits(expectedCnpj)) throw new Error("O CNPJ do certificado A1 não corresponde ao CNPJ do prestador.");
  const extendedKeyUsage = leaf.getExtension("extKeyUsage") as { clientAuth?: boolean } | null;
  if (!extendedKeyUsage?.clientAuth) throw new Error("O certificado A1 não possui a finalidade Autenticação do Cliente.");
  const privateKeyInfo = forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(key));
  return {
    privateKeyPem: forge.pki.privateKeyInfoToPem(privateKeyInfo),
    certificatePem: forge.pki.certificateToPem(leaf),
  };
}

export function signXmlElement(xml: string, elementName: string, privateKeyPem: string, certificatePem: string) {
  const xpath = `//*[local-name(.)='${elementName}']`;
  const signer = new SignedXml({
    privateKey: privateKeyPem,
    publicCert: certificatePem,
    getKeyInfoContent: SignedXml.getKeyInfoContent,
    signatureAlgorithm: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
    canonicalizationAlgorithm: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
  });
  signer.addReference({
    xpath,
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
    ],
    digestAlgorithm: "http://www.w3.org/2000/09/xmldsig#sha1",
  });
  signer.computeSignature(xml, { location: { reference: xpath, action: "after" } });
  const signedXml = signer.getSignedXml();
  const document = new DOMParser().parseFromString(signedXml, "application/xml");
  const signature = document.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "Signature")[0];
  if (!signature) throw new Error("A assinatura XML não foi criada.");
  const verifier = new SignedXml({ publicCert: certificatePem, getCertFromKeyInfo: () => null });
  verifier.loadSignature(signature);
  if (!verifier.checkSignature(signedXml) || verifier.getSignedReferences().length !== 1) throw new Error("A conferência local da assinatura XML falhou.");
  return signedXml;
}

export function postJsonWithCertificate(url: string, body: string, pfx: Buffer, passphrase: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const target = new URL(url);
    const payload = Buffer.from(body, "utf8");
    const options: RequestOptions & ConnectionOptions = {
      method: "POST",
      pfx,
      passphrase,
      minVersion: "TLSv1.2",
      maxVersion: "TLSv1.2",
      ALPNProtocols: ["http/1.1"],
      rejectUnauthorized: true,
      agent: false,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": payload.byteLength,
        Connection: "close",
      },
    };
    const request = httpsRequest(target, options, response => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", chunk => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > 20 * 1024 * 1024) return response.destroy(new Error("A resposta da produção restrita excedeu o limite seguro."));
        chunks.push(bytes);
      });
      response.on("end", () => resolve({ status: response.statusCode || 0, body: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", reject);
    });
    request.setTimeout(30000, () => request.destroy(new Error("Tempo esgotado ao acessar a produção restrita.")));
    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

function shortText(value: unknown, maxLength: number) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/[\r\n\t]+/g, " ").trim().slice(0, maxLength);
}

function fiscalError(value: unknown, fallbackCode = ""): FiscalError | null {
  if (typeof value === "string" || typeof value === "number") {
    const descricao = shortText(value, 500);
    return descricao ? { codigo: shortText(fallbackCode, 30), descricao } : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const codigo = shortText(record.codigo ?? record.Codigo ?? record.code ?? record.Code ?? fallbackCode, 30);
  const descricao = shortText(record.descricao ?? record.Descricao ?? record.mensagem ?? record.Mensagem ?? record.message ?? record.Message, 500);
  const complemento = shortText(record.complemento ?? record.Complemento ?? record.campo ?? record.Campo, 500);
  return codigo || descricao || complemento ? { codigo, descricao: descricao || "Rejeição sem descrição.", complemento } : null;
}

export function safeFiscalErrors(data: unknown) {
  const candidates: Array<{ value: unknown; code?: string }> = [];
  if (Array.isArray(data)) data.forEach(value => candidates.push({ value }));
  else if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    for (const key of ["erros", "Erros", "erro", "Erro", "errors", "Errors"]) {
      const group = record[key];
      if (Array.isArray(group)) group.forEach(value => candidates.push({ value }));
      else if (group !== undefined && group !== null) candidates.push({ value: group });
    }
    if (!candidates.length) candidates.push({ value: record });
  }
  return candidates.map(candidate => fiscalError(candidate.value, candidate.code)).filter((item): item is FiscalError => Boolean(item)).slice(0, 5);
}

export function safeTechnicalError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || "Falha sem mensagem.");
  return raw
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, "[CONTEUDO_CRIPTOGRAFICO_REMOVIDO]")
    .replace(/((?:password|senha|passphrase)\s*[:=]\s*)[^\s,;]+/gi, "$1[REMOVIDO]")
    .replace(/\b\d{11,14}\b/g, "[DOCUMENTO_REMOVIDO]")
    .replace(/\b[A-Za-z0-9+/=]{64,}\b/g, "[DADO_LONGO_REMOVIDO]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 500);
}
