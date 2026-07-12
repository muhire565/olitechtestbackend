require("dotenv").config();
const { supabase, supabaseAuth } = require("../src/config/supabase");
const { computePinLookup, verifyPin } = require("../src/utils/pin");

const OWNER_ID = "34b7f6f1-a6bb-4526-98e4-28031bb81288";

async function main() {
  console.log("=== Owner profile ===");
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, full_name, username, role, pin_hash, pin_lookup")
    .eq("id", OWNER_ID)
    .single();
  console.log({ error: error?.message, profile: profile ? {
    ...profile,
    pin_hash: profile.pin_hash ? `${profile.pin_hash.slice(0, 20)}...` : null,
    pin_lookup: profile.pin_lookup?.slice(0, 20),
  } : null });

  console.log("\n=== Auth user ===");
  const { data: authData } = await supabase.auth.admin.getUserById(OWNER_ID);
  const u = authData?.user;
  console.log({
    email: u?.email,
    username_meta: u?.user_metadata?.username,
    last_sign_in: u?.last_sign_in_at,
  });

  console.log("\n=== PIN lookup secret prefix ===");
  const secret = (process.env.PIN_LOOKUP_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "pin-lookup-fallback").trim();
  console.log(secret.slice(0, 12) + "...");

  // Test common PINs if pin_lookup exists
  if (profile?.pin_lookup) {
    console.log("\n=== PIN brute sample (4-6 digit patterns) ===");
    const samples = ["1234", "12345", "123456", "0000", "1111", "4321", "0788308035".slice(0, 6)];
    for (const p of samples) {
      const lookup = computePinLookup(p);
      if (lookup === profile.pin_lookup) {
        console.log("MATCH found for pattern:", p.replace(/./g, "*"));
        console.log("bcrypt verify:", await verifyPin(p, profile.pin_hash));
      }
    }
    console.log("stored lookup:", profile.pin_lookup.slice(0, 32));
  }

  console.log("\n=== supabaseAuth session state ===");
  const { data: sessionData } = await supabaseAuth.auth.getSession();
  console.log("has session:", Boolean(sessionData?.session));
  if (sessionData?.session) {
    console.log("session user:", sessionData.session.user?.email);
  }
}

main().catch(console.error);
