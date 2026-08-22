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
  abrir_certificado: { code: "NFSE_HML_ABRIR_A1", message: "O certificado A1 não pôde ser preparado para a assinatura. Confira a senha e tente novamente." },
  assinar_dps: { code: "NFSE_HML_ASSINAR_DPS", message: "Não foi possível concluir a assinatura local da DPS com o certificado A1." },
  armazenar_dps_assinada: { code: "NFSE_HML_ARMAZENAR_ASSINADA", message: "Não foi possível guardar a DPS assinada no ambiente seguro." },
  transmitir_sefin: { code: "NFSE_HML_TRANSMITIR", message: "Não foi possível comunicar a nota de teste à produção restrita." },
  interpretar_retorno: { code: "NFSE_HML_LER_RETORNO", message: "A produção restrita respondeu, mas o retorno não pôde ser interpretado." },
  armazenar_nfse_autorizada: { code: "NFSE_HML_ARMAZENAR_NFSE", message: "A nota de teste foi gerada, mas o XML autorizado não pôde ser guardado." },
  atualizar_cadastro: { code: "NFSE_HML_ATUALIZAR_CADASTRO", message: "A nota de teste foi gerada, mas o cadastro não pôde ser atualizado." },
  registrar_historico: { code: "NFSE_HML_REGISTRAR_HISTORICO", message: "A nota de teste foi gerada, mas o histórico não pôde ser atualizado." },
};

function safeTechnicalError(error: unknown) {
  const name = error instanceof Error ? error.name : "UnknownError";
  const rawMessage = error instanceof Error ? error.message : String(error || "Falha sem mensagem.");
  const message = rawMessage
    .replace(/((?:password|senha)\s*[:=]\s*)[^\s,;]+/gi, "$1[REMOVIDO]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 500);
  return { name: name.slice(0, 80), message };
}

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

const digits = (value: unknown) => String(value || "").replace(/\D/g, "");
const escapeXml = (value: unknown) => String(value || "").replace(/[<>&"']/g, character => ({
  "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;",
}[character] || character));

function competenceDate(value: string) {
  const match = value.trim().match(/^(0[1-9]|1[0-2])\/(20\d{2})$/);
  if (!match) throw new Error("A competência da mensalidade é inválida.");
  return `${match[2]}-${match[1]}-01`;
}

function issueDateTime() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}-03:00`;
}

type DpsSource = {
  id: number;
  competencia: string;
  valor_nfse: number;
  descricao_servico: string | null;
  alunos: { responsavel: string; cpf_cnpj: string | null; email: string | null; whatsapp: string | null; segmento: string } | null;
};
type CompanySource = { cnpj: string; inscricao_municipal: string | null; razao_social: string };

function buildRestrictedDps(payment: DpsSource, company: CompanySource) {
  const municipality = "3304557";
  const providerCnpj = digits(company.cnpj);
  const takerTaxId = digits(payment.alunos?.cpf_cnpj);
  const description = String(payment.descricao_servico || "").trim();
  const takerName = String(payment.alunos?.responsavel || "").trim();
  const series = "70000";
  const number = String(payment.id);
  const normalizedSegment = String(payment.alunos?.segmento || "").toLocaleLowerCase("pt-BR");
  const nbs = normalizedSegment.includes("médio") ? "122013000"
    : normalizedSegment.includes("1º") || normalizedSegment.includes("6º") || normalizedSegment.includes("fundamental") ? "122012000"
    : "122011200";
  if (providerCnpj.length !== 14) throw new Error("O CNPJ do prestador é inválido.");
  if (![11, 14].includes(takerTaxId.length)) throw new Error("O CPF/CNPJ do tomador é inválido.");
  if (!takerName) throw new Error("O responsável financeiro do tomador não foi informado.");
  if (!description || description.length > 2000) throw new Error("A descrição fiscal deve ter entre 1 e 2000 caracteres.");
  if (!Number.isFinite(Number(payment.valor_nfse)) || Number(payment.valor_nfse) <= 0) throw new Error("O valor da NFS-e é inválido.");
  const id = `DPS${municipality}2${providerCnpj}${series}${number.padStart(15, "0")}`;
  const document = takerTaxId.length === 11 ? `<CPF>${takerTaxId}</CPF>` : `<CNPJ>${takerTaxId}</CNPJ>`;
  const phone = digits(payment.alunos?.whatsapp);
  return { id, xml: `<?xml version="1.0" encoding="UTF-8"?>
