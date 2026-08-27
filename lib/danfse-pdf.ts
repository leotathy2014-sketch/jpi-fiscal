import { DOMParser } from "@xmldom/xmldom";

const PAGE_WIDTH=595.28;
const PAGE_HEIGHT=841.89;
const MARGIN=14;

type PdfTextOptions={bold?:boolean;size?:number;color?:[number,number,number]};
type DanfseData={
  key:string;
  number:string;
  competence:string;
  issuedAt:string;
  dpsNumber:string;
  dpsSeries:string;
  providerName:string;
  providerTaxId:string;
  providerAddress:string;
  takerName:string;
  takerTaxId:string;
  takerAddress:string;
  takerEmail:string;
  serviceCode:string;
  nbs:string;
  description:string;
  serviceAmount:string;
  taxBase:string;
  issRate:string;
  issAmount:string;
  pisAmount:string;
  cofinsAmount:string;
  totalRetentions:string;
  netAmount:string;
};

const clean=(value:string)=>value.replace(/\s+/g," ").trim();
const local=(node:Node)=>String((node as Element).localName||node.nodeName).replace(/^.*:/,"");
const descendants=(root:Node)=>Array.from((root as Element).getElementsByTagName?.("*")||[]);
const firstElement=(root:Node|undefined,names:string[])=>{
  if(!root)return undefined;
  const wanted=new Set(names);
  if(wanted.has(local(root)))return root as Element;
  return descendants(root).find(node=>wanted.has(local(node)));
};
const text=(root:Node|undefined,names:string[])=>clean(firstElement(root,names)?.textContent||"");
const section=(root:Node|undefined,names:string[])=>firstElement(root,names);
const present=(value:string,fallback="Não informado")=>value||fallback;

function formatTaxId(value:string){
  const digits=value.replace(/\D/g,"");
  if(digits.length===11)return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,"$1.$2.$3-$4");
  if(digits.length===14)return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,"$1.$2.$3/$4-$5");
  return value||"Não informado";
}

function formatDate(value:string){
  if(!value)return "Não informado";
  const parsed=new Date(value);
  return Number.isNaN(parsed.getTime())?value:parsed.toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"});
}

function formatDateOnly(value:string){
  const match=value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match?`${match[3]}/${match[2]}/${match[1]}`:value||"Não informado";
}

function money(value:string){
  if(!value.trim())return "Não informado";
  const amount=Number(value.replace(",","."));
  return Number.isFinite(amount)?amount.toLocaleString("pt-BR",{style:"currency",currency:"BRL"}):"Não informado";
}

function address(root:Node|undefined){
  const addressNode=section(root,["enderNac","end","endereco"]);
  if(!addressNode)return "";
  const street=text(addressNode,["xLgr"]);
  const number=text(addressNode,["nro"]);
  const complement=text(addressNode,["xCpl"]);
  const district=text(addressNode,["xBairro"]);
  const city=text(addressNode,["xMun","xLoc"]);
  const state=text(addressNode,["UF"]);
  const zip=text(addressNode,["CEP"]);
  return [street,number,complement,district,[city,state].filter(Boolean).join("/"),zip].filter(Boolean).join(", ");
}

export function parseDanfseXml(xml:string,expectedKey:string):DanfseData{
  if(!/^\d{50}$/.test(expectedKey))throw new Error("A chave de acesso da NFS-e é inválida.");
  const document=new DOMParser().parseFromString(xml,"application/xml");
  if(descendants(document).some(node=>local(node)==="parsererror"))throw new Error("O XML da NFS-e não pôde ser interpretado.");
  const info=section(document,["infNFSe"]);
  if(!info)throw new Error("O XML não contém a identificação da NFS-e.");
  const xmlKey=text(info,["chNFSe","chaveAcesso"]);
  if(xmlKey&&xmlKey!==expectedKey)throw new Error("A chave do XML não corresponde à versão selecionada.");
  const dps=section(info,["infDPS","DPS"]);
  const provider=section(info,["emit","prest"]);
  const taker=section(info,["toma"]);
  const service=section(info,["serv"]);
  const values=section(info,["valores"]);
  return {
    key:expectedKey,
    number:present(text(info,["nNFSe"])),
    competence:formatDateOnly(text(info,["dCompet"])),
    issuedAt:formatDate(text(info,["dhEmi"])),
    dpsNumber:present(text(dps,["nDPS"])),
    dpsSeries:present(text(dps,["serie"])),
    providerName:present(text(provider,["xNome"])),
    providerTaxId:formatTaxId(text(provider,["CNPJ","CPF","NIF"])),
    providerAddress:present(address(provider)),
    takerName:present(text(taker,["xNome"])),
    takerTaxId:formatTaxId(text(taker,["CNPJ","CPF","NIF"])),
    takerAddress:present(address(taker)),
    takerEmail:present(text(taker,["email"])),
    serviceCode:present(text(service,["cTribNac","cTribMun"])),
    nbs:present(text(service,["cNBS"])),
    description:present(text(service,["xDescServ"])),
    serviceAmount:money(text(values,["vServ","vServPrest"])),
    taxBase:money(text(values,["vBC","vBCISSQN"])),
    issRate:present(text(values,["pAliq","pAliqISSQN"])),
    issAmount:money(text(values,["vISSQN","vISS"])),
    pisAmount:money(text(values,["vPis"])),
    cofinsAmount:money(text(values,["vCofins"])),
    totalRetentions:money(text(values,["vTotRet","vRetencoes","vTotalRet"])),
    netAmount:money(text(values,["vLiq","vLiqNFSe","vServ"])),
  };
}

