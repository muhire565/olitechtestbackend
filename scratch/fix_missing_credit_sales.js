require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function fixMissingCreditSales() {
  const { data: payments } = await supabase.from("payments").select("*").eq("method", "CREDIT");
  
  if (!payments || payments.length === 0) {
    console.log("No CREDIT payments found.");
    return;
  }

  for (const payment of payments) {
    const { data: sale } = await supabase.from("sales").select("*").eq("id", payment.sale_id).single();
    if (!sale) continue;

    const { data: existingCredit } = await supabase.from("credit_sales").select("*").eq("sale_id", sale.id);
    
    if (!existingCredit || existingCredit.length === 0) {
      console.log(`Missing credit_sale for sale ${sale.id}, customer: ${sale.customer_id}, amount: ${payment.amount}`);
      
      if (!sale.customer_id) {
        console.log("Error: sale has no customer_id!");
        continue;
      }
      
      const { error } = await supabase.from("credit_sales").insert([{
        sale_id: sale.id,
        customer_id: sale.customer_id,
        total_amount: payment.amount,
        balance_remaining: payment.amount,
        status: "unpaid"
      }]);
      
      if (error) {
        console.log("Failed to insert:", error.message);
      } else {
        console.log("Successfully inserted credit_sale!");
      }
    } else {
      console.log(`credit_sale already exists for sale ${sale.id}`);
    }
  }
}

fixMissingCreditSales();