<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01">
  <infDPS Id="${id}">
    <tpAmb>2</tpAmb><dhEmi>${issueDateTime()}</dhEmi><verAplic>JPI-FISCAL-1.01</verAplic>
    <serie>${series}</serie><nDPS>${number}</nDPS><dCompet>${competenceDate(payment.competencia)}</dCompet><tpEmit>1</tpEmit><cLocEmi>${municipality}</cLocEmi>
    <prest><CNPJ>${providerCnpj}</CNPJ>${company.inscricao_municipal ? `<IM>${digits(company.inscricao_municipal)}</IM>` : ""}<xNome>${escapeXml(company.razao_social)}</xNome><regTrib><opSimpNac>1</opSimpNac><regEspTrib>0</regEspTrib></regTrib></prest>
    <toma>${document}<xNome>${escapeXml(takerName)}</xNome>${phone.length >= 6 ? `<fone>${phone}</fone>` : ""}${payment.alunos?.email ? `<email>${escapeXml(payment.alunos.email.trim())}</email>` : ""}</toma>
    <serv><locPrest><cLocPrestacao>${municipality}</cLocPrestacao></locPrest><cServ><cTribNac>080101</cTribNac><xDescServ>${escapeXml(description)}</xDescServ><cNBS>${nbs}</cNBS></cServ></serv>
    <valores><vServPrest><vServ>${Number(payment.valor_nfse).toFixed(2)}</vServ></vServPrest><trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN><pAliq>5.00</pAliq></tribMun><totTrib><indTotTrib>0</indTotTrib></totTrib></trib></valores>
    <IBSCBS><finNFSe>0</finNFSe><cIndOp>030101</cIndOp><indDest>0</indDest><valores><trib><gIBSCBS><CST>200</CST><cClassTrib>200028</cClassTrib></gIBSCBS></trib></valores></IBSCBS>
  </infDPS>
