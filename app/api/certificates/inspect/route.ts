import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import forge from "node-forge";

export const runtime = "nodejs";

const digits = (value: string) => value.replace(/\D/g, "");
const ICP_BRASIL_CNPJ_OID = "2.16.76.1.3.3";

type Asn1Node = { type: number; value: string | Asn1Node[] };

function attributeValue(attributes: forge.pki.CertificateField[], names: string[]) {
  const attribute = attributes.find(item => names.includes(item.name || "") || names.includes(item.shortName || "") || names.includes(item.type || ""));
  return attribute ? String(attribute.value) : "";
}

function containsOid(node: Asn1Node, oid: string): boolean {
  if (node.type === forge.asn1.Type.OID && typeof node.value === "string") {
    return forge.asn1.derToOid(node.value) === oid;
  }
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

function certificateCnpj(certificate: forge.pki.Certificate, commonName: string) {
  const subjectCnpj = digits(attributeValue(certificate.subject.attributes, [ICP_BRASIL_CNPJ_OID]));
  if (subjectCnpj.length === 14) return subjectCnpj;

  const subjectAltName = certificate.getExtension("subjectAltName") as { altNames?: Array<{ type: number; value: unknown }> } | null;
  for (const altName of subjectAltName?.altNames || []) {
    if (altName.type !== 0 || !Array.isArray(altName.value)) continue;
    const node: Asn1Node = { type: 0, value: altName.value as Asn1Node[] };
    if (containsOid(node, ICP_BRASIL_CNPJ_OID)) {
      const value = findFourteenDigits(node);
      if (value) return value;
    }
  }

  const commonNameValues = commonName.match(/\d{14}/g) || [];
  return commonNameValues[0] || "";
}

function bagLocalKeyId(bag: forge.pkcs12.Bag) {
  const value = bag.attributes?.localKeyId?.[0];
  return value ? forge.util.bytesToHex(String(value)) : "";
}

function rsaKeyMatches(certificate: forge.pki.Certificate, key: forge.pki.PrivateKey) {
  const publicKey = certificate.publicKey as forge.pki.rsa.PublicKey;
  const privateKey = key as forge.pki.rsa.PrivateKey;
  return Boolean(publicKey.n && privateKey.n && publicKey.n.compareTo(privateKey.n) === 0 && publicKey.e.compareTo(privateKey.e) === 0);
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!supabaseUrl || !supabaseKey || !token) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });

  const form = await request.formData();
  const file = form.get("certificate");
  const password = String(form.get("password") || "");
  if (!(file instanceof File) || file.size === 0 || file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "Selecione um certificado A1 de até 5 MB." }, { status: 400 });
  }
  if (!password) return NextResponse.json({ error: "Informe a senha do certificado." }, { status: 400 });

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const asn1 = forge.asn1.fromDer(bytes.toString("binary"));
    const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
    const certificateBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
    const shroudedKeyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [];
    const keyBags = p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [];
    const privateKeyBag = [...shroudedKeyBags, ...keyBags].find(bag => bag.key);
    if (!privateKeyBag?.key) {
      return NextResponse.json({ error: "O arquivo não contém a chave privada de um certificado A1." }, { status: 400 });
    }

    const localKeyId = bagLocalKeyId(privateKeyBag);
    const matchingBag = certificateBags.find(bag => bag.cert && localKeyId && bagLocalKeyId(bag) === localKeyId)
      || certificateBags.find(bag => bag.cert && rsaKeyMatches(bag.cert, privateKeyBag.key!));
    const certificate = matchingBag?.cert;
    if (!certificate) {
      return NextResponse.json({ error: "Não foi possível localizar o certificado vinculado à chave privada do A1." }, { status: 400 });
    }

    const now = new Date();
    if (certificate.validity.notAfter.getTime() < now.getTime()) {
      return NextResponse.json({ error: `Este certificado venceu em ${certificate.validity.notAfter.toLocaleDateString("pt-BR")}.` }, { status: 400 });
    }
    if (certificate.validity.notBefore.getTime() > now.getTime()) {
      return NextResponse.json({ error: "Este certificado ainda não está válido." }, { status: 400 });
    }

    const subject = certificate.subject.attributes;
    const commonName = attributeValue(subject, ["commonName", "CN"]);
    const issuer = attributeValue(certificate.issuer.attributes, ["commonName", "CN", "organizationName", "O"]);
    return NextResponse.json({
      validFrom: certificate.validity.notBefore.toISOString().slice(0, 10),
      validTo: certificate.validity.notAfter.toISOString().slice(0, 10),
      holder: commonName,
      cnpj: certificateCnpj(certificate, commonName),
      issuer,
      serialNumber: certificate.serialNumber.toUpperCase(),
    });
  } catch {
    return NextResponse.json({ error: "Não foi possível abrir o certificado. Confira o arquivo e a senha informada." }, { status: 400 });
  }
}
