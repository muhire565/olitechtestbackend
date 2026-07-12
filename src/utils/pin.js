const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const PIN_LOOKUP_SECRET = (process.env.PIN_LOOKUP_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "pin-lookup-fallback").trim();
const BCRYPT_ROUNDS = 10;

const PIN_FORMAT = /^\d{4,6}$/;
const PIN_LOGIN_ROLES = new Set(["owner", "cashier", "developer"]);

const isValidPinFormat = (pin) => PIN_FORMAT.test(String(pin || "").trim());

const computePinLookup = (pin) =>
  crypto.createHash("sha256").update(`${PIN_LOOKUP_SECRET}:${String(pin).trim()}`).digest("hex");

const hashPin = async (pin) => {
  const normalized = String(pin).trim();
  return {
    pin_hash: await bcrypt.hash(normalized, BCRYPT_ROUNDS),
    pin_lookup: computePinLookup(normalized),
  };
};

const verifyPin = async (pin, pinHash) => {
  if (!pinHash) return false;
  return bcrypt.compare(String(pin).trim(), pinHash);
};

module.exports = {
  PIN_LOGIN_ROLES,
  isValidPinFormat,
  computePinLookup,
  hashPin,
  verifyPin,
};
