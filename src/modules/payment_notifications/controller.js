const { supabase } = require("../../config/supabase");
const { ok, fail } = require("../../utils/http");

/** Developer: create a payment notification */
const create = async (req, res, next) => {
  try {
    if (req.user.role !== "developer") throw fail("Forbidden", 403);
    const { title, body, severity = "warning", is_reminder = false } = req.body;
    if (!title || !body) throw fail("title and body are required", 400);

    const { data, error } = await supabase
      .from("payment_notifications")
      .insert({
        title: String(title).trim(),
        body: String(body).trim(),
        severity,
        is_reminder,
        is_cleared: false,
        created_by: req.user.id,
      })
      .select()
      .single();

    if (error) throw fail(error.message);
    return ok(res, data, "Notification created");
  } catch (e) {
    next(e);
  }
};

/** Developer: list all payment notifications (including cleared) */
const listAll = async (req, res, next) => {
  try {
    if (req.user.role !== "developer") throw fail("Forbidden", 403);
    const { data, error } = await supabase
      .from("payment_notifications")
      .select("*, profiles!payment_notifications_created_by_fkey(full_name)")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw fail(error.message);
    return ok(res, data || []);
  } catch (e) {
    next(e);
  }
};

/** Owner / Cashier: list active (non-cleared) payment notifications */
const listActive = async (req, res, next) => {
  try {
    const role = req.user.role;
    if (!["owner", "cashier", "developer"].includes(role)) throw fail("Forbidden", 403);

    const { data, error } = await supabase
      .from("payment_notifications")
      .select("id, title, body, severity, is_reminder, created_at")
      .eq("is_cleared", false)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw fail(error.message);
    return ok(res, data || []);
  } catch (e) {
    next(e);
  }
};

/** Developer: mark a notification as cleared */
const clear = async (req, res, next) => {
  try {
    if (req.user.role !== "developer") throw fail("Forbidden", 403);
    const { id } = req.params;

    const { data, error } = await supabase
      .from("payment_notifications")
      .update({ is_cleared: true, cleared_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) throw fail(error.message);
    return ok(res, data, "Notification cleared");
  } catch (e) {
    next(e);
  }
};

/** Developer: unmark a cleared notification (restore it) */
const restore = async (req, res, next) => {
  try {
    if (req.user.role !== "developer") throw fail("Forbidden", 403);
    const { id } = req.params;

    const { data, error } = await supabase
      .from("payment_notifications")
      .update({ is_cleared: false, cleared_at: null })
      .eq("id", id)
      .select()
      .single();

    if (error) throw fail(error.message);
    return ok(res, data, "Notification restored");
  } catch (e) {
    next(e);
  }
};

/** Developer: delete a payment notification permanently */
const remove = async (req, res, next) => {
  try {
    if (req.user.role !== "developer") throw fail("Forbidden", 403);
    const { id } = req.params;

    const { error } = await supabase
      .from("payment_notifications")
      .delete()
      .eq("id", id);

    if (error) throw fail(error.message);
    return ok(res, {}, "Notification deleted");
  } catch (e) {
    next(e);
  }
};

module.exports = { create, listAll, listActive, clear, restore, remove };
