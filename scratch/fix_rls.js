require('dotenv').config();
const { supabase } = require("../src/config/supabase");

async function fixRLS() {
  console.log("Disabling RLS for chat tables...");
  
  // We can't run 'ALTER TABLE' directly via supabase-js unless we use an RPC
  // However, we can try to use a SQL query if there is an 'exec_sql' RPC.
  // Since we don't know if that exists, I'll advise the user to run it in Supabase SQL Editor.
  
  console.log("Please run the following SQL in your Supabase SQL Editor:");
  console.log(`
    ALTER TABLE messages DISABLE ROW LEVEL SECURITY;
    ALTER TABLE user_presence DISABLE ROW LEVEL SECURITY;
  `);
}

fixRLS();
