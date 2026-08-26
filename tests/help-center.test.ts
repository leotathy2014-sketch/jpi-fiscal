import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shellSource=readFileSync(new URL("../components/app-shell.tsx",import.meta.url),"utf8");
const helpSource=readFileSync(new URL("../components/help-page.tsx",import.meta.url),"utf8");

test("abre a Central de ajuda pelo menu lateral para todos os usuários",()=>{
  assert.match(shellSource,/\|"Ajuda"/);
  assert.match(shellSource,/onPageChange\("Ajuda"\)/);
  assert.match(shellSource,/<HelpPage onNavigate=\{onPageChange\}/);
});

test("oferece busca e filtros para localizar orientações",()=>{
  assert.match(helpSource,/Buscar na Central de ajuda/);
  assert.match(helpSource,/normalize\(query\.trim\(\)\)/);
  assert.match(helpSource,/help-categories/);
  assert.match(helpSource,/Nenhuma orientação encontrada/);
});

test("documenta os principais módulos e operações do JPI Fiscal",()=>{
  for(const content of ["Dados da empresa","Certificado digital A1","Integração de e-mail","Integração com WhatsApp","Alunos e responsáveis","Mensalidades","Emitir NFS-e em homologação","Enviar várias homologações","Cancelar, corrigir ou substituir","Usuários e permissões","Segurança e solução de problemas"]){
    assert.ok(helpSource.includes(content),`orientação ausente: ${content}`);
  }
});

test("orienta sem solicitar compartilhamento de credenciais",()=>{
  assert.match(helpSource,/Nunca compartilhe senha do A1, chave do Resend ou token da Meta/);
  assert.match(helpSource,/Não envie senhas ou tokens/);
  assert.match(helpSource,/O teste não envia mensagem/);
});
