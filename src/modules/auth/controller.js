const { supabase, createAuthClient } = require("../../config/supabase");
const { ok, fail } = require("../../utils/http");
const { isValidPinFormat, computePinLookup, verifyPin, PIN_LOGIN_ROLES } = require("../../utils/pin");

const sanitizeProfile = (profile) => {
  if (!profile) return profile;
  const { pin_hash, pin_lookup, email: _ignoredEmail, ...safe } = profile;
  return { ...safe, pin_set: Boolean(pin_hash) };
};

const getAuthUserById = async (userId) => {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error) throw fail(error.message, 500);
  return data?.user || null;
};

const getAuthEmailForUser = async (userId) => {
  const authUser = await getAuthUserById(userId);
  const email = authUser?.email;
  if (!email) throw fail("Account email not found.", 403);
  return email;
};

const getAuthIdentityForUser = async (userId, profile = {}) => {
  const authUser = await getAuthUserById(userId);
  const email = authUser?.email;
  if (!email) throw fail("Account email not found.", 403);
  const username = authUser?.user_metadata?.username || profile.username || email.split("@")[0];
  return { email, username };
};

const listAllAuthUsers = async () => {
  const all = [];
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const users = data?.users || [];
    all.push(...users);
    if (users.length < 200) break;
    page += 1;
  }
  return all;
};

const findProfileIdByIdentifier = async (normalized) => {
  const { data: byUsername, error: usernameError } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", normalized)
    .maybeSingle();
  if (usernameError && !usernameError.message?.includes("does not exist")) throw fail(usernameError.message, 500);
  if (byUsername?.id) return byUsername.id;

  const { data: byName, error: nameError } = await supabase
    .from("profiles")
    .select("id")
    .ilike("full_name", normalized)
    .maybeSingle();
  if (nameError) throw fail(nameError.message, 500);
  if (byName?.id) return byName.id;

  return null;
};

const syncProfileUsername = async (userId, username) => {
  const normalized = String(username || "").trim().toLowerCase();
  if (!normalized || normalized.includes("@")) return;
  await supabase
    .from("profiles")
    .update({ username: normalized, updated_at: new Date().toISOString() })
    .eq("id", userId)
    .is("username", null)
    .then(() => {})
    .catch(() => {});
};

const verifyCurrentPassword = async (email, password) => {
  // Ephemeral client — never share sessions across requests.
  // Do not signOut afterward: even scope:"local" revokes the session server-side here.
  const auth = createAuthClient();
  const verify = await auth.auth.signInWithPassword({ email, password });
  if (verify.error || !verify.data?.session) {
    throw fail("Current password is incorrect.", 401);
  }
};

const PIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const PIN_MAX_ATTEMPTS = 8;
const pinAttempts = new Map();

const recordPinAttempt = (ip) => {
  const key = ip || "unknown";
  const now = Date.now();
  const entry = pinAttempts.get(key) || { count: 0, resetAt: now + PIN_ATTEMPT_WINDOW_MS };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + PIN_ATTEMPT_WINDOW_MS;
  }
  entry.count += 1;
  pinAttempts.set(key, entry);
  return entry;
};

const isPinRateLimited = (ip) => {
  const entry = pinAttempts.get(ip || "unknown");
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    pinAttempts.delete(ip || "unknown");
    return false;
  }
  return entry.count >= PIN_MAX_ATTEMPTS;
};

const clearPinAttempts = (ip) => {
  if (ip) pinAttempts.delete(ip);
};

const buildAuthSuccessPayload = async (session, userId) => {
  const profileRes = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  const { data: profile, error: profileError } = profileRes;
  if (profileError || !profile) {
    if (profileError?.message?.includes("fetch failed")) {
      throw fail("Network error while loading profile.", 503);
    }
    throw fail("Profile not found for this user.", 403);
  }

  if (profile.is_blocked) {
    throw fail("Contact OlitechHub admin for Assistance", 403);
  }

  if (!profile.is_active) {
    throw fail("Account inactive. Contact admin.", 403);
  }

  const { email, username } = await getAuthIdentityForUser(userId, profile);
  syncProfileUsername(userId, username);

  return {
    token: session.access_token,
    refresh_token: session.refresh_token,
    role: profile.role,
    user: sanitizeProfile({ ...profile, email, username }),
  };
};

