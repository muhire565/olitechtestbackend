const { supabase } = require("../../config/supabase");
const { ok, paginated, fail } = require("../../utils/http");
const { broadcastRealtime } = require("../../realtime");

const list = async (req, res, next) => {
  try {
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 20);
    const from = (page - 1) * limit;
    const rangeFrom = req.query.from;
    const rangeTo = req.query.to;

    let q = supabase
      .from("expenses")
      .select("*", { count: "exact" })
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, from + limit - 1);

    if (rangeFrom && rangeTo) q = q.gte("expense_date", rangeFrom).lte("expense_date", rangeTo);
    const { data, count, error } = await q;
    if (error) throw fail(error.message);
    return paginated(res, data || [], page, limit, count || 0);
  } catch (e) {
    next(e);
  }
};

const { expectedCashFor } = require("../eod/controller");

const create = async (req, res, next) => {
  try {
    const payment_method = String(req.body.payment_method || "CASH").toUpperCase();
    const amount = Number(req.body.amount);
    const expense_date = req.body.expense_date || new Date().toISOString().slice(0, 10);
    const created_by = req.user.id;

    // Strict Cash Validation: Check if there's enough cash in the drawer
    if (payment_method === "CASH") {
      const { expected_cash } = await expectedCashFor(created_by, expense_date);
      if (amount > expected_cash) {
        throw fail(
          `Insufficient cash in drawer. Available cash: ${expected_cash.toLocaleString()} RWF. You cannot spend more than what you have.`, 
          400
        );
      }
    }

    const payload = {
      description: String(req.body.description || "").trim(),
      category: String(req.body.category || "Operations").trim(),
      amount,
      expense_date,
      created_by,
      payment_method,
    };
    const { data, error } = await supabase.from("expenses").insert([payload]).select().single();
    if (error) throw fail(error.message);
    broadcastRealtime({ type: "expenses_updated", event: "expense_created", expense_id: data.id, amount: data.amount });
    return ok(res, data, "Expense added");
  } catch (e) {
    next(e);
  }
};

const remove = async (req, res, next) => {
  try {
    const { data, error } = await supabase.from("expenses").delete().eq("id", req.params.id).select().single();
    if (error) throw fail(error.message);
    broadcastRealtime({ type: "expenses_updated", event: "expense_deleted", expense_id: data.id, amount: data.amount });
    return ok(res, data, "Expense removed");
  } catch (e) {
    next(e);
  }
};

module.exports = { list, create, remove };
