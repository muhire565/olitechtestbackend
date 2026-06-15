require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  console.log("=== CREDIT SALES DIRECT QUERY ===");
  
  // Raw query - no filters
  const { data, error, count } = await supabase
    .from("credit_sales")
    .select("*, customers(*), sales(receipt_number)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(0, 19);

  console.log("Error:", error?.message || "none");
  console.log("Count:", count);
  console.log("Data length:", data?.length);
  console.log("Records:", JSON.stringify(data?.map(r => ({ id: r.id, status: r.status, customer: r.customers?.full_name, total: r.total_amount })), null, 2));

  // Also test with RLS anon key if set
  console.log("\n=== ENV CHECK ===");
  console.log("SUPABASE_URL set:", !!process.env.SUPABASE_URL);
  console.log("SERVICE_ROLE_KEY set:", !!process.env.SUPABASE_SERVICE_ROLE_KEY);
  console.log("KEY starts with:", process.env.SUPABASE_SERVICE_ROLE_KEY?.substring(0, 20));
}

main().catch(console.error);
