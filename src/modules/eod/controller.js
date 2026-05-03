const { supabase } = require("../../config/supabase");
const { ok, paginated, fail } = require("../../utils/http");
const { dayStartIso, dayEndIso } = require("../../utils/storeDayRange");

const expectedCashFor = async (cashier_id, date) => {
  // 1. Get opening balance from today's session if it exists
  const { data: session } = await supabase
    .from("eod_sessions")
    .select("opening_balance")
    .eq("cashier_id", cashier_id)
    .eq("date", date)
    .maybeSingle();
  const opening_balance = Number(session?.opening_balance || 0);

  // 2. Get cash sales
  const { data: cash, error: cashErr } = await supabase
    .from("payments")
    .select("amount, sales!inner(cashier_id, created_at, status)")
    .eq("method", "CASH")
    .eq("sales.cashier_id", cashier_id)
    .eq("sales.status", "completed")
    .gte("sales.created_at", dayStartIso(date))
    .lte("sales.created_at", dayEndIso(date));
  if (cashErr) throw fail(cashErr.message);

  const cash_sales = (cash || []).reduce((a, p) => a + Number(p.amount), 0);

  // 3. Get cash expenses
  const { data: expenses, error: expErr } = await supabase
    .from("expenses")
    .select("amount")
    .eq("created_by", cashier_id)
    .eq("payment_method", "CASH")
    .eq("expense_date", date);
  if (expErr) throw fail(expErr.message);
  const cash_expenses = (expenses || []).reduce((a, e) => a + Number(e.amount), 0);

  const expected_cash = opening_balance + cash_sales - cash_expenses;
  
  return { expected_cash, opening_balance, cash_sales, cash_expenses };
};

const setOpeningBalance = async (req, res, next) => {
  try {
    const { cashier_id, date, amount } = req.body;
    const { data, error } = await supabase
      .from("eod_sessions")
      .upsert(
        { 
          cashier_id, 
          date, 
          opening_balance: Number(amount || 0), 
          expected_cash: 0, 
          counted_cash: 0,
          submitted_at: null
        },
        { onConflict: "cashier_id,date" }
      )
      .select()
      .single();
    if (error) throw fail(error.message);
    return ok(res, data);
  } catch (e) {
    next(e);
  }
};

