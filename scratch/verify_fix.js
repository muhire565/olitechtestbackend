// End-to-end check of the FIXED code path: sign in via supabaseAuth (as the
// login route now does), then verify the shared `supabase` client still runs
// as service_role (FK error 23503 expected, NOT RLS error 42501) and still
// sees credit_sales rows for the customer debt aggregation.
require("dotenv").config();
const crypto = require("crypto");
const { supabase, supabaseAuth } = require("../src/config/supabase");

async function main() {
  const email = `rls_fix_check_${Date.now()}@example.com`;
  const password = crypto.randomBytes(12).toString("hex") + "Aa1!";
  const { data: created, error: cErr } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
  if (cErr) throw cErr;

  try {
    const { error: siErr } = await supabaseAuth.auth.signInWithPassword({ email, password });
    if (siErr) throw siErr;
    console.log("Login performed on supabaseAuth (as in POST /auth/login).");

    const ins = await supabase.from("credit_sales").insert([{
      sale_id: "00000000-0000-0000-0000-000000000000",
      customer_id: -1,
      total_amount: 1,
      balance_remaining: 1,
      status: "unpaid",
    }]);
    const sel = await supabase.from("credit_sales").select("id", { count: "exact", head: true });
    const cust = await supabase.from("customers").select("id, credit_sales(balance_remaining)").limit(5);

    console.log("insert error code:", ins.error?.code, "(expect 23503 FK, NOT 42501 RLS)");
    console.log("credit_sales visible count:", sel.count, "(expect > 0)");
    console.log("customers embedded credit rows:", JSON.stringify(cust.data?.map(c => (c.credit_sales || []).length)));

    const pass = ins.error?.code === "23503" && (sel.count ?? 0) > 0;
    console.log(pass ? "RESULT: PASS — service-role client unaffected by login" : "RESULT: FAIL");
  } finally {
    await supabase.auth.admin.deleteUser(created.user.id);
    console.log("Temp user deleted.");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("FATAL:", e.message || e); process.exit(1); });
