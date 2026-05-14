const { supabase } = require("../../config/supabase");
const { ok, paginated, fail } = require("../../utils/http");
const { quantityFromInventoryEmbed } = require("../../utils/inventoryEmbed");
const { broadcastRealtime } = require("../../realtime");

const normalizePackageFields = (payload) => {
  const out = { ...(payload || {}) };
  const isPackage = Boolean(out.is_package);
  if (!isPackage) {
    out.package_size = null;
    out.package_selling_price = null;
    return out;
  }
  out.package_size = Number(out.package_size);
  out.package_selling_price = Number(out.package_selling_price);
  return out;
};

const list = async (req, res, next) => {
  try {
    const page = Number(req.query.page || 1), limit = Number(req.query.limit || 20), from = (page - 1) * limit;
    let q = supabase.from("products").select("*, categories(name), inventory(quantity_in_stock)", { count: "exact" });
    if (req.query.category) q = q.eq("category_id", req.query.category);
    if (req.query.supplier) q = q.eq("supplier_id", req.query.supplier);
    if (req.query.is_active) q = q.eq("is_active", req.query.is_active === "true");
    
    if (req.query.search) {
      const s = String(req.query.search).trim();
      if (s) {
        const term = s.replace(/[,%()]/g, " ");
        q = q.ilike("name", `%${term}%`);
      }
    }

    const { data, count, error } = await q.range(from, from + limit - 1);
    if (error) throw fail(error.message);
    const out =
      req.query.low_stock === "true"
        ? data.filter((p) => quantityFromInventoryEmbed(p.inventory) <= p.low_stock_threshold)
        : data;
    return paginated(res, out, page, limit, count);
  } catch (e) { next(e); }
};
const create = async (req, res, next) => {
  try {
    const { data: s } = await supabase.from("settings").select("default_low_stock_threshold").eq("id", 1).single();
    const { initial_stock = 0, ...productFields } = req.body;
    
    const payload = normalizePackageFields({
      ...productFields,
      unit_of_measure: "piece",
      is_weighed: false,
      low_stock_threshold: Number(req.body.low_stock_threshold ?? s.default_low_stock_threshold),
    });

    // Handle empty or missing barcodes by setting them to null to satisfy DB constraints
    if (!payload.barcode || String(payload.barcode).trim() === "") {
      payload.barcode = null;
    }

    const { data, error } = await supabase.from("products").insert([payload]).select().single();
    if (error) {
      const msg = String(error.message || "");
      if (msg.includes("products_barcode_key")) throw fail("A product with this internal ID already exists.");
      if (msg.includes("products_package_size_check")) throw fail("Package size must be greater than 1 for packaged products.");
      throw fail(msg);
    }
    await supabase.from("inventory").insert([{ product_id: data.id, quantity_in_stock: Number(initial_stock || 0) }]);
    broadcastRealtime({ type: "product:updated", product_id: data.id, event: "created" });
    broadcastRealtime({ type: "inventory:update", product_id: data.id });
    return ok(res, data);
  } catch (e) { next(e); }
};
const getOne = async (req, res, next) => { try { const { data, error } = await supabase.from("products").select("*, categories(name), inventory(quantity_in_stock)").eq("id", req.params.id).single(); if (error) throw fail(error.message, 404); return ok(res, data); } catch (e) { next(e); } };

const update = async (req, res, next) => {
  try {
    const payload = normalizePackageFields({ ...(req.body || {}) });
    // These fields are not columns on products and can break UPDATE queries.
    delete payload.initial_stock;
    delete payload.category_name;
    delete payload.inventory;

    const { data, error } = await supabase.from("products").update(payload).eq("id", req.params.id).select().single();
    if (error) {
      const msg = String(error.message || "");
      if (msg.includes("products_package_size_check")) {
        throw fail("Package size must be greater than 1 for packaged products.");
      }
      throw fail(msg);
    }
    if (!data) throw fail("Product not found", 404);
    broadcastRealtime({ type: "product:updated", product_id: data.id, event: "updated" });
    broadcastRealtime({ type: "inventory:update", product_id: data.id });
    return ok(res, data, "Product updated successfully");
  } catch (e) {
    next(e);
  }
};
const updatePrice = async (req, res, next) => update(req, res, next);
const deactivate = async (req, res, next) => { req.body = { is_active: false }; return update(req, res, next); };
const lowStock = async (req, res, next) => {
  try {
    const [settingsRes, productsRes] = await Promise.all([
      supabase.from("settings").select("default_low_stock_threshold").eq("id", 1).single(),
      supabase
        .from("products")
        .select("*, categories(name), inventory(quantity_in_stock)")
        .eq("is_active", true)
        .order("name", { ascending: true })
    ]);

    if (productsRes.error) throw fail(productsRes.error.message);
    
    const defaultThreshold = Number(settingsRes.data?.default_low_stock_threshold ?? 10);
    const data = productsRes.data || [];

    const out = data.filter((p) => {
      const qty = quantityFromInventoryEmbed(p.inventory);
      const threshold = p.low_stock_threshold === null || p.low_stock_threshold === undefined 
        ? defaultThreshold 
        : Number(p.low_stock_threshold);
      return qty <= threshold;
    });

    return ok(res, out);
  } catch (e) {
    next(e);
  }
};

module.exports = { list, create, getOne, update, updatePrice, deactivate, lowStock };

