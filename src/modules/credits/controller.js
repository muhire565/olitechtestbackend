const { supabase } = require("../../config/supabase");
const { ok, paginated, fail } = require("../../utils/http");
const { broadcastRealtime } = require("../../realtime");

const list = async (req, res, next) => {
  try {
    const { search, status, page = 1, limit = 20 } = req.query;
    const from = (Number(page) - 1) * Number(limit);
    
    console.log(`[Credits] GET /api/credits | user=${req.user?.id} | status=${status} | search="${search}" | page=${page}`);

    let q = supabase
      .from("credit_sales")
      .select("*, customers(*), sales(receipt_number)", { count: "exact" })
      .order("created_at", { ascending: false });

    const trimmedSearch = (search || "").trim();
    if (status && status !== "all") {
      q = q.eq("status", status);
    }

    if (trimmedSearch) {
      q = q.or(`full_name.ilike.%${trimmedSearch}%,phone_number.ilike.%${trimmedSearch}%`, { foreignTable: "customers" });
    }

    const { data, count, error } = await q.range(from, from + Number(limit) - 1);
    console.log(`[Credits] Query result: ${data?.length} records, count=${count}, error=${error?.message}`);
    if (error) throw fail(error.message);
    return paginated(res, data, Number(page), Number(limit), count);
  } catch (e) { next(e); }
};


const recordInstallment = async (req, res, next) => {
  try {
    const { credit_sale_id, amount, payment_method = "CASH" } = req.body;
    const amountNum = Number(amount);

    // 1. Get the credit sale
    const { data: creditSale, error: getErr } = await supabase
      .from("credit_sales")
      .select("*")
      .eq("id", credit_sale_id)
      .single();
    if (getErr) throw fail("Credit record not found");

    if (amountNum > Number(creditSale.balance_remaining)) {
      throw fail(`Payment exceeds balance. Remaining: ${creditSale.balance_remaining}`);
    }

    // 2. Insert installment
    const { error: insErr } = await supabase
      .from("credit_installments")
      .insert([{
        credit_sale_id,
        amount: amountNum,
        payment_method,
        recorded_by: req.user.id
      }]);
    if (insErr) throw fail(insErr.message);

    // 3. Update credit sale
    const newPaid = Number(creditSale.amount_paid) + amountNum;
    const newBalance = Number(creditSale.total_amount) - newPaid;
    let newStatus = "partially_paid";
    if (newBalance <= 0) newStatus = "paid";

    const { data: updated, error: updErr } = await supabase
      .from("credit_sales")
      .update({
        amount_paid: newPaid,
        balance_remaining: newBalance,
        status: newStatus,
        updated_at: new Date()
      })
      .eq("id", credit_sale_id)
      .select()
      .single();
    
    if (updErr) throw fail(updErr.message);

    // Broadcast real-time update so Credit Ledger & Dashboard Total Debt refresh
    broadcastRealtime({ type: "credits:updated", event: "installment", credit_sale_id });
    broadcastRealtime({ type: "dashboard:refresh" });

    return ok(res, updated);
  } catch (e) { next(e); }
};

const getInstallments = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from("credit_installments")
      .select("*")
      .eq("credit_sale_id", id)
      .order("created_at", { ascending: false });
    if (error) throw fail(error.message);
    return ok(res, data);
  } catch (e) { next(e); }
};

module.exports = { list, recordInstallment, getInstallments };
