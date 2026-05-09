require('dotenv').config();
const { supabase } = require("../src/config/supabase");

async function checkMessagesSchema() {
  console.log("Checking messages table schema...");
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .limit(1);

  if (error) {
    console.error("Error fetching from messages:", error);
  } else {
    console.log("Sample message row:", data);
  }

  // Also check profiles to see if 'is_active' exists
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .limit(1);
  
  if (profileError) {
    console.error("Error fetching from profiles:", profileError);
  } else {
    console.log("Sample profile row columns:", Object.keys(profile[0] || {}));
  }
}

checkMessagesSchema();
