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
};

module.exports = { listLoginLogs };
