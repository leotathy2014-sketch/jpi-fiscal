import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { DOMParser } from "@xmldom/xmldom";
import forge from "node-forge";
import { request as httpsRequest, type RequestOptions } from "node:https";
import type { ConnectionOptions } from "node:tls";
import { gzipSync, gunzipSync } from "node:zlib";
import { SignedXml } from "xml-crypto";
import { hasValidCnpj, isValidCpfCnpj, NFSE_OWN_APP_SERIES, NFSE_RESTRICTED_ENDPOINT } from "@/lib/nfse-dps";

export const runtime = "nodejs";
export const maxDuration = 60;

const HOMOLOGATION_URL = NFSE_RESTRICTED_ENDPOINT;
const XML_BUCKET = "documentos-nfse";
const CERTIFICATE_BUCKET = "certificados-a1";
const ICP_BRASIL_CNPJ_OID = "2.16.76.1.3.3";

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
type DpsSource = {
  id: number;
  competencia: string;
  valor_nfse: number;
  descricao_servico: string | null;
  alunos: {
    responsavel: string;
    cpf_cnpj: string | null;
    email: string | null;
    whatsapp: string | null;
    segmento: string;
  } | null;
};
type CompanySource = { cnpj: string; razao_social: string };
type Asn1Node = { type: number; value: string | Asn1Node[] };
type HomologationStage =
  | "validar_dados_fiscais"
  | "armazenar_dps"
  | "abrir_certificado"
  | "assinar_dps"
  | "armazenar_dps_assinada"
  | "transmitir_sefin"
  | "interpretar_retorno"
  | "armazenar_nfse_autorizada"
  | "atualizar_cadastro"
  | "registrar_historico";

const STAGE_ERRORS: Record<HomologationStage, { code: string; message: string }> = {
  validar_dados_fiscais: { code: "NFSE_HML_VALIDAR_DADOS", message: "Não foi possível validar os dados fiscais para a nota de teste." },
  armazenar_dps: { code: "NFSE_HML_ARMAZENAR_DPS", message: "Não foi possível guardar a DPS validada no ambiente seguro." },
  abrir_certificado: { code: "NFSE_HML_ABRIR_A1", message: "O certificado A1 não pôde ser preparado. Confira a senha e os dados do certificado." },
  assinar_dps: { code: "NFSE_HML_ASSINAR_DPS", message: "Não foi possível concluir a assinatura local da DPS com o certificado A1." },
  armazenar_dps_assinada: { code: "NFSE_HML_ARMAZENAR_ASSINADA", message: "Não foi possível guardar a DPS assinada no ambiente seguro." },
  transmitir_sefin: { code: "NFSE_HML_TRANSMITIR_NODE", message: "Não foi possível comunicar a nota de teste à produção restrita." },
  interpretar_retorno: { code: "NFSE_HML_LER_RETORNO", message: "A produção restrita respondeu, mas o retorno não pôde ser interpretado." },
  armazenar_nfse_autorizada: { code: "NFSE_HML_ARMAZENAR_NFSE", message: "A nota de teste foi gerada, mas o XML autorizado não pôde ser guardado." },
  atualizar_cadastro: { code: "NFSE_HML_ATUALIZAR_CADASTRO", message: "A nota de teste foi gerada, mas o cadastro não pôde ser atualizado." },
  registrar_historico: { code: "NFSE_HML_REGISTRAR_HISTORICO", message: "A nota de teste foi gerada, mas o histórico não pôde ser atualizado." },
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

const digits = (value: unknown) => String(value || "").replace(/\D/g, "");
const escapeXml = (value: unknown) => String(value || "").replace(/[<>&"']/g, character => ({
  "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;",
}[character] || character));

function safeTechnicalError(error: unknown) {
  const name = error instanceof Error ? error.name : "UnknownError";
  const rawMessage = error instanceof Error ? error.message : String(error || "Falha sem mensagem.");
  const message = rawMessage
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, "[CONTEUDO_CRIPTOGRAFICO_REMOVIDO]")
    .replace(/((?:password|senha|passphrase)\s*[:=]\s*)[^\s,;]+/gi, "$1[REMOVIDO]")
    .replace(/\b\d{11,14}\b/g, "[DOCUMENTO_REMOVIDO]")
    .replace(/\b[A-Za-z0-9+/=]{64,}\b/g, "[DADO_LONGO_REMOVIDO]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 500);
  return { name: name.slice(0, 80), message };
}

