require("dotenv").config();
const { supabase } = require("../src/config/supabase");

async function resolveLoginEmail(identifier) {
  const normalized = String(identifier || "").trim().toLowerCase();
  console.log("normalized:", normalized);
  if (!normalized) return { error: "empty" };
  if (normalized.includes("@")) return { email: normalized };

  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", normalized)
    .maybeSingle();
  console.log("profile lookup:", { profile, profErr: profErr?.message });

  if (profile?.id) {
    const { data, error } = await supabase.auth.admin.getUserById(profile.id);
    if (!error && data?.user?.email) return { email: data.user.email, via: "profile+getUserById" };
  }

  const listRes = await supabase.auth.admin.listUsers();
  console.log("listUsers keys:", listRes.data ? Object.keys(listRes.data) : null);
  console.log("listUsers error:", listRes.error?.message);
  const users = listRes.data?.users;
  console.log("users count:", users?.length);

  if (!listRes.error && users) {
    const matchedUser = users.find(u =>
      u.user_metadata?.username?.toLowerCase() === normalized ||
      u.email?.split("@")[0].toLowerCase() === normalized
    );
    console.log("matched:", matchedUser ? { email: matchedUser.email, meta: matchedUser.user_metadata } : null);
    if (matchedUser?.email) return { email: matchedUser.email, via: "listUsers" };
  }

  return { error: "Invalid credentials" };
}

(async () => {
  for (const id of ["mugan", "Mugan", "olitech", "kwizera", "hillary", "bruce"]) {
    console.log("\n---", id, "---");
    console.log(await resolveLoginEmail(id));
  }
})();