</DPS>` };
}

function sameRsaKey(certificate: ForgeCertificate, key: ForgePrivateKey) {
  const publicKey = certificate.publicKey as forge.pki.rsa.PublicKey;
  return Boolean(publicKey?.n && key?.n && publicKey.n.compareTo(key.n) === 0);
}

function verifiesCertificate(issuer: ForgeCertificate, certificate: ForgeCertificate) {
  try {
    return issuer.verify(certificate);
  } catch {
    return false;
  }
}

function isSelfSigned(certificate: ForgeCertificate) {
  return verifiesCertificate(certificate, certificate);
}

function orderedCertificateChainPem(leaf: ForgeCertificate, certificates: ForgeCertificate[]) {
  const chain = [leaf];
  const remaining = certificates.filter(certificate => certificate !== leaf);
  let current = leaf;

  while (remaining.length) {
    const issuerIndex = remaining.findIndex(candidate => verifiesCertificate(candidate, current));
    if (issuerIndex < 0) break;
    const issuer = remaining.splice(issuerIndex, 1)[0];
    if (isSelfSigned(issuer)) break;
    chain.push(issuer);
    current = issuer;
  }

  return chain.map(certificate => forge.pki.certificateToPem(certificate)).join("\n");
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
  const certificateChainPem = orderedCertificateChainPem(leaf, certificates);
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
    .select("id,competencia,valor_nfse,descricao_servico,dps_xml_path,dps_xml_id,chave_nfse_homologacao,nfse_homologacao_xml_path,homologacao_emitida_em,alunos(responsavel,cpf_cnpj,email,whatsapp,segmento)")
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
  if (!payment.dps_xml_path || !payment.dps_xml_id) return json({ error: "Gere e guarde primeiro a prévia XML da DPS." }, 400);

  const { data: company } = await admin
    .from("configuracoes_empresa")
    .select("cnpj,inscricao_municipal,razao_social")
    .eq("id", true)
    .maybeSingle();
  if (!company) return json({ error: "Os dados fiscais da empresa não foram encontrados." }, 400);

  const { data: certificate } = await admin
    .from("certificados_a1")
    .select("arquivo_caminho,validade")
    .eq("status", "ATIVO")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!certificate) return json({ error: "Certificado A1 ativo não encontrado." }, 400);
  if (new Date(`${certificate.validade}T23:59:59-03:00`).getTime() < Date.now()) return json({ error: "O certificado A1 está vencido." }, 400);

  const { data: pfxFile, error: pfxError } = await admin.storage.from(CERTIFICATE_BUCKET).download(certificate.arquivo_caminho);
  if (pfxError || !pfxFile) return json({ error: "Não foi possível acessar o certificado privado." }, 500);

  let stage: HomologationStage = "validar_dados_fiscais";
  try {
    const draft = buildRestrictedDps(payment as unknown as DpsSource, company as CompanySource);
    const unsignedXml = draft.xml;
    const unsignedPath = `dps/${payment.id}/${draft.id}.xml`;
    stage = "armazenar_dps";
    const { error: unsignedUploadError } = await admin.storage
      .from(XML_BUCKET)
      .upload(unsignedPath, new Blob([unsignedXml], { type: "application/xml" }), { contentType: "application/xml", upsert: true });
    if (unsignedUploadError) throw new Error("Não foi possível atualizar a DPS validada no backend.");
    stage = "abrir_certificado";
    const keys = readCertificate(new Uint8Array(await pfxFile.arrayBuffer()), password);
    password = "";
    stage = "assinar_dps";
    const signedXml = signDps(unsignedXml, keys.privateKeyPem, keys.certificatePem);
    const signedPath = `dps-assinada/${payment.id}/${draft.id}.xml`;
    stage = "armazenar_dps_assinada";
    const { error: signedUploadError } = await admin.storage
      .from(XML_BUCKET)
      .upload(signedPath, new Blob([signedXml], { type: "application/xml" }), { contentType: "application/xml", upsert: true });
    if (signedUploadError) throw new Error("Não foi possível guardar a DPS assinada.");
    const { error: signedPathUpdateError } = await admin.from("mensalidades").update({
      status_nfse: "DPS assinada em homologação",
      dps_xml_path: unsignedPath,
      dps_xml_id: draft.id,
      dps_assinada_xml_path: signedPath,
    }).eq("id", payment.id);
    if (signedPathUpdateError) throw new Error("A DPS foi assinada, mas o cadastro não pôde ser atualizado.");

    const payload = JSON.stringify({ dpsXmlGZipB64: bytesToBase64(gzip(new TextEncoder().encode(signedXml))) });
    stage = "transmitir_sefin";
    const response = await postToRestrictedProduction(payload, keys.certificateChainPem, keys.privateKeyPem);
    stage = "interpretar_retorno";
    let sefin: SefinResponse = {};
    try { sefin = await response.json(); } catch { sefin = {}; }

    if (!response.ok || !sefin.nfseXmlGZipB64 || !sefin.chaveAcesso) {
      const fiscalErrors = safeFiscalErrors(sefin);
      await admin.from("mensalidades").update({ status_nfse: "Rejeitada em homologação", dps_xml_path: unsignedPath, dps_xml_id: draft.id, dps_assinada_xml_path: signedPath }).eq("id", payment.id);
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
    stage = "armazenar_nfse_autorizada";
    const { error: nfseUploadError } = await admin.storage
      .from(XML_BUCKET)
      .upload(nfsePath, new Blob([nfseXml], { type: "application/xml" }), { contentType: "application/xml", upsert: true });
    if (nfseUploadError) throw new Error("A nota de teste foi gerada, mas o XML retornado não pôde ser guardado.");

    const issuedAt = sefin.dataHoraProcessamento || new Date().toISOString();
    stage = "atualizar_cadastro";
    const { error: updateError } = await admin.from("mensalidades").update({
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
    const stageError = STAGE_ERRORS[stage];
    console.error(JSON.stringify({
      event: "nfse_homologacao_falhou",
      monthlyId: payment.id,
      stage,
      diagnosticCode: stageError.code,
      technicalError: safeTechnicalError(error),
    }));
    await admin.from("historico_nfse").insert({
      mensalidade_id: payment.id,
      evento: "nfse_homologacao_falhou",
      valor_anterior: payment.valor_nfse,
      valor_novo: payment.valor_nfse,
      detalhes: `Falha técnica ${stageError.code} antes da conclusão da homologação. Nenhuma NFS-e com validade fiscal foi emitida.`,
    });
    return json({ error: stageError.message, diagnosticCode: stageError.code }, 502);
  }
});

