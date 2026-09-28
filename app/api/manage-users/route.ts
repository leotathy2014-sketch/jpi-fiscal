import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const allowedRoles = new Set(["admin", "financeiro", "secretaria", "consulta"]);

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

function cpfValue(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits ? digits.slice(0, 11) : null;
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Supabase do servidor não configurado.");
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function getCaller(req: NextRequest) {
  const admin = adminClient();
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return { error: json({ error: "Sessão inválida." }, 401) };

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const caller = userData.user;
  if (userError || !caller?.email) return { error: json({ error: "Sessão inválida." }, 401) };

  const { data: permission } = await admin
    .from("app_users")
    .select("id,email,role,active")
    .eq("email", caller.email.toLowerCase())
    .maybeSingle();

  if (!permission?.active) return { error: json({ error: "Seu usuário não possui acesso ao sistema." }, 403) };

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

  return { admin, caller, canManageUsers, canViewUsers };
}

export async function POST(req: NextRequest) {
  try {
    const context = await getCaller(req);
    if ("error" in context) return context.error;
    const { admin, caller, canManageUsers, canViewUsers } = context;
    const body = await req.json();
    const action = String(body.action ?? "");

    if (action === "list") {
      if (!canViewUsers) return json({ error: "Seu perfil não possui permissão para visualizar usuários." }, 403);
      const [{ data: authData, error: authError }, { data: appUsers, error: appError }] = await Promise.all([
        admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
        admin.from("app_users").select("id,user_id,nome,email,cpf,role,active,created_at,invite_resent_at").order("created_at"),
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
      return json({ users, callerId: caller.id });
    }

    if (action === "update") {
      if (!canManageUsers) return json({ error: "Seu perfil não possui permissão para gerenciar usuários." }, 403);
      const id = Number(body.id);
      const role = String(body.role ?? "");
      const active = Boolean(body.active);
      if (!Number.isInteger(id) || !allowedRoles.has(role)) return json({ error: "Dados do usuário inválidos." }, 400);
      const { data: target, error: targetError } = await admin.from("app_users").select("id,user_id,email,role,active").eq("id", id).single();
      if (targetError) throw targetError;
      if (target.role === "master") return json({ error: "O perfil Master é protegido e não pode ser bloqueado ou rebaixado por esta tela." }, 400);
      if (target.email.toLowerCase() === caller.email?.toLowerCase() && !active) return json({ error: "Você não pode bloquear seu próprio acesso." }, 400);
      const { error: updateError } = await admin.from("app_users").update({ role, active, updated_at: new Date().toISOString() }).eq("id", id);
      if (updateError) throw updateError;
      if (target.user_id) {
        const { error: authUpdateError } = await admin.auth.admin.updateUserById(target.user_id, { ban_duration: active ? "none" : "876000h" });
        if (authUpdateError) throw authUpdateError;
      }
      return json({ success: true });
    }

    if (action === "update_identity") {
      if (!canManageUsers) return json({ error: "Seu perfil não possui permissão para gerenciar usuários." }, 403);
      const id = Number(body.id);
      const nome = String(body.nome ?? "").trim().toLocaleUpperCase("pt-BR");
      const email = String(body.email ?? "").trim().toLowerCase();
      const cpf = cpfValue(body.cpf);
      const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      if (!Number.isInteger(id) || nome.length < 2 || nome.length > 120 || email.length > 254 || !validEmail) return json({ error: "Informe um nome e um e-mail válidos." }, 400);

      const { data: target, error: targetError } = await admin.from("app_users").select("id,user_id,nome,email,role").eq("id", id).single();
      if (targetError) throw targetError;
      const { data: duplicate, error: duplicateError } = await admin.from("app_users").select("id").ilike("email", email).neq("id", id).maybeSingle();
      if (duplicateError) throw duplicateError;
      if (duplicate) return json({ error: "Este e-mail já está vinculado a outro usuário." }, 409);

      let authUserId = target.user_id as string | null;
      if (!authUserId) {
        const { data: authList, error: authListError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        if (authListError) throw authListError;
        authUserId = authList.users.find((item) => item.email?.toLowerCase() === target.email.toLowerCase())?.id ?? null;
      }
      if (!authUserId) return json({ error: "A conta de acesso deste usuário não foi localizada. Reenvie o convite e tente novamente." }, 400);

      const { data: authResult, error: authReadError } = await admin.auth.admin.getUserById(authUserId);
      const authUser = authResult.user;
      if (authReadError || !authUser) throw authReadError ?? new Error("Conta de acesso não localizada.");
      const emailChanged = email !== target.email.toLowerCase();
      const previousMetadata = authUser.user_metadata ?? {};
      const authChanges = emailChanged
        ? { email, email_confirm: Boolean(authUser.email_confirmed_at), user_metadata: { ...previousMetadata, nome, cpf } }
        : { user_metadata: { ...previousMetadata, nome, cpf } };
      const { error: authUpdateError } = await admin.auth.admin.updateUserById(authUserId, authChanges);
      if (authUpdateError) {
        const duplicateAuth = authUpdateError.message.toLowerCase().includes("already") || authUpdateError.message.toLowerCase().includes("registered");
        return json({ error: duplicateAuth ? "Este e-mail já possui uma conta de acesso." : "Não foi possível alterar a conta de acesso do usuário." }, 400);
      }

      const changedAt = new Date().toISOString();
      const appUpdate: Record<string, unknown> = { user_id: authUserId, nome, email, cpf, updated_at: changedAt };
      if (emailChanged) appUpdate.invite_resent_at = null;
      const { error: appUpdateError } = await admin.from("app_users").update(appUpdate).eq("id", id);
      if (appUpdateError) {
        const rollback = emailChanged
          ? { email: target.email, email_confirm: Boolean(authUser.email_confirmed_at), user_metadata: previousMetadata }
          : { user_metadata: previousMetadata };
        await admin.auth.admin.updateUserById(authUserId, rollback);
        throw appUpdateError;
      }
      return json({ success: true, email_changed: emailChanged, invite_pending: !authUser.email_confirmed_at });
    }

    return json({ error: "Ação inválida." }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Erro interno." }, 500);
  }
}
