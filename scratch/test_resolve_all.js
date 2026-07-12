require("dotenv").config();
const controller = require("../src/modules/auth/controller");

// Extract resolveLoginEmail by simulating - we'll inline the updated logic
const { supabase } = require("../src/config/supabase");

async function getAuthEmailForUser(userId) {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !data?.user?.email) throw new Error("no email");
  return data.user.email;
}

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

async function findProfileIdByIdentifier(normalized) {
  const { data: byUsername } = await supabase.from("profiles").select("id").eq("username", normalized).maybeSingle();
  if (byUsername?.id) return byUsername.id;
  const { data: byName } = await supabase.from("profiles").select("id").ilike("full_name", normalized).maybeSingle();
  if (byName?.id) return byName.id;
  return null;
}

async function resolveLoginEmail(identifier) {
  const normalized = String(identifier || "").trim().toLowerCase();
  if (normalized.includes("@")) return normalized;
  const profileId = await findProfileIdByIdentifier(normalized);
  if (profileId) {
    try { return await getAuthEmailForUser(profileId); } catch (_) {}
  }
  const users = await listAllAuthUsers();
  const matched = users.find((u) =>
    u.user_metadata?.username?.toLowerCase() === normalized ||
    u.email?.split("@")[0].toLowerCase() === normalized
  );
  if (matched?.email) return matched.email;
  throw new Error("Invalid credentials");
}

(async () => {
  for (const u of ["mugan", "mungan", "cashier", "hillary", "olitech@gmail.com"]) {
    try {
      console.log(u, "->", await resolveLoginEmail(u));
    } catch (e) {
      console.log(u, "-> FAIL", e.message);
    }
  }
})();
