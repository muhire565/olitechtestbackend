const { supabase } = require("../../config/supabase");
const { ok, fail } = require("../../utils/http");

/** Developer: list login activity */
const listLoginLogs = async (req, res, next) => {
  try {
    if (req.user.role !== "developer") throw fail("Forbidden", 403);

    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 100)));
    const page = Math.max(1, Number(req.query.page || 1));
    const offset = (page - 1) * limit;

    const { data, error, count } = await supabase
      .from("login_logs")
      .select("id, logged_in_at, ip_address, user_agent, profiles(full_name, role)", { count: "exact" })
      .order("logged_in_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw fail(error.message);
    return res.json({ success: true, data: data || [], pagination: { page, limit, total: count || 0 } });
  } catch (e) {
    next(e);
  }
/** Developer: delete a specific login log */
const deleteLoginLog = async (req, res, next) => {
  try {
    if (req.user.role !== "developer") throw fail("Forbidden", 403);
    const { error } = await supabase.from("login_logs").delete().eq("id", req.params.id);
    if (error) throw fail(error.message);
    return ok(res, {}, "Log entry deleted");
  } catch (e) {
    next(e);
  }
};

/** Developer: clear all login logs */
const clearAllLoginLogs = async (req, res, next) => {
  try {
    if (req.user.role !== "developer") throw fail("Forbidden", 403);
    const { error } = await supabase.from("login_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000"); // Delete all
    if (error) throw fail(error.message);
    return ok(res, {}, "All login logs cleared");
  } catch (e) {
    next(e);
  }
};

module.exports = { listLoginLogs, deleteLoginLog, clearAllLoginLogs };
