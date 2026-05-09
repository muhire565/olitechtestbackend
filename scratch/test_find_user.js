const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function findUserByUsername(username) {
  console.log(`Searching for username: ${username}`);
  const { data: { users }, error } = await supabase.auth.admin.listUsers();
  
  if (error) {
    console.error("Error listing users:", error);
    return;
  }

  const user = users.find(u => 
    u.user_metadata?.username?.toLowerCase() === username.toLowerCase() ||
    u.email?.split('@')[0].toLowerCase() === username.toLowerCase()
  );

  if (user) {
    console.log("Found user:", user.email);
  } else {
    console.log("User not found.");
  }
}

// Replace with a username you know exists or 'IrakozeNadia' (from the full_name we saw)
findUserByUsername("IrakozeNadia"); 
