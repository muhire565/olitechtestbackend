const { supabase } = require("../../config/supabase");
const { ok, paginated, fail } = require("../../utils/http");
const { auditLogger } = require("../../utils/auditLogger");

const list = async (req, res, next) => {
  try {
    const page = Number(req.query.page || 1); const limit = Number(req.query.limit || 20); const from = (page - 1) * limit;
    const { data, count, error } = await supabase
      .from("profiles")
      .select("*, last_seen_at, is_blocked, blocked_at, blocked_by", { count: "exact" })
      .range(from, from + limit - 1)
      .order("created_at", { ascending: false });
    if (error) throw fail(error.message);
    return paginated(res, data, page, limit, count);
  } catch (e) { next(e); }
};
const getOne = async (req, res, next) => { try { const { data, error } = await supabase.from("profiles").select("*").eq("id", req.params.id).single(); if (error) throw fail(error.message, 404); return ok(res, data); } catch (e) { next(e); } };
const create = async (req, res, next) => {
  try {
    const { email, username, password, full_name, role } = req.body;
    const actorRole = String(req.user?.role || "");
    if (actorRole === "owner" && role !== "cashier") {
      throw fail("Owners can only create cashier accounts.", 403);
    }

    const normalizedUsername = String(username || (email ? String(email).split("@")[0] : ""))
      .trim()
      .toLowerCase();
    if (!normalizedUsername) throw fail("Username is required.", 400);

    const finalEmail = email || `${normalizedUsername}@cashier.local`;
    const { data: au, error: ae } = await supabase.auth.admin.createUser({
      email: finalEmail,
      password,
      email_confirm: true,
      user_metadata: { username: normalizedUsername },
    });
    if (ae) throw fail(ae.message);
    const { data, error } = await supabase.from("profiles").insert([{ id: au.user.id, full_name, role }]).select().single();
    if (error) throw fail(error.message);
    await auditLogger({ user_id: req.user.id, action: "CREATE_USER", entity_type: "profiles", entity_id: data.id, details: data, ip_address: req.ip });
    return ok(res, data, "User created");
  } catch (e) { next(e); }
};
const update = async (req, res, next) => { try { const { data, error } = await supabase.from("profiles").update(req.body).eq("id", req.params.id).select().single(); if (error) throw fail(error.message); await auditLogger({ user_id: req.user.id, action: "UPDATE_USER", entity_type: "profiles", entity_id: req.params.id, details: req.body, ip_address: req.ip }); return ok(res, data); } catch (e) { next(e); } };
const deactivate = async (req, res, next) => { try { const { data, error } = await supabase.from("profiles").update({ is_active: false }).eq("id", req.params.id).select().single(); if (error) throw fail(error.message); return ok(res, data, "User deactivated"); } catch (e) { next(e); } };
const resetPassword = async (req, res, next) => { try { const { error } = await supabase.auth.resetPasswordForEmail(req.body.email); if (error) throw fail(error.message); return ok(res, {}, "Password reset email sent"); } catch (e) { next(e); } };

const block = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    if (id === req.user.id) throw fail("You cannot block yourself.", 400);

    const { data, error } = await supabase
      .from("profiles")
      .update({ 
        is_blocked: true, 
        blocked_at: new Date().toISOString(), 
        blocked_by: req.user.id 
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw fail(error.message);

    // Force sign out in Supabase Auth
    await supabase.auth.admin.signOut(id);

    // Add to audit logs
    await supabase.from("account_audit_logs").insert({
      action_type: 'block',
      target_user_id: id,
      performed_by: req.user.id,
      reason,
      ip_address: req.ip
    });

    return ok(res, data, "User blocked successfully");
  } catch (e) { next(e); }
};

const unblock = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (id === req.user.id) throw fail("You cannot unblock yourself.", 400);

    const { data, error } = await supabase
      .from("profiles")
      .update({ 
        is_blocked: false, 
        blocked_at: null, 
        blocked_by: null 
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw fail(error.message);

    // Add to audit logs
    await supabase.from("account_audit_logs").insert({
      action_type: 'unblock',
      target_user_id: id,
      performed_by: req.user.id,
      ip_address: req.ip
    });

    return ok(res, data, "User unblocked successfully");
  } catch (e) { next(e); }
};

const forceLogout = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (id === req.user.id) throw fail("You cannot force logout yourself.", 400);

    // Call Supabase admin sign out
    const { error: signOutErr } = await supabase.auth.admin.signOut(id);
    if (signOutErr) {
      console.error(`[Admin] Force logout failed for user ${id}:`, signOutErr);
      throw fail(signOutErr.message);
    }

    // Add to audit logs
    await supabase.from("account_audit_logs").insert({
      action_type: 'logout',
      target_user_id: id,
      performed_by: req.user.id,
      ip_address: req.ip
    });

    return ok(res, {}, "User logged out successfully");
  } catch (e) { next(e); }
};

module.exports = { list, create, getOne, update, deactivate, resetPassword, block, unblock, forceLogout };
