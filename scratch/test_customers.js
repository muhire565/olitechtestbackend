require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { data, error } = await supabase
    .from("customers")
    .select("*, credit_sales(balance_remaining)")
    .order("full_name", { ascending: true });

  console.log("Error:", error);
  const enriched = data.map(c => {
    const credits = c.credit_sales || [];
    const total_debt = credits.reduce((acc, curr) => acc + Number(curr.balance_remaining), 0);
    return { ...c, total_debt, credit_sales: undefined };
  });

  console.log("Customers with debt:");
  enriched.forEach(c => console.log(`${c.full_name}: ${c.total_debt}`));
}

test();
