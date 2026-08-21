import { createClient } from "npm:@supabase/supabase-js@2.56.0";
import { DOMParser } from "npm:@xmldom/xmldom@0.8.14";
import forge from "npm:node-forge@1.3.1";
import { gzip, ungzip } from "npm:pako@2.1.0";
import { SignedXml } from "npm:xml-crypto@6.1.2";

const HOMOLOGATION_URL = "https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional/nfse";
const XML_BUCKET = "documentos-nfse";
const CERTIFICATE_BUCKET = "certificados-a1";
const CORS_HEADERS = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "https://jpi-fiscal.vercel.app",
  Vary: "Origin",
};

type ForgeCertificate = forge.pki.Certificate;
type ForgePrivateKey = forge.pki.rsa.PrivateKey;
type FiscalError = { codigo?: string; descricao?: string; complemento?: string };
type SefinResponse = {
  tipoAmbiente?: number;
  versaoAplicativo?: string;
  dataHoraProcessamento?: string;
  idDps?: string;
  chaveAcesso?: string;
  nfseXmlGZipB64?: string;
  alertas?: FiscalError[];
  erros?: FiscalError[];
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

function binaryString(bytes: Uint8Array) {
  let result = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    result += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return result;
}

function bytesToBase64(bytes: Uint8Array) {
  return btoa(binaryString(bytes));
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function sameRsaKey(certificate: ForgeCertificate, key: ForgePrivateKey) {
  const publicKey = certificate.publicKey as forge.pki.rsa.PublicKey;
  return Boolean(publicKey?.n && key?.n && publicKey.n.compareTo(key.n) === 0);
}

function readCertificate(pfx: Uint8Array, password: string) {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(binaryString(pfx)));
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

  const privateKeyInfo = forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(key));
  const privateKeyPem = forge.pki.privateKeyInfoToPem(privateKeyInfo);
  const certificatePem = forge.pki.certificateToPem(leaf);
  const certificateChainPem = [leaf, ...certificates.filter(certificate => certificate !== leaf)]
    .map(certificate => forge.pki.certificateToPem(certificate))
    .join("\n");
  return { privateKeyPem, certificatePem, certificateChainPem };
}

function signDps(xml: string, privateKeyPem: string, certificatePem: string) {
  if (!xml.includes("<tpAmb>2</tpAmb>")) throw new Error("O XML não pertence à produção restrita.");
  const signer = new SignedXml({
    privateKey: privateKeyPem,
    publicCert: certificatePem,
    getKeyInfoContent: SignedXml.getKeyInfoContent,
    signatureAlgorithm: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
    canonicalizationAlgorithm: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
  });
  signer.addReference({
    xpath: "//*[local-name(.)='infDPS']",
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
    ],
    digestAlgorithm: "http://www.w3.org/2000/09/xmldsig#sha1",
  });
  signer.computeSignature(xml, { location: { reference: "//*[local-name(.)='infDPS']", action: "after" } });
  const signedXml = signer.getSignedXml();

  const document = new DOMParser().parseFromString(signedXml, "application/xml");
  const signature = document.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "Signature")[0];
  if (!signature) throw new Error("A assinatura XML não foi criada.");
  const verifier = new SignedXml({ publicCert: certificatePem, getCertFromKeyInfo: () => null });
  verifier.loadSignature(signature);
  if (!verifier.checkSignature(signedXml) || verifier.getSignedReferences().length !== 1) {
    throw new Error("A conferência local da assinatura XML falhou.");
  }
  return signedXml;
}

function safeFiscalErrors(data: SefinResponse) {
  return (data.erros || []).slice(0, 5).map(error => ({
    codigo: String(error.codigo || "").slice(0, 30),
    descricao: String(error.descricao || "Rejeição sem descrição.").slice(0, 500),
    complemento: String(error.complemento || "").slice(0, 500),
  }));
}

