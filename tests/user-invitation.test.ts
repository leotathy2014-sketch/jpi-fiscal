import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const manageUsers=readFileSync(new URL("../supabase/functions/manage-users/index.ts",import.meta.url),"utf8");
const page=readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8");
const login=readFileSync(new URL("../components/login.tsx",import.meta.url),"utf8");
const permissions=readFileSync(new URL("../components/pages.tsx",import.meta.url),"utf8");

test("envia convite personalizado sem usar o modelo padrão em inglês",()=>{
  assert.doesNotMatch(manageUsers,/inviteUserByEmail/);
  assert.match(manageUsers,/generateLink\(\{\s*type:\s*"invite"/);
  assert.match(manageUsers,/Aceitar convite e criar senha/);
  assert.match(manageUsers,/Você foi convidado para acessar o JPI Fiscal/);
  assert.match(manageUsers,/get_password_recovery_email_config/);
});

test("confirma o convite somente após ação do usuário e abre a criação de senha",()=>{
  assert.match(page,/invite_confirm/);
  assert.match(page,/verifyOtp\(\{token_hash:inviteTokenHash,type:"invite"\}/);
  assert.match(page,/setNeedsPassword\(true\)/);
  assert.match(login,/Aceite seu convite/);
  assert.match(login,/Criar minha senha/);
});

test("permite reenviar convites que continuam pendentes",()=>{
  assert.match(manageUsers,/action === "resend_invite"/);
  assert.match(manageUsers,/confirmed_at: authUser\?\.email_confirmed_at/);
  assert.match(permissions,/Reenviar convite/);
  assert.match(permissions,/user\.invited_at&&!user\.confirmed_at/);
});