const createSessionForUser = async (email) => {
  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError || !linkData?.properties?.hashed_token) {
    throw fail(linkError?.message || "Unable to start session.", 503);
  }

  // Ephemeral client: abandon it after verifyOtp. Never call signOut — that
  // deletes the session server-side and causes "Refresh Token Not Found".
  const auth = createAuthClient();
  const { data, error } = await auth.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "magiclink",
  });
  if (error || !data?.session) {
    throw fail(error?.message || "Unable to complete sign-in.", 401);
  }
  return data.session;
};

const resolveLoginEmail = async (identifier) => {
  const normalized = String(identifier || "").trim().toLowerCase();
  if (!normalized) throw fail("Username or email is required.", 400);
  if (normalized.includes("@")) return normalized;

  const profileId = await findProfileIdByIdentifier(normalized);
  if (profileId) {
    try {
      return await getAuthEmailForUser(profileId);
    } catch (_) {
      // Fall through to auth.users search below.
    }
  }

  const users = await listAllAuthUsers();
  const matchedUser = users.find((u) =>
    u.user_metadata?.username?.toLowerCase() === normalized ||
    u.email?.split("@")[0].toLowerCase() === normalized
  );
  if (matchedUser?.email) return matchedUser.email;

  throw fail("Invalid credentials", 401);
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const loginEmail = await resolveLoginEmail(email);

    const auth = createAuthClient();
    let result;
    try {
      result = await auth.auth.signInWithPassword({ email: loginEmail, password });
    } catch (err) {
      if (err.message?.includes("fetch failed") || err.code === "UND_ERR_CONNECT_TIMEOUT") {
        throw fail("Internet connection timeout. Please check your network and try again.", 503);
      }
      throw err;
    }

    const { data, error } = result;
    if (error) {
      if (error.message?.includes("fetch failed")) {
        throw fail("Network error: Unable to reach authentication server. Please check your internet.", 503);
      }
      throw fail(error.message || "Invalid credentials", 401);
    }
    if (!data.session) throw fail("Invalid credentials", 401);

    const payload = await buildAuthSuccessPayload(data.session, data.user.id);

    supabase.from("login_logs").insert({
      user_id: data.user.id,
      logged_in_at: new Date().toISOString(),
      ip_address: req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || null,
      user_agent: req.headers["user-agent"] || null,
    }).then(() => {}).catch(() => {});

    return ok(res, payload);
  } catch (e) { next(e); }
};

const loginPin = async (req, res, next) => {
  try {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || null;
    if (isPinRateLimited(ip)) {
      throw fail("Too many PIN attempts. Please wait and try again.", 429);
    }

    const pin = String(req.body.pin || "").trim();
    if (!isValidPinFormat(pin)) {
      recordPinAttempt(ip);
      throw fail("PIN must be 4 to 6 digits.", 400);
    }

    const pinLookup = computePinLookup(pin);
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("id, role, is_active, is_blocked, pin_hash")
      .eq("pin_lookup", pinLookup)
      .maybeSingle();

    if (error) throw fail(error.message, 500);

    if (!profile) {
      recordPinAttempt(ip);
      throw fail("Invalid PIN", 401);
    }

    if (!profile.pin_hash) {
      recordPinAttempt(ip);
      throw fail("PIN not configured for this account. Sign in with password and set a PIN in Account Settings.", 401);
    }

    if (!(await verifyPin(pin, profile.pin_hash))) {
      recordPinAttempt(ip);
      throw fail("Invalid PIN", 401);
    }

    if (!PIN_LOGIN_ROLES.has(profile.role)) {
      recordPinAttempt(ip);
      throw fail("PIN login is not available for this account.", 403);
    }

    if (profile.is_blocked) {
      throw fail("Contact OlitechHub admin for Assistance", 403);
    }

    if (!profile.is_active) {
      throw fail("Account inactive. Contact admin.", 403);
    }

    const email = await getAuthEmailForUser(profile.id);

    const session = await createSessionForUser(email);
    const payload = await buildAuthSuccessPayload(session, profile.id);

    clearPinAttempts(ip);

    supabase.from("login_logs").insert({
      user_id: profile.id,
      logged_in_at: new Date().toISOString(),
      ip_address: ip,
      user_agent: req.headers["user-agent"] || null,
    }).then(() => {}).catch(() => {});

    return ok(res, payload);
  } catch (e) { next(e); }
};

const logout = async (req, res, next) => {
  try {
    // Client already cleared local tokens. Avoid server signOut — it can revoke
    // unrelated in-memory sessions on a shared auth client.
    return ok(res, {}, "Logged out");
  } catch (e) {
    next(e);
  }
};

