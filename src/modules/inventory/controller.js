const { supabase } = require("../../config/supabase");
const { ok, fail } = require("../../utils/http");
const { broadcastRealtime } = require("../../realtime");
const { quantityFromInventoryEmbed } = require("../../utils/inventoryEmbed");

const list = async (req, res, next) => {
  try {
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 20);
    const from = (page - 1) * limit;
    let query = supabase
      .from("products")
      .select("*, inventory(id, quantity_in_stock, last_updated)", { count: "exact" });

    if (req.query.search) {
      const s = String(req.query.search).trim();
      if (s) {
        const term = s.replace(/[,%()]/g, " ");
        query = query.or(`name.ilike.*${term}*,barcode.ilike.*${term}*`);
      }
    }

    const { data: products, count, error } = await query
      .order("name", { ascending: true })
      .range(from, from + limit - 1);

    if (error) {
      console.error("Inventory List Query Error:", error);
      throw fail(error.message);
    }

    // Map to inventory-style structure
    const data = (products || []).map(p => {
      const inv = Array.isArray(p.inventory) ? p.inventory[0] : p.inventory;
      return {
        id: inv?.id || `inv-${p.id}`,
        product_id: p.id,
        quantity_in_stock: quantityFromInventoryEmbed(p.inventory),
        last_updated: inv?.last_updated || p.updated_at || p.created_at,
        products: {
          name: p.name,
          barcode: p.barcode,
          low_stock_threshold: p.low_stock_threshold,
          is_package: p.is_package,
          package_size: p.package_size
        }
      };
    });

    // Summary calculation
    const { data: allRows, error: err2 } = await supabase
      .from("inventory")
      .select("quantity_in_stock, products!inner(low_stock_threshold)");

    if (err2) throw fail(err2.message);

    const { data: sett } = await supabase.from("settings").select("default_low_stock_threshold").eq("id", 1).single();
    const defaultThreshold = Number(sett?.default_low_stock_threshold ?? 10);

    let low_stock = 0;
    let out_of_stock = 0;
    for (const row of allRows || []) {
      const prod = row.products;
      const thrRaw = Array.isArray(prod) ? prod[0]?.low_stock_threshold : prod?.low_stock_threshold;
      const thr = thrRaw === null || thrRaw === undefined ? defaultThreshold : Number(thrRaw);
      const qNum = Number(row.quantity_in_stock || 0);
      if (qNum <= 0) out_of_stock += 1;
      else if (qNum <= thr) low_stock += 1;
    }

    return res.json({
      success: true,
      data,
      pagination: { page, limit, total: Number(count || 0) },
      summary: { low_stock, out_of_stock },
    });
  } catch (e) {
    next(e);
  }
};

const getOne = async (req, res, next) => {
  try {
    const { data, error } = await supabase.from("inventory").select("*, products(*)").eq("product_id", req.params.product_id).single();
    if (error) throw fail(error.message, 404);
    return ok(res, data);
  } catch (e) {
    next(e);
  }
};

const applyMovement = async ({ product_id, quantity_change, movement_type, reference_id, note, performed_by }) => {
  let result;
  try {
    result = await supabase.from("inventory").select("*").eq("product_id", product_id).single();
  } catch (err) {
    if (err.message?.includes("fetch failed") || err.code === "UND_ERR_CONNECT_TIMEOUT") {
      throw fail("Connection timeout during inventory update. Please check your internet and try again.", 503);
    }
    throw err;
  }

  const { data: inv, error: invErr } = result;
  if (invErr) throw fail(invErr.message);

  const nextQty = Number(inv.quantity_in_stock) + Number(quantity_change);
  if (nextQty < 0) throw fail("Insufficient stock");

  try {
    await supabase
      .from("inventory")
      .update({ quantity_in_stock: nextQty, last_updated: new Date().toISOString() })
      .eq("product_id", product_id);
    await supabase.from("stock_movements").insert([{ product_id, quantity_change, movement_type, reference_id, note, performed_by }]);
  } catch (err) {
    throw fail("Network error while recording stock movement. Please try again.", 503);
  }
};

const stockIn = async (req, res, next) => {
  try {
    await applyMovement({ ...req.body, quantity_change: Number(req.body.quantity), movement_type: "stock_in" });
    broadcastRealtime({ type: "inventory_updated", event: "stock_in", product_id: req.body.product_id });
    broadcastRealtime({ type: "dashboard_refresh" });
    return ok(res, {}, "Stock added");
  } catch (e) {
    next(e);
  }
};

const adjustment = async (req, res, next) => {
  try {
    await applyMovement({ ...req.body, movement_type: "adjustment" });
    broadcastRealtime({ type: "inventory_updated", event: "adjustment", product_id: req.body.product_id });
    broadcastRealtime({ type: "dashboard_refresh" });
    return ok(res, {}, "Stock adjusted");
  } catch (e) {
    next(e);
  }
};

const history = async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("stock_movements")
      .select("*")
      .eq("product_id", req.params.product_id)
      .order("created_at", { ascending: false });
    if (error) throw fail(error.message);
    return ok(res, data);
  } catch (e) {
    next(e);
  }
};

module.exports = { list, getOne, stockIn, adjustment, history, applyMovement };
