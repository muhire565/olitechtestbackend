const { supabase } = require("../../config/supabase");
const { ok, fail } = require("../../utils/http");

const resolveLoginEmail = async (identifier) => {
  const normalized = String(identifier || "").trim().toLowerCase();
  if (!normalized) throw fail("Username is required.", 400);
  if (normalized.includes("@")) return normalized;

  // Username login without schema changes: resolve against Supabase Auth metadata.
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw fail(error.message || "Could not resolve username.", 400);
  const users = data?.users || [];
  const match = users.find((u) => String(u.user_metadata?.username || "").trim().toLowerCase() === normalized);
  if (!match?.email) throw fail("Invalid credentials", 401);
  return match.email;
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const loginEmail = await resolveLoginEmail(email);
    
    let result;
    try {
      result = await supabase.auth.signInWithPassword({ email: loginEmail, password });
    } catch (err) {
      if (err.message?.includes('fetch failed') || err.code === 'UND_ERR_CONNECT_TIMEOUT') {
        throw fail("Internet connection timeout. Please check your network and try again.", 503);
      }
      throw err;
    }

    const { data, error } = result;
    if (error) {
      if (error.message?.includes('fetch failed')) {
        throw fail("Network error: Unable to reach authentication server. Please check your internet.", 503);
      }
      throw fail(error.message || "Invalid credentials", 401);
    }
    if (!data.session) throw fail("Invalid credentials", 401);
    
    let profileRes;
    try {
      profileRes = await supabase
        .from("profiles")
        .select("*")
        .eq("id", data.user.id)
        .single();
    } catch (err) {
       throw fail("Connection timeout while loading profile. Please try again.", 503);
    }
      
    const { data: profile, error: profileError } = profileRes;
    if (profileError || !profile) {
      if (profileError?.message?.includes('fetch failed')) {
         throw fail("Network error while loading profile.", 503);
      }
      throw fail("Profile not found for this user.", 403);
    }
    
    // Fire-and-forget: log the successful login (non-blocking)
    supabase.from("login_logs").insert({
      user_id: data.user.id,
      logged_in_at: new Date().toISOString(),
      ip_address: req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || null,
      user_agent: req.headers["user-agent"] || null,
    }).then(() => {}).catch(() => {});

    return ok(res, { 
      token: data.session.access_token, 
      refresh_token: data.session.refresh_token, 
      role: profile?.role, 
      user: { ...profile, email: data.user.email, username: data.user.user_metadata?.username || data.user.email } 
    });
  } catch (e) { next(e); }
};

const logout = async (req, res, next) => {
  try { await supabase.auth.signOut(); return ok(res, {}, "Logged out"); } catch (e) { next(e); }
};

const refresh = async (req, res, next) => {
  try {
    const { refresh_token } = req.body;
    const { data, error } = await supabase.auth.refreshSession({ refresh_token });
    if (error || !data.session) throw fail(error?.message || "Refresh failed", 401);
    return ok(res, { token: data.session.access_token, refresh_token: data.session.refresh_token });
  } catch (e) { next(e); }
};

const me = async (req, res, next) => {
  try {
    const { data, error } = await supabase.from("profiles").select("*").eq("id", req.user.id).single();
    if (error) throw fail(error.message, 400);
    return ok(res, { ...data, email: req.user.email, username: req.user.username || req.user.email });
  } catch (e) { next(e); }
};

const updateCredentials = async (req, res, next) => {
  try {
    const username = String(req.body.username || "").trim().toLowerCase();
    const currentPassword = String(req.body.current_password || "");
    const newPassword = String(req.body.new_password || "");

    if (!username && !newPassword) throw fail("Provide a new username and/or a new password.", 400);

    // Verify current password before allowing account credential changes.
    const verify = await supabase.auth.signInWithPassword({
      email: req.user.email,
      password: currentPassword,
    });
    if (verify.error || !verify.data?.session) throw fail("Current password is incorrect.", 401);

    const updatePayload = {};
    if (username) {
      const authUserRes = await supabase.auth.admin.getUserById(req.user.id);
      const existingMeta = authUserRes?.data?.user?.user_metadata || {};
      updatePayload.user_metadata = { ...existingMeta, username };
    }
    if (newPassword) updatePayload.password = newPassword;

    const { data, error } = await supabase.auth.admin.updateUserById(req.user.id, updatePayload);
    if (error) throw fail(error.message, 400);

    return ok(
      res,
      { username: data?.user?.user_metadata?.username || username || req.user.username || req.user.email },
      "Credentials updated"
    );
  } catch (e) { next(e); }
};

module.exports = { login, logout, refresh, me, updateCredentials };
