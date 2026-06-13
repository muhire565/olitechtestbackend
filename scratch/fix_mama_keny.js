require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function fixMamaKeny() {
  const saleId = "52dc0aae-a6b0-4410-bc03-4ee0db6447a1";
  
  // 1. Get the credit sale
  const { data: creditSale, error: getErr } = await supabase
    .from("credit_sales")
    .select("*")
    .eq("sale_id", saleId)
    .single();

  if (getErr) {
    console.error("Error fetching credit sale:", getErr.message);
    return;
  }
  
  if (creditSale) {
    console.log("Found credit sale:", creditSale.id);
    
    // The actual sale total amount is 108000
    const trueAmount = 108000;
    const paid = Number(creditSale.amount_paid || 0);
    const newBalance = trueAmount - paid;
    
    const { data: updated, error: updErr } = await supabase
      .from("credit_sales")
      .update({
        total_amount: trueAmount,
        balance_remaining: newBalance
      })
      .eq("id", creditSale.id)
      .select()
      .single();
      
    if (updErr) {
      console.error("Error updating credit sale:", updErr.message);
    } else {
      console.log("Successfully updated:", updated);
    }
  } else {
    console.log("No credit sale found for this sale ID.");
  }
}

fixMamaKeny();
