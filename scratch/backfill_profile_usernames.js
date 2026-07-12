require("dotenv").config();
const { supabase } = require("../src/config/supabase");

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
  const users = await listAllAuthUsers();
  let updated = 0;

  for (const user of users) {
    const username = String(user.user_metadata?.username || user.email?.split("@")[0] || "")
      .trim()
      .toLowerCase();
    if (!username) continue;

    const { error } = await supabase
      .from("profiles")
      .update({ username, updated_at: new Date().toISOString() })
      .eq("id", user.id)
      .is("username", null);

    if (!error) updated += 1;
    else console.warn(`Skip ${user.id}:`, error.message);
  }

  console.log(`Backfilled username on ${updated} profile(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
