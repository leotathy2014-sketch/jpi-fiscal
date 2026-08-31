import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.56.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const allowedRoles = new Set(["admin", "financeiro", "secretaria", "consulta"]);
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

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
    if ((action === "invite" || action === "update") && !canManageUsers) {
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
        };
      });
      return reply({ users, callerId: caller.id });
    }

    if (action === "invite") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const nome = String(body.nome ?? "").trim().toLocaleUpperCase("pt-BR");
      const role = String(body.role ?? "");
      if (!email || !nome || !allowedRoles.has(role)) {
        return reply({ error: "Informe nome, e-mail e nível de acesso válidos." }, 400);
      }
      const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { nome, needs_password: true },
        redirectTo: "https://jpi-fiscal.vercel.app",
      });
      if (inviteError) return reply({ error: inviteError.message }, 400);
      const { error: insertError } = await admin.from("app_users").upsert({
        user_id: invited.user?.id ?? null,
        nome,
        email,
        role,
        active: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "email" });
      if (insertError) throw insertError;
      return reply({ success: true });
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