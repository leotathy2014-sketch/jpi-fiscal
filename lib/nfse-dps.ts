export type DpsDraftInput = {
  municipalityCode: string;
  series: string;
  number: string;
  competence: string;
  provider: {
    cnpj: string;
    municipalRegistration?: string | null;
    name?: string | null;
  };
  taker: {
    taxId: string;
    name: string;
    email?: string | null;
    phone?: string | null;
  };
  service: {
    nationalTaxCode: string;
    nbs?: string | null;
    description: string;
    amount: number;
    issRate?: number;
  };
};

export type DpsDraft = {
  id: string;
  xml: string;
  version: "1.01";
};

const digits = (value: string) => value.replace(/\D/g, "");
const escapeXml = (value: string) => value.replace(/[<>&"']/g, character => ({
  "<": "&lt;",
  ">": "&gt;",
  "&": "&amp;",
  '"': "&quot;",
  "'": "&apos;",
}[character] || character));

function competenceDate(value: string) {
  const normalized = value.trim();
  const monthYear = normalized.match(/^(0[1-9]|1[0-2])\/(20\d{2})$/);
  if (monthYear) return `${monthYear[2]}-${monthYear[1]}-01`;
  const yearMonth = normalized.match(/^(20\d{2})-(0[1-9]|1[0-2])$/);
  if (yearMonth) return `${yearMonth[1]}-${yearMonth[2]}-01`;
  throw new Error("A competência deve estar no formato mês/ano.");
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

function element(name: string, value?: string | null) {
  return value ? `<${name}>${escapeXml(value)}</${name}>` : "";
}

export function buildDpsDraft(input: DpsDraftInput): DpsDraft {
  const municipalityCode = digits(input.municipalityCode);
  const providerCnpj = digits(input.provider.cnpj);
  const takerTaxId = digits(input.taker.taxId);
  const series = digits(input.series);
  const number = digits(input.number).replace(/^0+(?=\d)/, "");
  const nationalTaxCode = digits(input.service.nationalTaxCode);
  const nbs = digits(input.service.nbs || "");
  const description = input.service.description.trim();
  const takerName = input.taker.name.trim();

  if (municipalityCode.length !== 7) throw new Error("Código IBGE do município emissor inválido.");
  if (providerCnpj.length !== 14) throw new Error("CNPJ do prestador inválido.");
  if (![11, 14].includes(takerTaxId.length)) throw new Error("CPF/CNPJ do tomador inválido.");
  if (!takerName) throw new Error("Nome do tomador inválido.");
  if (!/^\d{1,5}$/.test(series)) throw new Error("Série da DPS inválida.");
  if (!/^[1-9]\d{0,14}$/.test(number)) throw new Error("Número da DPS inválido.");
  if (nationalTaxCode.length !== 6) throw new Error("Código de tributação nacional inválido.");
  if (nbs && nbs.length !== 9) throw new Error("Código NBS inválido.");
  if (!description || description.length > 1000) throw new Error("A descrição do serviço deve ter entre 1 e 1000 caracteres.");
  if (!Number.isFinite(input.service.amount) || input.service.amount <= 0) throw new Error("Valor do serviço inválido.");

  const id = `DPS${municipalityCode}2${providerCnpj}${series.padStart(5, "0")}${number.padStart(15, "0")}`;
  const takerDocument = takerTaxId.length === 11 ? element("CPF", takerTaxId) : element("CNPJ", takerTaxId);
  const phone = digits(input.taker.phone || "");
  const issRate = input.service.issRate ?? 5;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01">
  <infDPS Id="${id}">
    <tpAmb>2</tpAmb>
    <dhEmi>${issueDateTime()}</dhEmi>
    <verAplic>JPI-FISCAL-1.01</verAplic>
    <serie>${series}</serie>
    <nDPS>${number}</nDPS>
    <dCompet>${competenceDate(input.competence)}</dCompet>
    <tpEmit>1</tpEmit>
    <cLocEmi>${municipalityCode}</cLocEmi>
    <prest>
      <CNPJ>${providerCnpj}</CNPJ>
      ${element("IM", digits(input.provider.municipalRegistration || ""))}
      ${element("xNome", input.provider.name?.trim())}
      <regTrib>
        <opSimpNac>1</opSimpNac>
        <regEspTrib>0</regEspTrib>
      </regTrib>
    </prest>
    <toma>
      ${takerDocument}
      <xNome>${escapeXml(takerName)}</xNome>
      ${phone.length >= 6 ? element("fone", phone) : ""}
      ${element("email", input.taker.email?.trim())}
    </toma>
    <serv>
      <locPrest>
        <cLocPrestacao>${municipalityCode}</cLocPrestacao>
      </locPrest>
      <cServ>
        <cTribNac>${nationalTaxCode}</cTribNac>
        <xDescServ>${escapeXml(description)}</xDescServ>
        ${nbs ? element("cNBS", nbs) : ""}
      </cServ>
    </serv>
    <valores>
      <vServPrest>
        <vServ>${input.service.amount.toFixed(2)}</vServ>
      </vServPrest>
      <trib>
        <tribMun>
          <tribISSQN>1</tribISSQN>
          <tpRetISSQN>1</tpRetISSQN>
          <pAliq>${issRate.toFixed(2)}</pAliq>
        </tribMun>
        <totTrib>
          <indTotTrib>0</indTotTrib>
        </totTrib>
      </trib>
    </valores>
  </infDPS>
</DPS>`;

  return { id, xml, version: "1.01" };
}
