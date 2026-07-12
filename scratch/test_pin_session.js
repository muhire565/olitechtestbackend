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

async function testType(typeLabel, verifyType) {
  console.log(`\n======== type=${verifyType} ========`);
  const email = process.argv[2];
  if (!email) throw new Error("Pass email as argv[2]");

  await authClient.auth.signOut({ scope: "local" }).catch(() => {});

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError) {
    console.log("generateLink error:", linkError.message);
    return;
  }

  console.log("verification_type:", linkData.properties?.verification_type);
  console.log("hashed_token len:", linkData.properties?.hashed_token?.length);

  const { data, error } = await authClient.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: verifyType,
  });
  if (error || !data?.session) {
    console.log("verifyOtp error:", error?.message, "hasSession:", !!data?.session);
    return;
  }

  const { access_token, refresh_token } = data.session;
  console.log("access_token len:", access_token?.length);
  console.log("refresh_token len:", refresh_token?.length);
  console.log("refresh_token prefix:", refresh_token?.slice(0, 8));

  // Clear local session like production
  await authClient.auth.signOut({ scope: "local" }).catch(() => {});

  const { data: userData, error: userErr } = await admin.auth.getUser(access_token);
  console.log("getUser after local signOut:", userErr?.message || `ok ${userData?.user?.email}`);

  const { data: refreshData, error: refreshErr } = await authClient.auth.refreshSession({
    refresh_token,
  });
  console.log(
    "refreshSession after local signOut:",
    refreshErr?.message || `ok new_refresh=${!!refreshData?.session?.refresh_token}`
  );
}

async function main() {
  const email = process.argv[2];
  if (!email) {
    // Resolve cashier from id in logs
    const id = "5a283ac6-818a-443c-a999-3b495e16e43d";
    const { data } = await admin.auth.admin.getUserById(id);
    console.log("Resolved email:", data?.user?.email);
    if (!data?.user?.email) process.exit(1);
    process.argv[2] = data.user.email;
  }

  await testType("email", "email");
  await testType("magiclink", "magiclink");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
