require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { data, error } = await supabase.from("credit_sales").select("*");
  console.log("Error:", error);
  console.log("Credit Sales Count:", data?.length);
  console.log("Data:", JSON.stringify(data, null, 2));
}

test();
