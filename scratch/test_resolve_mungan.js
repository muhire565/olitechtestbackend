require("dotenv").config();
const { supabase } = require("../src/config/supabase");

async function findProfileIdByIdentifier(normalized) {
  const { data: byUsername } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", normalized)
    .maybeSingle();
  if (byUsername?.id) return { id: byUsername.id, via: "username" };

  const { data: byName } = await supabase
    .from("profiles")
    .select("id")
    .ilike("full_name", normalized)
    .maybeSingle();
  if (byName?.id) return { id: byName.id, via: "full_name" };

  return null;
}

(async () => {
  for (const id of ["mungan", "mugan", "cashier", "hillary"]) {
    const hit = await findProfileIdByIdentifier(id);
    console.log(id, hit);
    if (hit?.id) {
      const { data } = await supabase.auth.admin.getUserById(hit.id);
      console.log("  email:", data?.user?.email);
    }
  }
})();