async function postToRestrictedProduction(body: string, certificateChainPem: string, privateKeyPem: string) {
  const client = Deno.createHttpClient({ cert: certificateChainPem, key: privateKeyPem, http1: true });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    return await fetch(HOMOLOGATION_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body,
      signal: controller.signal,
      client,
    } as RequestInit & { client: Deno.HttpClient });
  } finally {
    clearTimeout(timer);
    client.close();
  }
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) return json({ error: "Configuração segura indisponível." }, 500);

  const token = authorization.replace(/^Bearer\s+/i, "");
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: userError } = await userClient.auth.getUser(token);
  if (userError || !user?.email) return json({ error: "Sessão expirada. Entre novamente." }, 401);

  const { data: access } = await userClient.from("app_users").select("role,active").eq("email", user.email).maybeSingle();
  if (!access?.active || !["admin", "financeiro"].includes(access.role)) {
    return json({ error: "Seu usuário não possui permissão para emitir em homologação." }, 403);
  }

  let monthlyId = 0;
  let password = "";
  try {
    const body = await request.json();
    monthlyId = Number(body.monthlyId);
    password = String(body.password || "");
  } catch {
    return json({ error: "Dados da solicitação inválidos." }, 400);
  }
  if (!Number.isSafeInteger(monthlyId) || monthlyId <= 0) return json({ error: "Mensalidade inválida." }, 400);
  if (!password || password.length > 256) return json({ error: "Informe a senha do certificado A1." }, 400);

  const { data: payment, error: paymentError } = await userClient
    .from("mensalidades")
    .select("id,valor_nfse,dps_xml_path,dps_xml_id,chave_nfse_homologacao,nfse_homologacao_xml_path,homologacao_emitida_em")
    .eq("id", monthlyId)
    .maybeSingle();
  if (paymentError || !payment) return json({ error: "Mensalidade não encontrada ou sem permissão de acesso." }, 404);
  if (payment.chave_nfse_homologacao) {
    return json({
      ok: true,
      alreadyIssued: true,
      environment: "Produção restrita",
      key: payment.chave_nfse_homologacao,
      issuedAt: payment.homologacao_emitida_em,
    });
  }
  if (!payment.dps_xml_path || !payment.dps_xml_id) return json({ error: "Gere e guarde primeiro o XML da DPS." }, 400);

  const { data: certificate } = await admin
    .from("certificados_a1")
    .select("arquivo_caminho,validade")
    .eq("status", "ATIVO")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!certificate) return json({ error: "Certificado A1 ativo não encontrado." }, 400);
  if (new Date(`${certificate.validade}T23:59:59-03:00`).getTime() < Date.now()) return json({ error: "O certificado A1 está vencido." }, 400);

  const [{ data: pfxFile, error: pfxError }, { data: xmlFile, error: xmlError }] = await Promise.all([
    admin.storage.from(CERTIFICATE_BUCKET).download(certificate.arquivo_caminho),
    admin.storage.from(XML_BUCKET).download(payment.dps_xml_path),
  ]);
  if (pfxError || !pfxFile) return json({ error: "Não foi possível acessar o certificado privado." }, 500);
  if (xmlError || !xmlFile) return json({ error: "Não foi possível acessar o XML privado da DPS." }, 500);

  try {
    const unsignedXml = await xmlFile.text();
    if (!unsignedXml.includes(`Id="${payment.dps_xml_id}"`)) return json({ error: "O identificador do XML não confere com o cadastro." }, 409);
    const keys = readCertificate(new Uint8Array(await pfxFile.arrayBuffer()), password);
    password = "";
    const signedXml = signDps(unsignedXml, keys.privateKeyPem, keys.certificatePem);
    const signedPath = `dps-assinada/${payment.id}/${payment.dps_xml_id}.xml`;
    const { error: signedUploadError } = await admin.storage
      .from(XML_BUCKET)
      .upload(signedPath, new Blob([signedXml], { type: "application/xml" }), { contentType: "application/xml", upsert: true });
    if (signedUploadError) throw new Error("Não foi possível guardar a DPS assinada.");

    const payload = JSON.stringify({ dpsXmlGZipB64: bytesToBase64(gzip(new TextEncoder().encode(signedXml))) });
    const response = await postToRestrictedProduction(payload, keys.certificateChainPem, keys.privateKeyPem);
    let sefin: SefinResponse = {};
    try { sefin = await response.json(); } catch { sefin = {}; }

    if (!response.ok || !sefin.nfseXmlGZipB64 || !sefin.chaveAcesso) {
      const fiscalErrors = safeFiscalErrors(sefin);
      await admin.from("mensalidades").update({ status_nfse: "Rejeitada em homologação", dps_assinada_xml_path: signedPath }).eq("id", payment.id);
      await admin.from("historico_nfse").insert({
        mensalidade_id: payment.id,
        evento: "nfse_homologacao_rejeitada",
        valor_anterior: payment.valor_nfse,
        valor_novo: payment.valor_nfse,
        detalhes: `Produção restrita respondeu HTTP ${response.status}. ${fiscalErrors.map(error => `${error.codigo}: ${error.descricao}`).join(" | ")}`.slice(0, 2000),
      });
      return json({ error: fiscalErrors[0]?.descricao || `A produção restrita respondeu com o código ${response.status}.`, errors: fiscalErrors }, 422);
    }

    const nfseXml = new TextDecoder().decode(ungzip(base64ToBytes(sefin.nfseXmlGZipB64)));
    const safeKey = sefin.chaveAcesso.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
    if (!safeKey) throw new Error("A produção restrita retornou uma chave de acesso inválida.");
    const nfsePath = `nfse-homologacao/${payment.id}/${safeKey}.xml`;
    const { error: nfseUploadError } = await admin.storage
      .from(XML_BUCKET)
      .upload(nfsePath, new Blob([nfseXml], { type: "application/xml" }), { contentType: "application/xml", upsert: true });
    if (nfseUploadError) throw new Error("A nota de teste foi gerada, mas o XML retornado não pôde ser guardado.");

    const issuedAt = sefin.dataHoraProcessamento || new Date().toISOString();
    const { error: updateError } = await admin.from("mensalidades").update({
      status_nfse: "NFS-e emitida em homologação",
      dps_assinada_xml_path: signedPath,
      nfse_homologacao_xml_path: nfsePath,
      chave_nfse_homologacao: sefin.chaveAcesso,
      homologacao_emitida_em: issuedAt,
    }).eq("id", payment.id);
    if (updateError) throw new Error("A nota de teste foi gerada, mas o cadastro não pôde ser atualizado.");
    await admin.from("historico_nfse").insert({
      mensalidade_id: payment.id,
      evento: "nfse_homologacao_emitida",
      valor_anterior: payment.valor_nfse,
      valor_novo: payment.valor_nfse,
      detalhes: `NFS-e gerada exclusivamente na produção restrita. Chave ${sefin.chaveAcesso}. Aplicativo ${sefin.versaoAplicativo || "não informado"}. XMLs guardados no repositório privado.`,
    });
    return json({
      ok: true,
      environment: "Produção restrita",
      key: sefin.chaveAcesso,
      issuedAt,
      alerts: sefin.alertas || [],
    });
  } catch (error) {
    password = "";
    const message = error instanceof Error ? error.message : "Falha inesperada na homologação.";
    const safeMessage = /password|senha|A1|assinatura|certificado|XML|produção restrita|nota de teste/i.test(message)
      ? message
      : "Não foi possível concluir a comunicação com a produção restrita.";
    return json({ error: safeMessage }, 502);
  }
});