function winAnsi(value:string){
  return value
    .replace(/[–—]/g,"-")
    .replace(/[“”]/g,'"')
    .replace(/[‘’]/g,"'")
    .replace(/…/g,"...")
    .replace(/[^\x09\x0A\x0D\x20-\xFF]/g,"?");
}

function pdfString(value:string){
  return winAnsi(value).replace(/\\/g,"\\\\").replace(/\(/g,"\\(").replace(/\)/g,"\\)");
}

function wrap(value:string,max:number,maxLines=3){
  const words=clean(value).split(" ").filter(Boolean);const lines:string[]=[];let current="";
  for(const word of words){
    const candidate=current?`${current} ${word}`:word;
    if(candidate.length<=max){current=candidate;continue}
    if(current)lines.push(current);
    current=word.length>max?`${word.slice(0,max-3)}...`:word;
    if(lines.length===maxLines-1)break;
  }
  if(current&&lines.length<maxLines)lines.push(current);
  if(words.join(" ").length>lines.join(" ").length&&lines.length)lines[lines.length-1]=`${lines[lines.length-1].slice(0,Math.max(0,max-3))}...`;
  return lines.length?lines:["Não informado"];
}

function createPdf(data:DanfseData){
  const commands:string[]=[];
  const rectangle=(x:number,top:number,width:number,height:number,fill?:number)=>{
    const y=PAGE_HEIGHT-top-height;
    if(fill!==undefined)commands.push(`${fill} g ${x} ${y} ${width} ${height} re f 0 g`);
    commands.push(`0.5 w ${x} ${y} ${width} ${height} re S`);
  };
  const line=(x1:number,top1:number,x2:number,top2:number)=>commands.push(`0.5 w ${x1} ${PAGE_HEIGHT-top1} m ${x2} ${PAGE_HEIGHT-top2} l S`);
  const write=(value:string,x:number,top:number,options:PdfTextOptions={})=>{
    const {bold=false,size=7,color=[0,0,0]}=options;
    commands.push(`${color[0]} ${color[1]} ${color[2]} rg BT /${bold?"F2":"F1"} ${size} Tf 1 0 0 1 ${x} ${PAGE_HEIGHT-top-size} Tm (${pdfString(value)}) Tj ET 0 0 0 rg`);
  };
  const field=(label:string,value:string,x:number,top:number,width:number,maxLines=2)=>{
    write(label,x,top,{bold:true,size:6});
    wrap(value,Math.max(12,Math.floor(width/4.2)),maxLines).forEach((entry,index)=>write(entry,x,top+9+index*8,{size:7}));
  };
  const sectionTitle=(title:string,top:number)=>{
    rectangle(MARGIN,top,PAGE_WIDTH-MARGIN*2,16,0.95);write(title.toLocaleUpperCase("pt-BR"),MARGIN+5,top+4,{bold:true,size:7});
  };

  rectangle(MARGIN,MARGIN,PAGE_WIDTH-MARGIN*2,PAGE_HEIGHT-MARGIN*2);
  rectangle(MARGIN,MARGIN,PAGE_WIDTH-MARGIN*2,62,0.95);
  write("NFS-e",MARGIN+12,MARGIN+13,{bold:true,size:18});
  write("DANFSe v2.0",205,MARGIN+10,{bold:true,size:10});
  write("Documento Auxiliar da NFS-e",174,MARGIN+25,{bold:true,size:9});
  write("NFS-e SEM VALIDADE JURÍDICA",165,MARGIN+41,{bold:true,size:10,color:[0.85,0,0]});
  write("Município: RIO DE JANEIRO / RJ",421,MARGIN+12,{size:7});
  write("Ambiente gerador: JPI Fiscal",421,MARGIN+25,{size:6});
  write("Ambiente: Homologação",421,MARGIN+36,{size:6});

  let top=80;
  sectionTitle("Identificação da NFS-e",top);top+=18;
  field("Chave de acesso",data.key,MARGIN+5,top,320);
  field("Número da NFS-e",data.number,390,top,90);
  field("Competência",data.competence,490,top,85);
  top+=31;
  field("Data e hora da emissão",data.issuedAt,MARGIN+5,top,160);
  field("DPS / Série",`${data.dpsNumber} / ${data.dpsSeries}`,185,top,115);
  field("Situação", "ATIVA EM HOMOLOGAÇÃO",320,top,150);
  field("Finalidade","NFS-e regular",490,top,85);
  top+=32;
  line(MARGIN,top,PAGE_WIDTH-MARGIN,top);

  top+=4;sectionTitle("Prestador / Fornecedor",top);top+=18;
  field("Nome empresarial",data.providerName,MARGIN+5,top,300);
  field("CNPJ / CPF / NIF",data.providerTaxId,330,top,145);
  top+=26;field("Endereço",data.providerAddress,MARGIN+5,top,560,2);top+=30;

  sectionTitle("Tomador / Adquirente",top);top+=18;
  field("Nome / Nome empresarial",data.takerName,MARGIN+5,top,300);
  field("CNPJ / CPF / NIF",data.takerTaxId,330,top,145);
  top+=26;field("Endereço",data.takerAddress,MARGIN+5,top,360,2);
  field("E-mail",data.takerEmail,390,top,180,2);top+=34;

  sectionTitle("Serviço prestado",top);top+=18;
  field("Código de tributação",data.serviceCode,MARGIN+5,top,160);
  field("NBS",data.nbs,190,top,140);
  field("Local da prestação","RIO DE JANEIRO / RJ",350,top,220);
  top+=26;field("Descrição do serviço",data.description,MARGIN+5,top,560,4);top+=47;

  sectionTitle("Tributação municipal e federal",top);top+=18;
  field("Base de cálculo ISSQN",data.taxBase,MARGIN+5,top,125);
  field("Alíquota ISSQN",data.issRate==="Não informado"?data.issRate:`${data.issRate}%`,150,top,100);
  field("ISSQN apurado",data.issAmount,270,top,105);
  field("PIS",data.pisAmount,395,top,80);
  field("COFINS",data.cofinsAmount,490,top,80);
  top+=31;

  sectionTitle("Valor total da NFS-e",top);top+=18;
  field("Valor do serviço",data.serviceAmount,MARGIN+5,top,150);
  field("Total das retenções",data.totalRetentions,190,top,150);
  field("Valor líquido da NFS-e",data.netAmount,385,top,180);
  top+=35;

  sectionTitle("Informações complementares",top);top+=20;
  wrap("Documento gerado exclusivamente para conferência interna a partir do XML autorizado no ambiente de produção restrita. Sem validade fiscal ou jurídica.",105,3).forEach((entry,index)=>write(entry,MARGIN+5,top+index*9,{size:7}));
  top+=34;
  write("Consulta pública:",MARGIN+5,top,{bold:true,size:6});
  wrap(`https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=${data.key}`,112,2).forEach((entry,index)=>write(entry,MARGIN+5,top+9+index*8,{size:7}));
  write("A autenticidade deverá ser conferida no Portal Nacional da NFS-e.",MARGIN+5,PAGE_HEIGHT-MARGIN-16,{size:6});

  const stream=Buffer.from(commands.join("\n"),"latin1");
  const objects=[
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>","ascii"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>","ascii"),
    Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,"ascii"),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>","ascii"),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>","ascii"),
    Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`,"ascii"),stream,Buffer.from("\nendstream","ascii")]),
  ];
  const parts=[Buffer.from("%PDF-1.4\n%âãÏÓ\n","latin1")];const offsets=[0];let offset=parts[0].length;
  objects.forEach((object,index)=>{offsets.push(offset);const part=Buffer.concat([Buffer.from(`${index+1} 0 obj\n`,"ascii"),object,Buffer.from("\nendobj\n","ascii")]);parts.push(part);offset+=part.length});
  const xrefOffset=offset;
  const xref=["xref",`0 ${objects.length+1}`,"0000000000 65535 f ",...offsets.slice(1).map(value=>`${String(value).padStart(10,"0")} 00000 n `),"trailer",`<< /Size ${objects.length+1} /Root 1 0 R >>`,"startxref",String(xrefOffset),"%%EOF",""].join("\n");
  parts.push(Buffer.from(xref,"ascii"));
  return Buffer.concat(parts);
}

export function buildDanfsePdf(xml:string,key:string){
  const data=parseDanfseXml(xml,key);
  return {data,pdf:createPdf(data)};
}
