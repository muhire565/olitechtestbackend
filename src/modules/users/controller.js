const { supabase } = require("../../config/supabase");
const { ok, paginated, fail } = require("../../utils/http");
const { broadcastRealtime } = require("../../realtime");
const { auditLogger } = require("../../utils/auditLogger");
const { isValidPinFormat, hashPin } = require("../../utils/pin");

const PROFILE_PUBLIC_COLUMNS = "id, full_name, username, role, is_active, is_blocked, blocked_at, blocked_by, last_seen_at, pin_hash, created_at, updated_at";

const enrichProfilesWithAuthEmail = async (rows = []) => {
  if (!rows.length) return rows;
  const { data: { users }, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw fail(error.message);
  const emailById = new Map((users || []).map((u) => [u.id, u.email]));
  return rows.map(({ pin_hash, pin_lookup, ...row }) => ({
    ...row,
    email: emailById.get(row.id) || null,
    pin_set: Boolean(pin_hash),
  }));
};

const list = async (req, res, next) => {
  try {
    const page = Number(req.query.page || 1); const limit = Number(req.query.limit || 20); const from = (page - 1) * limit;
    const { data, count, error } = await supabase
      .from("profiles")
      .select(PROFILE_PUBLIC_COLUMNS, { count: "exact" })
      .range(from, from + limit - 1)
      .order("created_at", { ascending: false });
    if (error) throw fail(error.message);
    const safe = await enrichProfilesWithAuthEmail(data || []);
    return paginated(res, safe, page, limit, count);
  } catch (e) { next(e); }
};
const getOne = async (req, res, next) => {
  try {
    const { data, error } = await supabase.from("profiles").select(PROFILE_PUBLIC_COLUMNS).eq("id", req.params.id).single();
    if (error) throw fail(error.message, 404);
    const [enriched] = await enrichProfilesWithAuthEmail([data]);
    return ok(res, enriched);
  } catch (e) { next(e); }
};
const create = async (req, res, next) => {
  try {
    const { email, username, password, full_name, role, pin } = req.body;
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

    let pinFields = {};
    if (pin) {
      if (!isValidPinFormat(pin)) throw fail("PIN must be 4 to 6 digits.", 400);
      pinFields = await hashPin(pin);
    }

    const { data, error } = await supabase.from("profiles").insert([{ 
      id: au.user.id, 
      full_name, 
      username: normalizedUsername,
      role,
      ...pinFields,
    }]).select().single();
    if (error) {
      if (error.code === "23505" && pin) throw fail("This PIN is already in use. Choose a different PIN.", 409);
      throw fail(error.message);
    }
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
    await supabase.rpc('delete_user_sessions', { target_user_id: id });

    // PUSH Realtime Security Event
    broadcastRealtime({ type: "security_blocked" }, id);

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

    // Force sign out in Supabase Auth by deleting all sessions
    const { error: signOutErr } = await supabase.rpc('delete_user_sessions', { target_user_id: id });
    
    // PUSH Realtime Security Event
    broadcastRealtime({ type: "security_logout" }, id);

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

const setPin = async (req, res, next) => {
  try {
    const { id } = req.params;
    const pin = String(req.body.pin || "").trim();
    const actorRole = String(req.user?.role || "");

    if (!isValidPinFormat(pin)) throw fail("PIN must be 4 to 6 digits.", 400);

    const { data: target, error: targetError } = await supabase
      .from("profiles")
      .select("id, role, full_name")
      .eq("id", id)
      .single();

    if (targetError || !target) throw fail("User not found.", 404);

    if (actorRole === "owner") {
      if (target.role !== "cashier") throw fail("Owners can only set PINs for cashier accounts.", 403);
    } else if (actorRole !== "developer") {
      throw fail("Forbidden: insufficient permissions", 403);
    }

    const { pin_hash, pin_lookup } = await hashPin(pin);

    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("pin_lookup", pin_lookup)
      .neq("id", id)
      .maybeSingle();

    if (existing) throw fail("This PIN is already in use. Choose a different PIN.", 409);

    const { data, error } = await supabase
      .from("profiles")
      .update({ pin_hash, pin_lookup, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id, full_name, role")
      .single();

    if (error) {
      if (error.code === "23505") throw fail("This PIN is already in use. Choose a different PIN.", 409);
      throw fail(error.message, 400);
    }

    await auditLogger({
      user_id: req.user.id,
      action: "SET_USER_PIN",
      entity_type: "profiles",
      entity_id: id,
      details: { target_role: target.role },
      ip_address: req.ip,
    });

    return ok(res, { user: data, pin_set: true }, "PIN updated");
  } catch (e) { next(e); }
};

const clearPin = async (req, res, next) => {
  try {
    const { id } = req.params;
    const actorRole = String(req.user?.role || "");

    const { data: target, error: targetError } = await supabase
      .from("profiles")
      .select("id, role, full_name")
      .eq("id", id)
      .single();

    if (targetError || !target) throw fail("User not found.", 404);

    if (actorRole === "owner") {
      if (target.role !== "cashier") throw fail("Owners can only clear PINs for cashier accounts.", 403);
    } else if (actorRole !== "developer") {
      throw fail("Forbidden: insufficient permissions", 403);
    }

    const { data, error } = await supabase
      .from("profiles")
      .update({ pin_hash: null, pin_lookup: null, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id, full_name, role")
      .single();

    if (error) throw fail(error.message, 400);

    await auditLogger({
      user_id: req.user.id,
      action: "CLEAR_USER_PIN",
      entity_type: "profiles",
      entity_id: id,
      details: { target_role: target.role },
      ip_address: req.ip,
    });

    return ok(res, { user: data, pin_set: false }, "PIN removed");
  } catch (e) { next(e); }
};

module.exports = { list, create, getOne, update, deactivate, resetPassword, block, unblock, forceLogout, setPin, clearPin };
