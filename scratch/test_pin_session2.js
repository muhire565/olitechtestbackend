require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const authClient = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const id = "5a283ac6-818a-443c-a999-3b495e16e43d";
  const { data: u } = await admin.auth.admin.getUserById(id);
  const email = u.user.email;
  console.log("email:", email);

  await authClient.auth.signOut({ scope: "local" }).catch(() => {});

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError) throw linkError;

  const { data, error } = await authClient.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "magiclink",
  });
  if (error) throw error;

  const { access_token, refresh_token } = data.session;
  console.log("\n--- BEFORE any signOut ---");

  const g1 = await admin.auth.getUser(access_token);
  console.log("admin.getUser(jwt):", g1.error?.message || g1.data?.user?.email);

  const g2 = await authClient.auth.getUser(access_token);
  console.log("authClient.getUser(jwt):", g2.error?.message || g2.data?.user?.email);

  // Fresh client, never signed in
  const fresh = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const g3 = await fresh.auth.getUser(access_token);
  console.log("fresh.getUser(jwt):", g3.error?.message || g3.data?.user?.email);

  const r1 = await fresh.auth.refreshSession({ refresh_token });
  console.log("fresh.refreshSession:", r1.error?.message || "ok");

  // Direct GoTrue HTTP
  const resp = await fetch(`${url}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${access_token}`,
      apikey: serviceKey,
    },
  });
  const body = await resp.json();
  console.log("HTTP /auth/v1/user:", resp.status, body.email || body.msg || body.error || body.message);

  const resp2 = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ refresh_token }),
  });
  const body2 = await resp2.json();
  console.log(
    "HTTP refresh:",
    resp2.status,
    body2.access_token ? "got access_token" : body2.msg || body2.error_description || body2.error
  );

  // Decode JWT
  const payload = JSON.parse(Buffer.from(access_token.split(".")[1], "base64url").toString());
  console.log("JWT payload:", {
    role: payload.role,
    sub: payload.sub,
    email: payload.email,
    exp: payload.exp,
    session_id: payload.session_id,
    aal: payload.aal,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
