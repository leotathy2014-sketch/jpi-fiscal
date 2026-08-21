import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import forge from "node-forge";

export const runtime = "nodejs";

const digits = (value: string) => value.replace(/\D/g, "");

function attributeValue(attributes: forge.pki.CertificateField[], names: string[]) {
  const attribute = attributes.find(item => names.includes(item.name || "") || names.includes(item.shortName || "") || names.includes(item.type || ""));
  return attribute ? String(attribute.value) : "";
}

function certificateCnpj(attributes: forge.pki.CertificateField[], commonName: string) {
  const icpBrasilCnpj = attributeValue(attributes, ["2.16.76.1.3.3"]);
  const candidates = [icpBrasilCnpj, ...attributes.map(item => String(item.value)), commonName];
  for (const candidate of candidates) {
    const matches = candidate.match(/\d[\d.\/-]{12,20}\d/g) || [];
    for (const match of matches) {
      const value = digits(match);
      if (value.length === 14) return value;
    }
  }
  return "";
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
    const bags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
    const certificates = bags.flatMap(bag => bag.cert ? [bag.cert] : []);
    const certificate = certificates.find(cert => {
      const constraints = cert.getExtension("basicConstraints") as { cA?: boolean } | null;
      return !constraints?.cA;
    }) || certificates[0];
    if (!certificate) return NextResponse.json({ error: "O arquivo não contém um certificado válido." }, { status: 400 });

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
      cnpj: certificateCnpj(subject, commonName),
      issuer,
      serialNumber: certificate.serialNumber.toUpperCase(),
    });
  } catch {
    return NextResponse.json({ error: "Não foi possível abrir o certificado. Confira o arquivo e a senha informada." }, { status: 400 });
  }
}
