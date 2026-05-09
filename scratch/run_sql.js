const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function tryExecSql() {
  const sql = "ALTER TABLE profiles ADD COLUMN IF NOT EXISTS username TEXT UNIQUE, ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;";
  console.log("Attempting to run SQL via RPC exec_sql...");
  const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });
  
  if (error) {
    console.error("RPC exec_sql failed (it might not exist):", error);
  } else {
    console.log("SQL executed successfully!");
  }
}

tryExecSql();
