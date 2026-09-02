import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.56.0";
import { type EmailDeliveryConfig, escapeHtml, safeColor, sendEmail } from "./email.ts";

const APP_URL = "https://jpi-fiscal.vercel.app";
const roleLabels: Record<string, string> = {
  admin: "Administrador",
  financeiro: "Financeiro",
  secretaria: "Secretaria",
  consulta: "Consulta",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const allowedRoles = new Set(["admin", "financeiro", "secretaria", "consulta"]);
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

function invitationEmail(config: EmailDeliveryConfig, input: { nome: string; role: string; inviteUrl: string; logoUrl: string }) {
  const primary = safeColor(config.primary_color, "#1466DF");
  const sidebar = safeColor(config.sidebar_color, "#14263D");
  const success = safeColor(config.success_color, "#16875F");
  const name = escapeHtml(input.nome || "Usuário");
  const profile = escapeHtml(roleLabels[input.role] || "Usuário");
  return `<!doctype html><html><body style="margin:0;background:#f3f6fa;font-family:Arial,Helvetica,sans-serif;color:#243247">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6fa;padding:32px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #dfe6ee;border-radius:16px;overflow:hidden">
    <tr><td style="background:${sidebar};padding:22px 28px">
      <table role="presentation" cellspacing="0" cellpadding="0"><tr>
        <td style="width:58px;height:58px;background:#ffffff;border-radius:12px;text-align:center;vertical-align:middle"><img src="${input.logoUrl}" width="48" height="48" alt="JPI" style="display:block;margin:auto;max-width:48px;max-height:48px;object-fit:contain"></td>
        <td style="padding-left:14px"><div style="color:#ffffff;font-size:20px;font-weight:700">JPI Fiscal</div><div style="color:#dbe5f1;font-size:12px;margin-top:3px">Jardim Escola João Paulo I</div></td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:30px 30px 10px">
      <div style="font-size:12px;font-weight:700;color:${primary};letter-spacing:.5px">CONVITE DE ACESSO</div>
      <h1 style="font-size:24px;line-height:1.25;margin:8px 0 18px;color:${sidebar}">Você foi convidado para o JPI Fiscal</h1>
      <p style="font-size:14px;line-height:1.7;margin:0 0 14px">Olá, <strong>${name}</strong>.</p>
      <p style="font-size:14px;line-height:1.7;margin:0 0 12px">Seu acesso ao <strong>JPI Fiscal</strong> foi criado com o perfil <strong>${profile}</strong>.</p>
      <p style="font-size:14px;line-height:1.7;margin:0 0 20px">Clique no botão abaixo para aceitar o convite e criar sua senha pessoal.</p>
      <table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0"><tr><td style="background:${primary};border-radius:9px"><a href="${input.inviteUrl}" style="display:inline-block;padding:14px 24px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700">Aceitar convite e criar senha</a></td></tr></table>
      <div style="border-left:4px solid ${success};background:#eff9f5;padding:12px 14px;border-radius:7px;margin:18px 0"><div style="font-size:12px;line-height:1.55;color:#375849">Por segurança, confirme o convite somente pelo botão acima. O link é pessoal, de uso único e pode expirar.</div></div>
      <p style="font-size:12px;line-height:1.65;color:#66778a;margin:20px 0 6px">Se você não reconhece este convite, ignore esta mensagem e avise a administração da escola.</p>
    </td></tr>
    <tr><td style="padding:18px 30px 26px;border-top:1px solid #edf1f5"><div style="font-size:11px;color:#8390a0">Mensagem automática de segurança · JPI Fiscal</div></td></tr>
  </table>
  </td></tr></table></body></html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "Método não permitido." }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return reply({ error: "Sessão inválida." }, 401);

    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userData, error: userError } = await admin.auth.getUser(token);
    const caller = userData.user;
    if (userError || !caller?.email) return reply({ error: "Sessão inválida." }, 401);

    const { data: permission } = await admin
      .from("app_users")
      .select("id,email,role,active")
      .eq("email", caller.email.toLowerCase())
      .maybeSingle();

    if (!permission?.active) {
      return reply({ error: "Seu usuário não possui acesso ao sistema." }, 403);
    }
    let canManageUsers = permission.role === "master";
    let canViewUsers = permission.role === "master";
    if (permission.role !== "master") {
      const { data: rolePermissions } = await admin
        .from("jpi_role_permissions")
        .select("permission_key,allowed")
        .eq("role", permission.role)
        .in("permission_key", ["settings.users.view", "settings.users.manage"]);
      canManageUsers = (rolePermissions ?? []).some((item) => item.permission_key === "settings.users.manage" && item.allowed === true);
      canViewUsers = canManageUsers || (rolePermissions ?? []).some((item) => item.permission_key === "settings.users.view" && item.allowed === true);
    }

    const body = await req.json();
    const action = String(body.action ?? "");
    if (action === "list" && !canViewUsers) {
      return reply({ error: "Seu perfil não possui permissão para visualizar usuários." }, 403);
    }
    if ((action === "invite" || action === "resend_invite" || action === "update") && !canManageUsers) {
      return reply({ error: "Seu perfil não possui permissão para gerenciar usuários." }, 403);
    }

    if (action === "list") {
      const [{ data: authData, error: authError }, { data: appUsers, error: appError }] =
        await Promise.all([
          admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
          admin.from("app_users").select("id,user_id,nome,email,role,active,created_at").order("created_at"),
        ]);
      if (authError || appError) throw authError ?? appError;
      const users = (appUsers ?? []).map((item) => {
        const authUser = authData.users.find((u) => u.id === item.user_id || u.email?.toLowerCase() === item.email.toLowerCase());
        return {
          ...item,
          user_id: authUser?.id ?? item.user_id,
          last_sign_in_at: authUser?.last_sign_in_at ?? null,
          invited_at: authUser?.invited_at ?? null,
          confirmed_at: authUser?.email_confirmed_at ?? null,
        };
      });
      return reply({ users, callerId: caller.id });
    }

    if (action === "invite" || action === "resend_invite") {
      let email = String(body.email ?? "").trim().toLowerCase();
      let nome = String(body.nome ?? "").trim().toLocaleUpperCase("pt-BR");
      let role = String(body.role ?? "");
      if (action === "resend_invite") {
        const id = Number(body.id);
        if (!Number.isInteger(id)) return reply({ error: "Usuário inválido." }, 400);
        const { data: target, error: targetError } = await admin
          .from("app_users")
          .select("id,user_id,nome,email,role,active")
          .eq("id", id)
          .single();
        if (targetError) throw targetError;
        if (!target.active || target.role === "master") {
          return reply({ error: "Este usuário não pode receber um novo convite." }, 400);
        }
        email = String(target.email ?? "").trim().toLowerCase();
        nome = String(target.nome ?? "").trim().toLocaleUpperCase("pt-BR");
        role = String(target.role ?? "");
      }
      if (!email || !nome || !allowedRoles.has(role)) {
        return reply({ error: "Informe nome, e-mail e nível de acesso válidos." }, 400);
      }

      const { data: configRows, error: configError } = await admin.rpc("get_password_recovery_email_config");
      const config = (Array.isArray(configRows) ? configRows[0] : configRows) as EmailDeliveryConfig | undefined;
      if (configError || !config?.email_credencial_configurada || config.email_ultimo_status !== "conectado" || !config.email_secret) {
        console.error("invite-email-config", configError?.message || "configuração indisponível");
        return reply({ error: "O serviço de e-mail está temporariamente indisponível. Verifique a integração de e-mail e tente novamente." }, 503);
      }

      const { data: invited, error: inviteError } = await admin.auth.admin.generateLink({
        type: "invite",
        email,
        options: { data: { nome, needs_password: true }, redirectTo: APP_URL },
      });
      const tokenHash = invited?.properties?.hashed_token;
      if (inviteError || !tokenHash || !invited.user?.id) {
        const duplicate = String(inviteError?.message || "").toLowerCase().includes("already") || String(inviteError?.message || "").toLowerCase().includes("registered");
        return reply({ error: duplicate ? "Este e-mail já possui um cadastro confirmado no JPI Fiscal." : "Não foi possível gerar o convite. Tente novamente." }, 400);
      }
      const { error: insertError } = await admin.from("app_users").upsert({
        user_id: invited.user.id,
        nome,
        email,
        role,
        active: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "email" });
      if (insertError) throw insertError;

      const inviteUrl = `${APP_URL}/?invite_confirm=1&token_hash=${encodeURIComponent(tokenHash)}`;
      const logoUrl = `${url}/storage/v1/object/public/logos-empresa/empresa/logo`;
      try {
        await sendEmail(config, email, "Você foi convidado para acessar o JPI Fiscal", invitationEmail(config, { nome, role, inviteUrl, logoUrl }));
      } catch (sendError) {
        console.error("invite-send", sendError instanceof Error ? sendError.message : "falha no envio");
        return reply({ error: "O convite foi preparado, mas o e-mail não pôde ser enviado agora. Use “Reenviar convite” em alguns minutos." }, 503);
      }
      return reply({ success: true, resent: action === "resend_invite" });
    }

    if (action === "update") {
      const id = Number(body.id);
      const role = String(body.role ?? "");
      const active = Boolean(body.active);
      if (!Number.isInteger(id) || !allowedRoles.has(role)) {
        return reply({ error: "Dados do usuário inválidos." }, 400);
      }
      const { data: target, error: targetError } = await admin
        .from("app_users")
        .select("id,user_id,email,role,active")
        .eq("id", id)
        .single();
      if (targetError) throw targetError;
      if (target.role === "master") {
        return reply({ error: "O perfil Master é protegido e não pode ser bloqueado ou rebaixado por esta tela." }, 400);
      }
      if (target.email.toLowerCase() === caller.email.toLowerCase() && !active) {
        return reply({ error: "Você não pode bloquear seu próprio acesso." }, 400);
      }
      const { error: updateError } = await admin.from("app_users").update({
        role,
        active,
        updated_at: new Date().toISOString(),
      }).eq("id", id);
      if (updateError) throw updateError;
      if (target.user_id) {
        const { error: authUpdateError } = await admin.auth.admin.updateUserById(target.user_id, {
          ban_duration: active ? "none" : "876000h",
        });
        if (authUpdateError) throw authUpdateError;
      }
      return reply({ success: true });
    }

    return reply({ error: "Ação inválida." }, 400);
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : "Erro interno." }, 500);
  }
});
