import assert from "node:assert/strict";
import test from "node:test";
import { buildSmtpMessage } from "../lib/smtp.ts";

test("monta uma mensagem SMTP compatível com acentos e HTML",()=>{
  const message=buildSmtpMessage({fromName:"Jardim Escola João Paulo I",fromAddress:"nfse@jejoaopaulo.com.br",replyTo:"nfse@jejoaopaulo.com.br",to:"responsavel@example.com",subject:"Teste de e-mail — JPI Fiscal",html:"<p>Olá!</p>\n.linha protegida"});
  assert.match(message,/From: =\?UTF-8\?B\?/);
  assert.match(message,/Subject: =\?UTF-8\?B\?/);
  assert.match(message,/Content-Type: text\/html; charset=UTF-8/);
  assert.match(message,/\r\n\.\.linha protegida/);
});

test("rejeita endereço inválido antes de abrir uma conexão SMTP",()=>{
  assert.throws(()=>buildSmtpMessage({fromName:"JPI",fromAddress:"nfse@jejoaopaulo.com.br",to:"destinatario-invalido",subject:"Teste",html:"<p>Teste</p>"}),/Endereço de e-mail inválido/);
});

test("anexa o XML da homologação em uma mensagem multipart",()=>{
  const message=buildSmtpMessage({fromName:"JPI Fiscal",fromAddress:"nfse@jejoaopaulo.com.br",to:"nfse@jejoaopaulo.com.br",subject:"NFS-e de teste",html:"<p>Sem validade fiscal</p>",attachments:[{filename:"nfse-homologacao-123.xml",content:Buffer.from("<NFSe>teste</NFSe>"),contentType:"application/xml"}]});
  assert.match(message,/Content-Type: multipart\/mixed/);
  assert.match(message,/Content-Disposition: attachment; filename="nfse-homologacao-123.xml"/);
  assert.ok(message.includes("PE5GU2U+dGVzdGU8L05GU2U+"));
});
