require('dotenv').config();
const { supabase } = require("../src/config/supabase");

async function checkRLS() {
  console.log("Checking RLS on messages table...");
  const { data, error } = await supabase.rpc('get_policies', { table_name: 'messages' });
  
  if (error) {
    // If RPC doesn't exist, try another way
    console.log("RPC get_policies failed, checking with direct query...");
    const { data: policies, error: polError } = await supabase
        .from('pg_policies')
        .select('*')
        .eq('tablename', 'messages');
    
    if (polError) {
        console.error("Could not check policies:", polError.message);
    } else {
        console.log("Policies:", policies);
    }
  } else {
    console.log("Policies:", data);
  }
}

checkRLS();
