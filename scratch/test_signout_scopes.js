require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function makeClient() {
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function main() {
  const admin = await makeClient();
  const authClient = await makeClient();
  const id = "5a283ac6-818a-443c-a999-3b495e16e43d";
  const { data: u } = await admin.auth.admin.getUserById(id);
  const email = u.user.email;

  const { data: linkData } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data } = await authClient.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "magiclink",
  });
  const { access_token, refresh_token } = data.session;

  console.log("Testing signOut scopes...\n");

  // Clone tokens then try local signOut on the SAME client that owns the session
  const beforeLocal = { access_token, refresh_token };
  const so = await authClient.auth.signOut({ scope: "local" });
  console.log("signOut local error:", so.error?.message || null);

  const fresh = await makeClient();
  const g = await fresh.auth.getUser(beforeLocal.access_token);
  console.log("getUser after LOCAL signOut on owner client:", g.error?.message || "ok");
  const r = await fresh.auth.refreshSession({ refresh_token: beforeLocal.refresh_token });
  console.log("refresh after LOCAL signOut on owner client:", r.error?.message || "ok");

  // New session, try global signOut
  const auth2 = await makeClient();
  const { data: link2 } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: d2 } = await auth2.auth.verifyOtp({
    token_hash: link2.properties.hashed_token,
    type: "magiclink",
  });
  const tokens2 = { access_token: d2.session.access_token, refresh_token: d2.session.refresh_token };
  await auth2.auth.signOut({ scope: "global" });
  const fresh2 = await makeClient();
  const g2 = await fresh2.auth.getUser(tokens2.access_token);
  console.log("\ngetUser after GLOBAL signOut:", g2.error?.message || "ok");
  const r2 = await fresh2.auth.refreshSession({ refresh_token: tokens2.refresh_token });
  console.log("refresh after GLOBAL signOut:", r2.error?.message || "ok");

  // New session, NO signOut — just abandon the client
  const auth3 = await makeClient();
  const { data: link3 } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: d3 } = await auth3.auth.verifyOtp({
    token_hash: link3.properties.hashed_token,
    type: "magiclink",
  });
  const tokens3 = { access_token: d3.session.access_token, refresh_token: d3.session.refresh_token };
  // Don't sign out — discard reference
  const fresh3 = await makeClient();
  const g3 = await fresh3.auth.getUser(tokens3.access_token);
  console.log("\ngetUser with NO signOut (abandoned client):", g3.error?.message || "ok");
  const r3 = await fresh3.auth.refreshSession({ refresh_token: tokens3.refresh_token });
  console.log("refresh with NO signOut (abandoned client):", r3.error?.message || "ok");

  // Check if scope is actually sent — inspect supabase-js
  const pkg = require("@supabase/supabase-js/package.json");
  console.log("\n@supabase/supabase-js:", pkg.version);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
