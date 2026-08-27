import assert from "node:assert/strict";
import test from "node:test";
import { buildDanfsePdf, parseDanfseXml } from "../lib/danfse-pdf.ts";

const key="33045572000000000000000000000000000000000000000001";
const xml=`<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infNFSe>
    <chNFSe>${key}</chNFSe><nNFSe>123</nNFSe><dCompet>2026-08-01</dCompet><dhEmi>2026-08-27T10:30:00-03:00</dhEmi>
    <emit><CNPJ>12345678000195</CNPJ><xNome>JARDIM ESCOLA JOAO PAULO I</xNome><enderNac><xLgr>RUA TESTE</xLgr><nro>10</nro><xBairro>CENTRO</xBairro><xMun>RIO DE JANEIRO</xMun><UF>RJ</UF><CEP>20000000</CEP></enderNac></emit>
    <DPS><infDPS><tpAmb>2</tpAmb><serie>JPI01</serie><nDPS>45</nDPS><toma><CPF>12345678909</CPF><xNome>RESPONSAVEL DE TESTE</xNome><email>teste@example.com</email></toma><serv><cServ><cTribNac>080101</cTribNac><xDescServ>MENSALIDADE ESCOLAR DE HOMOLOGACAO</xDescServ><cNBS>122012000</cNBS></cServ></serv><valores><vServ>385.00</vServ><vBC>385.00</vBC><pAliq>5.00</pAliq><vISSQN>19.25</vISSQN><vPis>2.50</vPis><vCofins>11.55</vCofins><vLiq>385.00</vLiq></valores></infDPS></DPS>
  </infNFSe>
</NFSe>`;

test("extrai do XML os campos do DANFSe de homologação",()=>{
  const data=parseDanfseXml(xml,key);
  assert.equal(data.key,key);
  assert.equal(data.number,"123");
  assert.equal(data.providerName,"JARDIM ESCOLA JOAO PAULO I");
  assert.equal(data.takerName,"RESPONSAVEL DE TESTE");
  assert.equal(data.serviceAmount,"R$ 385,00");
  assert.equal(data.totalRetentions,"Não informado");
});

test("gera PDF A4 de uma página com aviso de ausência de validade jurídica",()=>{
  const {pdf}=buildDanfsePdf(xml,key);
  const source=pdf.toString("latin1");
  assert.equal(pdf.subarray(0,8).toString("ascii"),"%PDF-1.4");
  assert.match(source,/\/MediaBox \[0 0 595\.28 841\.89\]/);
  assert.match(source,/\/Count 1/);
  assert.match(source,/NFS-e SEM VALIDADE JURÍDICA/);
  assert.match(source,/33045572000000000000000000000000000000000000000001/);
  assert.match(source,/%%EOF/);
});
