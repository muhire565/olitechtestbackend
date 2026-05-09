require('dotenv').config();
const { supabase } = require("../src/config/supabase");

async function checkActiveUsers() {
  console.log("Checking profiles table...");
  const { data: users, error } = await supabase
    .from("profiles")
    .select("id, full_name, is_active, role");

  if (error) {
    console.error("ERROR:", error);
  } else {
    console.log("Total users:", users.length);
    console.log("Active users:", users.filter(u => u.is_active).length);
    console.log("Inactive users:", users.filter(u => !u.is_active).length);
    console.log("Sample users:", users.slice(0, 5));
  }
}

checkActiveUsers();
