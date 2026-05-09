const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
    console.error("SUPABASE_URL is missing in .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function checkSchema() {
  console.log("Checking profiles table...");
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .limit(1);

  if (error) {
    console.error("Error fetching profiles:", error);
  } else {
    console.log("Profiles data (sample):", data);
    if (data.length > 0) {
      console.log("Available columns:", Object.keys(data[0]));
    } else {
      console.log("Profiles table is empty or we couldn't get columns.");
      // Let's try to get columns using a trick if possible, or just assume it's empty
    }
  }
}

checkSchema();
