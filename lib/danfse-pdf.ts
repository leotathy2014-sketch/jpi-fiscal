import { DOMParser } from "@xmldom/xmldom";
import QRCode from "qrcode";

const PAGE_WIDTH=595.28;
const PAGE_HEIGHT=841.89;
const MARGIN=14;

type PdfTextOptions={bold?:boolean;size?:number;color?:[number,number,number]};
type DanfseData={
  key:string;
  number:string;
  competence:string;
  issuedAt:string;
  environment:string;
  dpsNumber:string;
  dpsSeries:string;
  providerName:string;
  providerTaxId:string;
  providerAddress:string;
  providerPhone:string;
  providerEmail:string;
  providerCity:string;
  providerCep:string;
  takerName:string;
  takerTaxId:string;
  takerAddress:string;
  takerPhone:string;
  takerEmail:string;
  takerCity:string;
  takerCep:string;
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
    environment:text(info,["tpAmb"])==="1"?"1":"2",
    dpsNumber:present(text(dps,["nDPS"])),
    dpsSeries:present(text(dps,["serie"])),
    providerName:present(text(provider,["xNome"])),
    providerTaxId:formatTaxId(text(provider,["CNPJ","CPF","NIF"])),
    providerAddress:present(address(provider)),
    providerPhone:present(text(provider,["fone","telefone"]),"-"),
    providerEmail:present(text(provider,["email"]),"-"),
    providerCity:present(text(provider,["xMun","xLoc","cLocEmi"]),"Rio de Janeiro / RJ"),
    providerCep:present(text(provider,["CEP"]),"-"),
    takerName:present(text(taker,["xNome"])),
    takerTaxId:formatTaxId(text(taker,["CNPJ","CPF","NIF"])),
    takerAddress:present(address(taker)),
    takerPhone:present(text(taker,["fone","telefone"]),"-"),
    takerEmail:present(text(taker,["email"])),
    takerCity:present(text(taker,["xMun","xLoc"]),"-"),
    takerCep:present(text(taker,["CEP"]),"-"),
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
  const consultationUrl=`https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=${data.key}`;
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
  const fillRect=(x:number,top:number,width:number,height:number,color:[number,number,number])=>{
    const y=PAGE_HEIGHT-top-height;
    commands.push(`${color[0]} ${color[1]} ${color[2]} rg ${x} ${y} ${width} ${height} re f 0 0 0 rg`);
  };
  const drawNfseLogo=(x:number,top:number)=>{
    fillRect(x,top+2,13,34,[0.08,0.56,0.33]);
    fillRect(x+36,top+2,13,34,[0.08,0.56,0.33]);
    commands.push(`0.08 0.56 0.33 rg ${x+11} ${PAGE_HEIGHT-top-36} m ${x+23} ${PAGE_HEIGHT-top-36} l ${x+49} ${PAGE_HEIGHT-top-2} l ${x+37} ${PAGE_HEIGHT-top-2} l h f 0 0 0 rg`);
    commands.push(`0.98 0.75 0.18 rg ${x+11} ${PAGE_HEIGHT-top-3} m ${x+23} ${PAGE_HEIGHT-top-3} l ${x+38} ${PAGE_HEIGHT-top-22} l ${x+26} ${PAGE_HEIGHT-top-22} l h f 0 0 0 rg`);
    fillRect(x+55,top+2,32,8,[0.08,0.56,0.33]);
    fillRect(x+55,top+2,8,34,[0.08,0.56,0.33]);
    fillRect(x+55,top+16,28,7,[0.08,0.56,0.33]);
    write("S",x+91,top+1,{bold:true,size:34,color:[0.08,0.56,0.33]});
    write("e",x+116,top+12,{bold:true,size:20,color:[0.08,0.28,0.72]});
    write("Nota Fiscal de",x+142,top+11,{size:7,color:[0.42,0.46,0.55]});
    write("Servico eletronica",x+142,top+21,{size:7,color:[0.42,0.46,0.55]});
  };
  const drawQr=(value:string,x:number,top:number,size:number)=>{
    const qr=QRCode.create(value,{errorCorrectionLevel:"M"});
    const count=qr.modules.size;
    const moduleSize=size/count;
    const y0=PAGE_HEIGHT-top-size;
    commands.push(`1 g ${x} ${y0} ${size} ${size} re f 0 g`);
    for(let row=0;row<count;row+=1){
      for(let col=0;col<count;col+=1){
        if(qr.modules.data[row*count+col]){
          const px=x+col*moduleSize;
          const py=y0+size-(row+1)*moduleSize;
          commands.push(`${px.toFixed(2)} ${py.toFixed(2)} ${moduleSize.toFixed(2)} ${moduleSize.toFixed(2)} re f`);
        }
      }
    }
  };

  rectangle(MARGIN,MARGIN,PAGE_WIDTH-MARGIN*2,PAGE_HEIGHT-MARGIN*2);
  rectangle(MARGIN,MARGIN,PAGE_WIDTH-MARGIN*2,62,0.94);
  drawNfseLogo(MARGIN+7,MARGIN+8);
  write("DANFSe v2.0",245,MARGIN+10,{bold:true,size:10});
  write("Documento Auxiliar da NFS-e",210,MARGIN+25,{bold:true,size:9});
  write("Municipio: Rio de Janeiro - RJ",430,MARGIN+9,{size:7});
  write(`Ambiente Gerador: ${data.environment}`,430,MARGIN+20,{size:6});
  write(`Tipo de Ambiente: ${data.environment}`,430,MARGIN+30,{size:6});

  let top=80;
  field("CHAVE DE ACESSO DA NFS-e",data.key,MARGIN+5,top,295,2);
  field("NUMERO DA NFS-e",data.number,MARGIN+5,top+28,90);
  field("COMPETENCIA DA NFS-e",data.competence,155,top+28,130);
  field("DATA E HORA DA EMISSAO DA NFS-e",data.issuedAt,300,top+28,155);
  field("NUMERO DA DPS",data.dpsNumber,MARGIN+5,top+58,90);
  field("SERIE DA DPS",data.dpsSeries,155,top+58,130);
  field("DATA E HORA DA EMISSAO DA DPS",data.issuedAt,300,top+58,155);
  drawQr(consultationUrl,493,top,58);
  wrap("A autenticidade desta NFS-e pode ser verificada pela leitura deste codigo QR ou pela consulta da chave de acesso no portal nacional da NFS-e",35,4).forEach((entry,index)=>write(entry,430,top+63+index*8,{size:5}));
  top+=105;
  line(MARGIN,top,PAGE_WIDTH-MARGIN,top);

  top+=2;sectionTitle("Emitente da NFS-e",top);top+=18;
  field("Emitente","Prestador",MARGIN+5,top,130);
  field("SITUACAO DA NFS-e","NFS-e Gerada",155,top,130);
  field("FINALIDADE","-",300,top,130);
  top+=28;

  sectionTitle("Prestador / Fornecedor",top);top+=18;
  field("Nome / Nome Empresarial",data.providerName,MARGIN+5,top,285);
  field("CNPJ / CPF / NIF",data.providerTaxId,310,top,130);
  field("Telefone",data.providerPhone,455,top,105);
  top+=27;
  field("Endereco",data.providerAddress,MARGIN+5,top,285,2);
  field("Municipio / Sigla UF",data.providerCity,310,top,130);
  field("Codigo IBGE / CEP",`33.04557 / ${data.providerCep}`,455,top,105);
  top+=35;
  field("E-mail",data.providerEmail,MARGIN+5,top,285);
  field("Simples Nacional na Data de Competencia","Nao optante",310,top,130);
  top+=30;

  sectionTitle("Tomador / Adquirente",top);top+=18;
  field("Nome / Nome Empresarial",data.takerName,MARGIN+5,top,285);
  field("CNPJ / CPF / NIF",data.takerTaxId,310,top,130);
  field("Telefone",data.takerPhone,455,top,105);
  top+=27;
  field("Endereco",data.takerAddress,MARGIN+5,top,285,2);
  field("Municipio / Sigla UF",data.takerCity,310,top,130);
  field("Codigo IBGE / CEP",data.takerCep,455,top,105);
  top+=35;
  field("E-mail",data.takerEmail,MARGIN+5,top,285);
  top+=30;
  line(MARGIN,top,PAGE_WIDTH-MARGIN,top);
  write("DESTINATARIO DA OPERACAO NAO IDENTIFICADO NA NFS-e",190,top+5,{size:7});
  line(MARGIN,top+14,PAGE_WIDTH-MARGIN,top+14);
  write("INTERMEDIARIO DA OPERACAO NAO IDENTIFICADO NA NFS-e",184,top+18,{size:7});
  line(MARGIN,top+27,PAGE_WIDTH-MARGIN,top+27);
  top+=31;

  sectionTitle("Serviço prestado",top);top+=18;
  field("Codigo de Tributacao Nacional/Municipal",data.serviceCode,MARGIN+5,top,190);
  field("Codigo da NBS",data.nbs,250,top,140);
  field("Local da Prestacao / Sigla UF / Pais","Rio de Janeiro / RJ / -",455,top,120);
  top+=28;
  field("Descricao do Servico",data.description,MARGIN+5,top,560,4);top+=46;

  sectionTitle("Tributação municipal e federal",top);top+=18;
  field("Base de cálculo ISSQN",data.taxBase,MARGIN+5,top,125);
  field("Alíquota ISSQN",data.issRate==="Não informado"?data.issRate:`${data.issRate}%`,150,top,100);
  field("ISSQN apurado",data.issAmount,270,top,105);
  field("PIS",data.pisAmount,395,top,80);
  field("COFINS",data.cofinsAmount,490,top,80);
  top+=31;

  sectionTitle("Tributacao IBS/CBS",top);top+=18;
  field("CST / cClassTrib","- / -",MARGIN+5,top,120);
  field("Base de Calculo Apos Exclusoes e Reducoes","-",155,top,160);
  field("Aliquota IBS UF / IBS Mun","- / -",350,top,160);
  field("Valor Total IBS/CBS","R$ 0,00",485,top,80);
  top+=31;

  sectionTitle("Valor total da NFS-e",top);top+=18;
  field("Valor do serviço",data.serviceAmount,MARGIN+5,top,150);
  field("Total das retenções",data.totalRetentions,190,top,150);
  field("Valor líquido da NFS-e",data.netAmount,385,top,180);
  top+=35;

  sectionTitle("Informações complementares",top);top+=20;
  wrap("Documento auxiliar gerado pelo JPI Fiscal a partir do XML autorizado pela SEFIN Nacional. Confira a autenticidade no Portal Nacional da NFS-e.",105,3).forEach((entry,index)=>write(entry,MARGIN+5,top+index*9,{size:7}));
  top+=34;
  write("Consulta pública:",MARGIN+5,top,{bold:true,size:6});
  wrap(consultationUrl,112,2).forEach((entry,index)=>write(entry,MARGIN+5,top+9+index*8,{size:7}));
  write("A autenticidade deverá ser conferida no Portal Nacional da NFS-e.",MARGIN+5,PAGE_HEIGHT-MARGIN-16,{size:6});
  rectangle(MARGIN,PAGE_HEIGHT-56,PAGE_WIDTH-MARGIN*2,26);
  field("DATA CIENTIFICACAO:","",MARGIN+5,PAGE_HEIGHT-51,145);
  field("IDENTIFICACAO E ASSINATURA","",175,PAGE_HEIGHT-51,145);
  field("N NFS-e / CHAVE NFS-e",`${data.number} / ${data.key}`,335,PAGE_HEIGHT-51,240,1);

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
