const { supabase } = require("../config/supabase");

const auditLogger = async ({
  user_id,
  action,
  entity_type,
  entity_id,
  details = {}, 
  ip_address,
}) => {
  await supabase.from("audit_logs").insert([
    { user_id, action, entity_type, entity_id: String(entity_id || ""), details, ip_address },
  ]);
};

module.exports = { auditLogger };
