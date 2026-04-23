const { supabase } = require("../../config/supabase");
const { ok, paginated, fail } = require("../../utils/http");
const { quantityFromInventoryEmbed } = require("../../utils/inventoryEmbed");

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
        q = q.or(`name.ilike.*${term}*,barcode.ilike.*${term}*`);
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
    const isWeighed = Boolean(productFields.is_weighed);
    const payload = {
      ...productFields,
      unit_of_measure: isWeighed ? (productFields.unit_of_measure || "kg") : (productFields.unit_of_measure || "piece"),
      low_stock_threshold: Number(req.body.low_stock_threshold ?? s.default_low_stock_threshold),
    };
    const { data, error } = await supabase.from("products").insert([payload]).select().single();
    if (error) throw fail(error.message.includes("barcode") ? "barcode must be unique across all products" : error.message);
    await supabase.from("inventory").insert([{ product_id: data.id, quantity_in_stock: Number(initial_stock || 0) }]);
    return ok(res, data);
  } catch (e) { next(e); }
};
const getOne = async (req, res, next) => { try { const { data, error } = await supabase.from("products").select("*, categories(name), inventory(quantity_in_stock)").eq("id", req.params.id).single(); if (error) throw fail(error.message, 404); return ok(res, data); } catch (e) { next(e); } };
const byBarcode = async (req, res, next) => { try { const { data, error } = await supabase.from("products").select("*, categories(name), inventory(quantity_in_stock)").eq("barcode", req.params.code).single(); if (error) throw fail("Product not found", 404); return ok(res, data); } catch (e) { next(e); } };
const update = async (req, res, next) => { try { const { data, error } = await supabase.from("products").update(req.body).eq("id", req.params.id).select().single(); if (error) throw fail(error.message); return ok(res, data); } catch (e) { next(e); } };
const updatePrice = async (req, res, next) => update(req, res, next);
const deactivate = async (req, res, next) => { req.body = { is_active: false }; return update(req, res, next); };
const lowStock = async (req, res, next) => { req.query.low_stock = "true"; return list(req, res, next); };

module.exports = { list, create, getOne, byBarcode, update, updatePrice, deactivate, lowStock };