function competenceDate(value: string) {
  const match = value.trim().match(/^(0[1-9]|1[0-2])\/(20\d{2})$/);
  if (!match) throw new Error("A competência da mensalidade é inválida.");
  return `${match[2]}-${match[1]}-01`;
}

function issueDateTime() {
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

function buildRestrictedDps(payment: DpsSource, company: CompanySource) {
  const municipality = "3304557";
  const providerCnpj = digits(company.cnpj);
  const takerTaxId = digits(payment.alunos?.cpf_cnpj);
  const description = String(payment.descricao_servico || "").trim();
  const takerName = String(payment.alunos?.responsavel || "").trim();
  const series = NFSE_OWN_APP_SERIES;
  const number = String(payment.id);
  const normalizedSegment = String(payment.alunos?.segmento || "").toLocaleLowerCase("pt-BR");
  const nbs = normalizedSegment.includes("médio") ? "122013000"
    : normalizedSegment.includes("1º") || normalizedSegment.includes("6º") || normalizedSegment.includes("fundamental") ? "122012000"
    : "122011200";
  const municipalTaxCode = normalizedSegment.includes("médio") ? "003"
    : normalizedSegment.includes("1º") || normalizedSegment.includes("6º") || normalizedSegment.includes("fundamental") ? "002"
    : "001";
  if (!hasValidCnpj(providerCnpj)) throw new Error("O CNPJ do prestador é inválido.");
  if (!isValidCpfCnpj(takerTaxId)) throw new Error("O CPF/CNPJ do tomador é inválido.");
  if (!takerName) throw new Error("O responsável financeiro do tomador não foi informado.");
  if (!description || description.length > 1000) throw new Error("A descrição fiscal deve ter entre 1 e 1000 caracteres.");
  if (!Number.isFinite(Number(payment.valor_nfse)) || Number(payment.valor_nfse) <= 0) throw new Error("O valor da NFS-e é inválido.");
  const id = `DPS${municipality}2${providerCnpj}${series.padStart(5, "0")}${number.padStart(15, "0")}`;
  const document = takerTaxId.length === 11 ? `<CPF>${takerTaxId}</CPF>` : `<CNPJ>${takerTaxId}</CNPJ>`;
  const phone = digits(payment.alunos?.whatsapp);
  return { id, xml: `<?xml version="1.0" encoding="UTF-8"?>
<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01">
  <infDPS Id="${id}">
    <tpAmb>2</tpAmb><dhEmi>${issueDateTime()}</dhEmi><verAplic>JPI-FISCAL-1.01</verAplic>
    <serie>${series}</serie><nDPS>${number}</nDPS><dCompet>${competenceDate(payment.competencia)}</dCompet><tpEmit>1</tpEmit><cLocEmi>${municipality}</cLocEmi>
    <prest><CNPJ>${providerCnpj}</CNPJ><regTrib><opSimpNac>1</opSimpNac><regEspTrib>0</regEspTrib></regTrib></prest>
    <toma>${document}<xNome>${escapeXml(takerName)}</xNome>${phone.length >= 6 ? `<fone>${phone}</fone>` : ""}${payment.alunos?.email ? `<email>${escapeXml(payment.alunos.email.trim())}</email>` : ""}</toma>
    <serv><locPrest><cLocPrestacao>${municipality}</cLocPrestacao></locPrest><cServ><cTribNac>080101</cTribNac><cTribMun>${municipalTaxCode}</cTribMun><xDescServ>${escapeXml(description)}</xDescServ><cNBS>${nbs}</cNBS></cServ></serv>
    <valores><vServPrest><vServ>${Number(payment.valor_nfse).toFixed(2)}</vServ></vServPrest><trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN><pAliq>5.00</pAliq></tribMun><totTrib><vTotTrib><vTotTribFed>${Number(payment.valor_nfse).toFixed(2)}</vTotTribFed><vTotTribEst>0.00</vTotTribEst><vTotTribMun>0.00</vTotTribMun></vTotTrib></totTrib></trib></valores>
    <IBSCBS><finNFSe>0</finNFSe><indFinal>1</indFinal><cIndOp>030101</cIndOp><indDest>0</indDest><valores><trib><gIBSCBS><CST>200</CST><cClassTrib>200028</cClassTrib></gIBSCBS></trib></valores></IBSCBS>
  </infDPS>
</DPS>` };
}

function sameRsaKey(certificate: ForgeCertificate, key: ForgePrivateKey) {
  const publicKey = certificate.publicKey as forge.pki.rsa.PublicKey;
  return Boolean(publicKey?.n && key?.n && publicKey.n.compareTo(key.n) === 0 && publicKey.e.compareTo(key.e) === 0);
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

function readCertificate(pfx: Buffer, password: string, expectedCnpj: string) {
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
  if (leaf.validity.notBefore.getTime() > now || leaf.validity.notAfter.getTime() < now) {
    throw new Error("O certificado A1 está fora do período de validade.");
  }
  const cnpj = certificateCnpj(leaf);
  if (!cnpj || cnpj !== digits(expectedCnpj)) {
    throw new Error("O CNPJ do certificado A1 não corresponde ao CNPJ do prestador.");
  }
  const extendedKeyUsage = leaf.getExtension("extKeyUsage") as { clientAuth?: boolean } | null;
  if (!extendedKeyUsage?.clientAuth) {
    throw new Error("O certificado A1 não possui a finalidade Autenticação do Cliente.");
  }

  const privateKeyInfo = forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(key));
  return {
    privateKeyPem: forge.pki.privateKeyInfoToPem(privateKeyInfo),
    certificatePem: forge.pki.certificateToPem(leaf),
  };
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
  const codigo = shortText(record.codigo ?? record.Codigo ?? record.code ?? record.Code ?? record.status ?? fallbackCode, 30);
  const descricao = shortText(
    record.descricao ?? record.Descricao ?? record.description ?? record.Description ?? record.mensagem ?? record.Mensagem
      ?? record.message ?? record.Message ?? record.detail ?? record.Detail ?? record.title ?? record.Title,
    500,
  );
  const complemento = shortText(
    record.complemento ?? record.Complemento ?? record.complement ?? record.Complement ?? record.campo ?? record.Campo
      ?? record.field ?? record.Field,
    500,
  );
  return codigo || descricao || complemento
    ? { codigo, descricao: descricao || "Rejeição sem descrição.", complemento }
    : null;
}

function safeFiscalErrors(data: unknown) {
  const candidates: Array<{ value: unknown; code?: string }> = [];
  if (Array.isArray(data)) {
    data.forEach(value => candidates.push({ value }));
  } else if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    for (const key of ["erros", "Erros", "errors", "Errors", "erro", "Erro", "error", "Error", "violations", "Violations", "mensagens", "Mensagens", "messages", "Messages"]) {
      const group = record[key];
      if (Array.isArray(group)) {
        group.forEach(value => candidates.push({ value }));
      } else if (group && typeof group === "object") {
        for (const [field, value] of Object.entries(group as Record<string, unknown>)) {
          if (Array.isArray(value)) value.forEach(item => candidates.push({ value: item, code: field }));
          else candidates.push({ value, code: field });
        }
      } else if (group !== undefined && group !== null) {
        candidates.push({ value: group });
      }
    }
    if (candidates.length === 0) candidates.push({ value: record });
  } else if (data !== undefined && data !== null) {
    candidates.push({ value: data });
  }

  const normalized = candidates
    .map(candidate => fiscalError(candidate.value, candidate.code))
    .filter((error): error is FiscalError => Boolean(error))
    .slice(0, 5);
  return normalized.length > 0 ? normalized : [{ codigo: "", descricao: "Rejeição sem descrição.", complemento: "" }];
}

