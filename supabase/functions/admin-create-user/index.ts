import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const VALID_ROLES = [
  "admin", "accountant", "payroll", "operations",
  "supervisor", "security_supervisor", "viewer",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return json({ error: "Server is missing required configuration." }, 500);
  }

  // --- Authenticate the caller ---
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Missing or invalid Authorization header." }, 401);
  }
  const jwt = authHeader.slice("Bearer ".length);
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
  if (userErr || !userData.user) return json({ error: "Unauthorized." }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Tenant + role come from the server-side profile, never from the client.
  const { data: caller } = await admin
    .from("profiles")
    .select("tenant_id, role, is_active")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (!caller?.is_active || caller.role !== "admin") {
    return json({ error: "Access denied. Only tenant admins can create users." }, 403);
  }
  const tenantId: string = caller.tenant_id;

  const body = await req.json().catch(() => null) as
    | { firstName?: string; lastName?: string; email?: string; password?: string; role?: string }
    | null;

  const firstName = body?.firstName?.trim() ?? "";
  const lastName = body?.lastName?.trim() ?? "";
  const email = body?.email?.trim().toLowerCase() ?? "";
  const password = body?.password ?? "";
  const role = body?.role ?? "viewer";

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: "A valid email address is required." }, 400);
  }
  if (!firstName) return json({ error: "First name is required." }, 400);
  if (password.length < 8) return json({ error: "Password must be at least 8 characters." }, 400);
  if (!VALID_ROLES.includes(role)) return json({ error: "Invalid role." }, 400);

  const fullName = `${firstName} ${lastName}`.trim();

  // The trigger reads immutable app_metadata, not client-editable
  // user_metadata, to attach the profile to this tenant and role.
  // `email_confirm: true` skips email verification.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
    },
    app_metadata: {
      invited_tenant_id: tenantId,
      invited_role: role,
    },
  });

  if (createErr) {
    const msg = /already been registered|already exists/i.test(createErr.message)
      ? "A user with that email already exists."
      : createErr.message;
    return json({ error: msg }, 400);
  }

  return json({
    user: {
      id: created.user?.id,
      email: created.user?.email,
      full_name: fullName,
      role,
    },
  });
});