const refresh = async (req, res, next) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) throw fail("Refresh token required", 401);
    const auth = createAuthClient();
    const { data, error } = await auth.auth.refreshSession({ refresh_token });
    if (error || !data.session) throw fail(error?.message || "Refresh failed", 401);
    return ok(res, { token: data.session.access_token, refresh_token: data.session.refresh_token });
  } catch (e) { next(e); }
};

const me = async (req, res, next) => {
  try {
    const { data, error } = await supabase.from("profiles").select("*").eq("id", req.user.id).single();
    if (error) throw fail(error.message, 400);
    return ok(res, { ...sanitizeProfile(data), email: req.user.email, username: req.user.username || req.user.email });
  } catch (e) { next(e); }
};

const updateCredentials = async (req, res, next) => {
  try {
    const username = String(req.body.username || "").trim().toLowerCase();
    const currentPassword = String(req.body.current_password || "");
    const newPassword = String(req.body.new_password || "");

    if (!username && !newPassword) throw fail("Provide a new username and/or a new password.", 400);
    if (username && username.includes("@")) {
      throw fail("Username cannot be an email address. Use a short sign-in name.", 400);
    }

    await verifyCurrentPassword(req.user.email, currentPassword);

    const authUserRes = await supabase.auth.admin.getUserById(req.user.id);
    const existingMeta = authUserRes?.data?.user?.user_metadata || {};
    const currentUsername = String(existingMeta.username || "").trim().toLowerCase();

    const updatePayload = {};
    if (username && username !== currentUsername) {
      updatePayload.user_metadata = { ...existingMeta, username };
    }
    if (newPassword) updatePayload.password = newPassword;

    if (!updatePayload.user_metadata && !updatePayload.password) {
      return ok(
        res,
        { username: currentUsername || req.user.username || req.user.email },
        "No credential changes were needed."
      );
    }

    const { data, error } = await supabase.auth.admin.updateUserById(req.user.id, updatePayload);
    if (error) throw fail(error.message, 400);

    const nextUsername = data?.user?.user_metadata?.username || username || currentUsername || req.user.username;
    if (updatePayload.user_metadata?.username) {
      await supabase
        .from("profiles")
        .update({ username: nextUsername, updated_at: new Date().toISOString() })
        .eq("id", req.user.id);
    }

    return ok(
      res,
      { username: nextUsername || req.user.email },
      newPassword ? "Credentials updated" : "Username updated"
    );
  } catch (e) { next(e); }
};

const setOwnPin = async (req, res, next) => {
  try {
    const pin = String(req.body.pin || "").trim();
    const currentPassword = String(req.body.current_password || "");

    if (!isValidPinFormat(pin)) throw fail("PIN must be 4 to 6 digits.", 400);

    await verifyCurrentPassword(req.user.email, currentPassword);

    const { hashPin } = require("../../utils/pin");
    const { pin_hash, pin_lookup } = await hashPin(pin);

    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("pin_lookup", pin_lookup)
      .neq("id", req.user.id)
      .maybeSingle();

    if (existing) throw fail("This PIN is already in use. Choose a different PIN.", 409);

    const { data, error } = await supabase
      .from("profiles")
      .update({ pin_hash, pin_lookup, updated_at: new Date().toISOString() })
      .eq("id", req.user.id)
      .select("id, full_name, role, pin_hash, pin_lookup")
      .single();

    if (error) {
      if (error.code === "23505") throw fail("This PIN is already in use. Choose a different PIN.", 409);
      throw fail(error.message, 400);
    }

    if (!data?.pin_hash || !data?.pin_lookup) {
      throw fail("PIN could not be saved. Ensure pin_hash and pin_lookup columns exist in profiles.", 500);
    }

    const identity = await getAuthIdentityForUser(req.user.id, data);
    syncProfileUsername(req.user.id, identity.username);

    return ok(res, { user: { id: data.id, full_name: data.full_name, role: data.role }, pin_set: true }, "PIN updated");
  } catch (e) { next(e); }
};

const clearOwnPin = async (req, res, next) => {
  try {
    const currentPassword = String(req.body.current_password || "");

    await verifyCurrentPassword(req.user.email, currentPassword);

    const { error } = await supabase
      .from("profiles")
      .update({ pin_hash: null, pin_lookup: null, updated_at: new Date().toISOString() })
      .eq("id", req.user.id);

    if (error) throw fail(error.message, 400);
    return ok(res, { pin_set: false }, "PIN removed");
  } catch (e) { next(e); }
};

module.exports = { login, loginPin, logout, refresh, me, updateCredentials, setOwnPin, clearOwnPin };