function postToRestrictedProduction(body: string, pfx: Buffer, passphrase: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const target = new URL(HOMOLOGATION_URL);
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
        if (size > 20 * 1024 * 1024) {
          response.destroy(new Error("A resposta da produção restrita excedeu o limite seguro."));
          return;
        }
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

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authorization = request.headers.get("authorization");
  const token = authorization?.replace(/^Bearer\s+/i, "");
  if (!supabaseUrl || !supabaseKey || !authorization || !token) return json({ error: "Sessão inválida." }, 401);

  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user?.email) return json({ error: "Sessão expirada. Entre novamente." }, 401);
  const { data: access } = await supabase.from("app_users").select("role,active").eq("email", user.email).maybeSingle();
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

  const { data: payment, error: paymentError } = await supabase
    .from("mensalidades")
    .select("id,competencia,valor_nfse,descricao_servico,dps_xml_path,dps_xml_id,chave_nfse_homologacao,nfse_homologacao_xml_path,homologacao_emitida_em,alunos(responsavel,cpf_cnpj,email,whatsapp,segmento)")
    .eq("id", monthlyId)
    .maybeSingle();
  if (paymentError || !payment) return json({ error: "Mensalidade não encontrada ou sem permissão de acesso." }, 404);
  if (payment.chave_nfse_homologacao) {
    return json({ ok: true, alreadyIssued: true, environment: "Produção restrita", key: payment.chave_nfse_homologacao, issuedAt: payment.homologacao_emitida_em });
  }
  if (!payment.dps_xml_path || !payment.dps_xml_id) return json({ error: "Gere e guarde primeiro a prévia XML da DPS." }, 400);

  const { data: company } = await supabase
    .from("configuracoes_empresa")
    .select("cnpj,razao_social")
    .eq("id", true)
    .maybeSingle();
  if (!company) return json({ error: "Os dados fiscais da empresa não foram encontrados." }, 400);
  const { data: certificate } = await supabase
    .from("certificados_a1")
    .select("arquivo_caminho,validade")
    .eq("status", "ATIVO")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!certificate) return json({ error: "Certificado A1 ativo não encontrado." }, 400);
  if (new Date(`${certificate.validade}T23:59:59-03:00`).getTime() < Date.now()) return json({ error: "O certificado A1 está vencido." }, 400);
  const { data: pfxFile, error: pfxError } = await supabase.storage.from(CERTIFICATE_BUCKET).download(certificate.arquivo_caminho);
  if (pfxError || !pfxFile) return json({ error: "Não foi possível acessar o certificado privado." }, 403);

  const pfx = Buffer.from(await pfxFile.arrayBuffer());
  let stage: HomologationStage = "validar_dados_fiscais";
  try {
    const draft = buildRestrictedDps(payment as unknown as DpsSource, company as CompanySource);
    const unsignedXml = draft.xml;
    const unsignedPath = `dps/${payment.id}/${draft.id}.xml`;
    stage = "armazenar_dps";
    const { error: unsignedUploadError } = await supabase.storage
      .from(XML_BUCKET)
      .upload(unsignedPath, new Blob([unsignedXml], { type: "application/xml" }), { contentType: "application/xml", upsert: true });
    if (unsignedUploadError) throw new Error("Não foi possível atualizar a DPS validada no backend Node.");

    stage = "abrir_certificado";
    const keys = readCertificate(pfx, password, company.cnpj);
    stage = "assinar_dps";
    const signedXml = signDps(unsignedXml, keys.privateKeyPem, keys.certificatePem);
    const signedPath = `dps/${payment.id}/assinada/${draft.id}.xml`;
    stage = "armazenar_dps_assinada";
    const { error: signedUploadError } = await supabase.storage
      .from(XML_BUCKET)
      .upload(signedPath, new Blob([signedXml], { type: "application/xml" }), { contentType: "application/xml", upsert: true });
    if (signedUploadError) throw new Error("Não foi possível guardar a DPS assinada.");
    const { error: signedPathUpdateError } = await supabase.from("mensalidades").update({
      status_nfse: "DPS assinada em homologação",
      dps_xml_path: unsignedPath,
      dps_xml_id: draft.id,
      dps_assinada_xml_path: signedPath,
    }).eq("id", payment.id);
    if (signedPathUpdateError) throw new Error("A DPS foi assinada, mas o cadastro não pôde ser atualizado.");

    const payload = JSON.stringify({ dpsXmlGZipB64: gzipSync(Buffer.from(signedXml, "utf8")).toString("base64") });
    stage = "transmitir_sefin";
    const response = await postToRestrictedProduction(payload, pfx, password);
    password = "";
    pfx.fill(0);
    stage = "interpretar_retorno";
    let sefinPayload: unknown = {};
    try { sefinPayload = response.body ? JSON.parse(response.body) : {}; } catch { sefinPayload = response.body; }
    const sefin = sefinPayload && typeof sefinPayload === "object" && !Array.isArray(sefinPayload)
      ? sefinPayload as SefinResponse
      : {};

    if (response.status < 200 || response.status >= 300 || !sefin.nfseXmlGZipB64 || !sefin.chaveAcesso) {
      const fiscalErrors = safeFiscalErrors(sefinPayload);
      const formattedErrors = fiscalErrors.map(error => [error.codigo, error.descricao, error.complemento].filter(Boolean).join(" - "));
      await supabase.from("mensalidades").update({ status_nfse: "Rejeitada em homologação" }).eq("id", payment.id);
      await supabase.from("historico_nfse").insert({
        mensalidade_id: payment.id,
        evento: "nfse_homologacao_rejeitada",
        valor_anterior: payment.valor_nfse,
        valor_novo: payment.valor_nfse,
        detalhes: `Produção restrita respondeu HTTP ${response.status}. ${formattedErrors.join(" | ")}`.slice(0, 2000),
      });
      return json({ error: formattedErrors[0] || `A produção restrita respondeu com o código ${response.status}.`, errors: fiscalErrors }, 422);
    }

    const nfseXml = gunzipSync(Buffer.from(sefin.nfseXmlGZipB64, "base64")).toString("utf8");
    const safeKey = sefin.chaveAcesso.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
    if (!safeKey) throw new Error("A produção restrita retornou uma chave de acesso inválida.");
    const nfsePath = `dps/${payment.id}/autorizada-homologacao/${safeKey}.xml`;
    stage = "armazenar_nfse_autorizada";
    const { error: nfseUploadError } = await supabase.storage
      .from(XML_BUCKET)
      .upload(nfsePath, new Blob([nfseXml], { type: "application/xml" }), { contentType: "application/xml", upsert: true });
    if (nfseUploadError) throw new Error("A nota de teste foi gerada, mas o XML retornado não pôde ser guardado.");

    const issuedAt = sefin.dataHoraProcessamento || new Date().toISOString();
    stage = "atualizar_cadastro";
    const { error: updateError } = await supabase.from("mensalidades").update({
      status_nfse: "NFS-e emitida em homologação",
      dps_xml_path: unsignedPath,
      dps_xml_id: draft.id,
      dps_assinada_xml_path: signedPath,
      nfse_homologacao_xml_path: nfsePath,
      chave_nfse_homologacao: sefin.chaveAcesso,
      homologacao_emitida_em: issuedAt,
    }).eq("id", payment.id);
    if (updateError) throw new Error("A nota de teste foi gerada, mas o cadastro não pôde ser atualizado.");
    stage = "registrar_historico";
    await supabase.from("historico_nfse").insert({
      mensalidade_id: payment.id,
      evento: "nfse_homologacao_emitida",
      valor_anterior: payment.valor_nfse,
      valor_novo: payment.valor_nfse,
      detalhes: `NFS-e gerada exclusivamente na produção restrita. Chave ${sefin.chaveAcesso}. Aplicativo ${sefin.versaoAplicativo || "não informado"}. XMLs guardados no repositório privado.`,
    });
    return json({ ok: true, environment: "Produção restrita", key: sefin.chaveAcesso, issuedAt, alerts: sefin.alertas || [] });
  } catch (error) {
    password = "";
    pfx.fill(0);
    const stageError = STAGE_ERRORS[stage];
    const technicalError = safeTechnicalError(error);
    await supabase.from("historico_nfse").insert({
      mensalidade_id: payment.id,
      evento: "nfse_homologacao_falhou_node",
      valor_anterior: payment.valor_nfse,
      valor_novo: payment.valor_nfse,
      detalhes: `Falha técnica ${stageError.code} (${technicalError.name}: ${technicalError.message}) antes da conclusão da homologação. Nenhuma NFS-e com validade fiscal foi emitida.`.slice(0, 2000),
    });
    const validationError = stage === "validar_dados_fiscais" && error instanceof Error ? error.message : "";
    return json({ error: validationError || stageError.message, diagnosticCode: stageError.code }, validationError ? 422 : 502);
  }
}





