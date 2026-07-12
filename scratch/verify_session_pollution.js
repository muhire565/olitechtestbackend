// Proves the root cause: calling signInWithPassword on the shared service-role
// client makes ALL subsequent DB calls run as that user (RLS applies).
// Creates a throwaway auth user, reproduces the bug on a polluted client,
// shows a clean client is unaffected, then deletes the user.
require("dotenv").config();
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

const admin = createClient(url, key, opts);

async function probe(client, label) {
  const ins = await client.from("credit_sales").insert([{
    sale_id: "00000000-0000-0000-0000-000000000000",
    customer_id: -1,
    total_amount: 1,
    balance_remaining: 1,
    status: "unpaid",
  }]);
  const sel = await client.from("credit_sales").select("id", { count: "exact", head: true });
  const cust = await client.from("customers").select("id, credit_sales(balance_remaining)").limit(3);
  console.log(`[${label}] insert error: ${ins.error?.code} ${ins.error?.message}`);
  console.log(`[${label}] credit_sales visible count: ${sel.count} (error: ${sel.error?.message || "none"})`);
  console.log(`[${label}] customers rows: ${cust.data?.length ?? "ERR"}, embedded credit rows: ${JSON.stringify(cust.data?.map(c => (c.credit_sales || []).length))}`);
}

async function main() {
  const email = `rls_diag_${Date.now()}@example.com`;
  const password = crypto.randomBytes(12).toString("hex") + "Aa1!";
  const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (cErr) throw cErr;
  console.log("Created temp user:", created.user.id);

  try {
    // Simulate the runtime bug: same client used for DB + login
    const shared = createClient(url, key, opts);
    await probe(shared, "BEFORE login (clean service-role)");

    const { error: siErr } = await shared.auth.signInWithPassword({ email, password });
    if (siErr) throw siErr;
    console.log("Signed in on shared client (simulating POST /auth/login)...");

    await probe(shared, "AFTER login (polluted client)");
  } finally {
    const { error: dErr } = await admin.auth.admin.deleteUser(created.user.id);
    console.log("Deleted temp user:", dErr ? `FAILED: ${dErr.message}` : "ok");
  }
}

main().catch((e) => { console.error("FATAL:", e.message || e); process.exit(1); });
