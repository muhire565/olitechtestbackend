require("dotenv").config();
const { supabase, supabaseAuth } = require("../src/config/supabase");
const { hashPin, computePinLookup, verifyPin } = require("../src/utils/pin");

async function createSessionForUser(email) {
  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError || !linkData?.properties?.hashed_token) {
    throw new Error(linkError?.message || "generateLink failed");
  }

  const { data: before } = await supabaseAuth.auth.getSession();
  console.log("session before verifyOtp:", Boolean(before?.session));

  const { data, error } = await supabaseAuth.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "email",
  });

  console.log("verifyOtp error:", error?.message);
  console.log("session after verifyOtp:", Boolean(data?.session));

  await supabaseAuth.auth.signOut();
  return data?.session;
}

async function main() {
  const email = "olitech@gmail.com";
  const testPin = "567890";
  const ownerId = "34b7f6f1-a6bb-4526-98e4-28031bb81288";

  console.log("=== 1. Simulate setOwnPin password verify (signIn) ===");
  // Don't use real password - just check session pollution pattern
  const { data: sess0 } = await supabaseAuth.auth.getSession();
  console.log("initial supabaseAuth session:", Boolean(sess0?.session));

  console.log("\n=== 2. PIN hash generation ===");
  const { pin_hash, pin_lookup } = await hashPin(testPin);
  console.log({ pin_hash: pin_hash.slice(0, 20), pin_lookup: pin_lookup.slice(0, 20) });
  console.log("lookup recompute match:", computePinLookup(testPin) === pin_lookup);

  console.log("\n=== 3. Check pin_lookup column (read only) ===");
  const { data: pinCol, error: pinColErr } = await supabase.from("profiles").select("pin_lookup").limit(1);
  console.log({ pinColErr: pinColErr?.message, sample: pinCol?.[0] });

  console.log("\n=== 4. createSessionForUser clean ===");
  const s1 = await createSessionForUser(email);
  console.log("clean session ok:", Boolean(s1?.access_token));

  console.log("\n=== 5. createSessionForUser with stale session ===");
  // Simulate setOwnPin leaving a session - use magiclink for same user
  const { data: linkData } = await supabase.auth.admin.generateLink({ type: "magiclink", email });
  await supabaseAuth.auth.verifyOtp({ token_hash: linkData.properties.hashed_token, type: "email" });
  const { data: stale } = await supabaseAuth.auth.getSession();
  console.log("stale session set:", Boolean(stale?.session));

  try {
    const s2 = await createSessionForUser(email);
    console.log("session with stale pre-existing:", Boolean(s2?.access_token));
  } catch (e) {
    console.log("session with stale FAILED:", e.message);
  } finally {
    await supabaseAuth.auth.signOut();
  }

  console.log("\n=== 6. Owner current PIN state ===");
  const { data: owner } = await supabase.from("profiles").select("pin_hash, pin_lookup, username").eq("id", ownerId).single();
  console.log(owner);
}

main().catch((e) => { console.error(e); process.exit(1); });
