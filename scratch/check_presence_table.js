require('dotenv').config();
const { supabase } = require("../src/config/supabase");

async function checkUserPresenceTable() {
  console.log("Checking user_presence table...");
  const { data, error } = await supabase
    .from("user_presence")
    .select("*")
    .limit(1);

  if (error) {
    console.error("Error fetching from user_presence:", error.message);
    if (error.message.includes("does not exist")) {
        console.log("TABLE MISSING: user_presence does not exist.");
    }
  } else {
    console.log("user_presence table exists. Sample:", data);
  }
}

checkUserPresenceTable();