const submit = async (req, res, next) => {
  try {
    const { cashier_id, date, counted_cash, notes: bodyNotes } = req.body;
    const userNotes = typeof bodyNotes === "string" ? bodyNotes.trim() : "";

    // Get cashier name for the notification
    const { data: cashierProfile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", cashier_id)
      .single();
    const cashierName = cashierProfile?.full_name || "Unknown Cashier";

    const { expected_cash } = await expectedCashFor(cashier_id, date);
    const discrepancy = Number(counted_cash) - expected_cash;
    
    // Combine auto-generated notes with user justification
    let systemNotes = "Perfect Match (No Discrepancy)";
    if (discrepancy < 0) systemNotes = `Shortage ${Math.abs(discrepancy)}`;
    else if (discrepancy > 0) systemNotes = `Excess ${discrepancy}`;

    const notes = userNotes
      ? `${systemNotes} | Cashier Note: ${userNotes}`
      : systemNotes;

    const status = discrepancy === 0 ? "approved" : "pending";

    const { data, error } = await supabase
      .from("eod_sessions")
      .upsert(
        { 
          cashier_id, 
          date, 
          counted_cash, 
          expected_cash, 
          status,
          notes,
          submitted_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        },
        { onConflict: "cashier_id,date" }
      )
      .select()
      .single();

    if (error) throw fail(error.message);

    // Create a notification for the owner
    const absDiscrepancy = Math.abs(discrepancy);
    let severity = "info";
    let statusText = "Balanced";
    
    if (discrepancy < 0) {
      statusText = `Shortage of ${absDiscrepancy.toLocaleString()} RWF`;
      severity = absDiscrepancy >= 2000 ? "critical" : "warning";
    } else if (discrepancy > 0) {
      statusText = `Excess of ${discrepancy.toLocaleString()} RWF`;
      severity = "warning";
    }

    // Delete any existing notification for this shift to avoid duplicates
    const searchTitle = `EOD Settlement: ${cashierName}`;
    const searchBodyPart = `Shift settlement for ${date}`;
    await supabase
      .from("payment_notifications")
      .delete()
      .eq("title", searchTitle)
      .like("body", `%${searchBodyPart}%`);

    await supabase.from("payment_notifications").insert({
      title: searchTitle,
      body: `Shift settlement for ${date}: ${statusText}.`,
      severity,
      created_by: cashier_id,
      is_cleared: false
    });

    const { broadcastRealtime } = require("../../realtime");
    broadcastRealtime({ type: "payment_notifs_updated", event: "created" });
    broadcastRealtime({ type: "dashboard_refresh" });

    return ok(res, data);
  } catch (e) {
    next(e);
  }
};
const preview = async (req, res, next) => {
  try {
    const cashier_id = req.query.cashier_id;
    const date = req.query.date;
    if (!cashier_id || !date) throw fail("cashier_id and date are required");
    const totals = await expectedCashFor(cashier_id, date);
    const { data: existing, error: existingErr } = await supabase
      .from("eod_sessions")
      .select("id, counted_cash, status, created_at, submitted_at")
      .eq("cashier_id", cashier_id)
      .eq("date", date)
      .maybeSingle();
    if (existingErr) throw fail(existingErr.message);
    
    // A session is considered submitted only if submitted_at is set.
    const isSubmitted = !!(existing && existing.submitted_at);
    
    return ok(res, { ...totals, already_submitted: isSubmitted, existing });
  } catch (e) {
    next(e);
  }
};
const list = async (req, res, next) => {
  try {
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 20);
    const from = (page - 1) * limit;
    const { data, count, error } = await supabase
      .from("eod_sessions")
      .select("*, profiles!eod_sessions_cashier_id_fkey(full_name)", { count: "exact" })
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, from + limit - 1);
    if (error) throw fail(error.message);
    return paginated(res, data, page, limit, count);
  } catch (e) {
    next(e);
  }
};
const getOne = async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("eod_sessions")
      .select("*, profiles!eod_sessions_cashier_id_fkey(full_name)")
      .eq("id", req.params.id)
      .single();
    if (error) throw fail(error.message, 404);

    // Get breakdown for this session
    const breakdown = await expectedCashFor(data.cashier_id, data.date);

    return ok(res, { 
      ...data, 
      ...breakdown,
      cashier_name: data?.profiles?.full_name || null 
    });
  } catch (e) {
    next(e);
  }
};
const approve = async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("eod_sessions")
      .update({ status: "approved", reviewed_by: req.user.id, updated_at: new Date().toISOString() })
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw fail(error.message);
    return ok(res, data);
  } catch (e) {
    next(e);
  }
};

const flag = async (req, res, next) => {
  try {
    const { data: cur, error: curErr } = await supabase
      .from("eod_sessions")
      .select("notes")
      .eq("id", req.params.id)
      .single();
    if (curErr) throw fail(curErr.message);
    const ownerNote = typeof req.body.notes === "string" ? req.body.notes.trim() : "";
    const flagLine = ownerNote || "Flagged for manual review";
    const merged = cur?.notes ? `${cur.notes}\n\n[Owner review]: ${flagLine}` : flagLine;

    const { data, error } = await supabase
      .from("eod_sessions")
      .update({
        status: "flagged",
        notes: merged,
        reviewed_by: req.user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw fail(error.message);
    return ok(res, data);
  } catch (e) {
    next(e);
  }
};
const report = async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("eod_sessions")
      .select("*, profiles!eod_sessions_cashier_id_fkey(full_name)")
      .eq("date", req.params.date);
    if (error) throw fail(error.message);
    return ok(res, data);
  } catch (e) {
    next(e);
  }
};

const remove = async (req, res, next) => {
  try {
    const { data, error } = await supabase.from("eod_sessions").delete().eq("id", req.params.id).select("*, profiles(full_name)").single();
    if (error) throw fail(error.message);

    // Also delete associated notifications
    const cashierName = data?.profiles?.full_name || "Unknown Cashier";
    const searchTitle = `EOD Settlement: ${cashierName}`;
    const searchBodyPart = `Shift settlement for ${data.date}`;

    await supabase
      .from("payment_notifications")
      .delete()
      .eq("title", searchTitle)
      .like("body", `%${searchBodyPart}%`);

    return ok(res, data);
  } catch (e) {
    next(e);
  }
};

module.exports = { 
  setOpeningBalance, 
  submit, 
  preview, 
  list, 
  getOne, 
  approve, 
  flag, 
  report, 
  remove,
  expectedCashFor
};
