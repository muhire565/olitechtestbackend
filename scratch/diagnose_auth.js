require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const { computePinLookup, verifyPin } = require("../src/utils/pin");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

async function listAllAuthUsers() {
  const all = [];
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const users = data?.users || [];
    all.push(...users);
    if (users.length < 200) break;
    page += 1;
  }
  return all;
}

async function main() {
  console.log("=== Profiles columns probe ===");
  const { data: profiles, error: pErr } = await supabase.from("profiles").select("*").limit(5);
  if (pErr) {
    console.error("profiles select error:", pErr.message);
  } else {
    console.log("profile count sample:", profiles.length);
    profiles.forEach((p) => {
      console.log({
        id: p.id,
        full_name: p.full_name,
        username: p.username,
        role: p.role,
        has_pin_hash: Boolean(p.pin_hash),
        has_pin_lookup: Boolean(p.pin_lookup),
        pin_lookup_prefix: p.pin_lookup ? p.pin_lookup.slice(0, 12) : null,
      });
    });
  }

  console.log("\n=== Username column probe ===");
  const { data: byUser, error: uErr } = await supabase
    .from("profiles")
    .select("id, username")
    .not("username", "is", null)
    .limit(10);
  if (uErr) console.error("username query error:", uErr.message);
  else console.log("profiles with username:", byUser);

  console.log("\n=== PIN columns probe ===");
  const { data: pinRows, error: pinErr } = await supabase
    .from("profiles")
    .select("id, full_name, role, pin_hash, pin_lookup")
    .not("pin_hash", "is", null)
    .limit(10);
  if (pinErr) console.error("pin query error:", pinErr.message);
  else {
    console.log("profiles with PIN set:", pinRows?.length || 0);
    pinRows?.forEach((r) => console.log({ id: r.id, full_name: r.full_name, role: r.role, pin_lookup: r.pin_lookup?.slice(0, 16) }));
  }

  console.log("\n=== Auth users (paginated) ===");
  const authUsers = await listAllAuthUsers();
  console.log("auth user count:", authUsers.length);
  authUsers.forEach((u) => {
    console.log({
      id: u.id,
      email: u.email,
      username_meta: u.user_metadata?.username,
      email_prefix: u.email?.split("@")[0],
    });
  });

  // Test resolve paths for known usernames from screenshot
  for (const testUser of ["mugan", "admin_user"]) {
    console.log(`\n=== Resolve test: ${testUser} ===`);
    const normalized = testUser.toLowerCase();
    const { data: profile, error: profErr } = await supabase
      .from("profiles")
      .select("id, username")
      .eq("username", normalized)
      .maybeSingle();
    console.log("profiles.username lookup:", { profile, error: profErr?.message });

    const matched = authUsers.find(
      (u) =>
        u.user_metadata?.username?.toLowerCase() === normalized ||
        u.email?.split("@")[0].toLowerCase() === normalized
    );
    console.log("auth.users match:", matched ? { id: matched.id, email: matched.email } : null);
  }

  // Test PIN lookup for a sample if any PINs exist
  if (pinRows?.length) {
    console.log("\n=== PIN lookup self-test (recompute vs stored) ===");
    console.log("PIN_LOOKUP_SECRET prefix:", (process.env.PIN_LOOKUP_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "pin-lookup-fallback").slice(0, 8));
    console.log("Cannot verify PIN without plaintext - only check column presence");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
