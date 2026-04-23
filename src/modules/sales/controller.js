const { supabase } = require("../../config/supabase");
const { ok, paginated, fail } = require("../../utils/http");
const { dayStartIso, dayEndIso } = require("../../utils/storeDayRange");
const { buildReceipt } = require("../../utils/receiptGenerator");
const { auditLogger } = require("../../utils/auditLogger");
const { broadcastRealtime } = require("../../realtime");
const { generateReceiptNumber, resolveItem, applyMovement, roundQty } = require("./service");

const createSale = async (req, res, next) => {
  try {
    const { cashier_id, print_receipt, items, payments, discount_amount = 0 } = req.body;
    const productIds = [...new Set(items.map((i) => Number(i.product_id)))];
    const [productsRes, inventoryRes] = await Promise.all([
      supabase.from("products").select("*").in("id", productIds),
      supabase.from("inventory").select("product_id, quantity_in_stock").in("product_id", productIds),
    ]);
    if (productsRes.error) throw fail(productsRes.error.message);
    if (inventoryRes.error) throw fail(inventoryRes.error.message);

    const productsById = new Map((productsRes.data || []).map((p) => [Number(p.id), p]));
    const inventoryByProductId = new Map((inventoryRes.data || []).map((inv) => [Number(inv.product_id), Number(inv.quantity_in_stock)]));

    let gross = 0;
    const computedItems = [];
    const requiredByProductId = new Map();

    for (const item of items) {
      const productId = Number(item.product_id);
      const product = productsById.get(productId);
      if (!product || !product.is_active) throw fail("Invalid or inactive product");
      if (Number(item.quantity) <= 0) throw fail("quantity in sale_items must be > 0");

      const resolved = resolveItem(product, item.sold_as, item.quantity);
      const line_total = Number((resolved.unit_price * Number(resolved.quantity)).toFixed(2));
      gross += line_total;

      const currentRequired = requiredByProductId.get(productId) || 0;
      requiredByProductId.set(productId, currentRequired + Number(resolved.stockDeduct));

      computedItems.push({ ...item, product, product_id: productId, ...resolved, quantity: roundQty(resolved.quantity), line_total });
    }

    for (const [productId, requiredQty] of requiredByProductId.entries()) {
      const product = productsById.get(productId);
      const availableQty = Number(inventoryByProductId.get(productId) || 0);
      if (availableQty < requiredQty) {
        throw fail(`Insufficient stock for "${product.name}" — available: ${availableQty}, required: ${requiredQty}`);
      }
    }

    const netTotal = gross - Number(discount_amount || 0);
    const paid = payments.reduce((a, p) => a + Number(p.amount), 0);
    if (paid < netTotal) throw fail("sum of payments must be >= (total - discount)");

    const receipt_number = await generateReceiptNumber();
    const { data: sale, error: sErr } = await supabase
      .from("sales")
      .insert([{
        receipt_number,
        cashier_id,
        total_amount: netTotal,
        discount_amount,
        status: "completed",
        print_receipt: !!print_receipt,
      }])
      .select()
      .single();
    if (sErr) throw fail(sErr.message);

    const saleItemsPayload = computedItems.map((item) => ({
      sale_id: sale.id,
      product_id: item.product_id,
      sold_as: item.sold_as,
      quantity: item.quantity,
      unit_price: item.unit_price,
      line_total: item.line_total,
    }));
    const paymentsPayload = payments.map((p) => ({ sale_id: sale.id, method: p.method, amount: p.amount }));
    const stockMovementsPayload = computedItems.map((item) => ({
      product_id: item.product_id,
      quantity_change: -Number(item.stockDeduct),
      movement_type: "sale",
      reference_id: sale.id,
      note: "POS sale",
      performed_by: cashier_id,
    }));

    const [saleItemsInsertRes, paymentsInsertRes, stockMovementsInsertRes] = await Promise.all([
      supabase.from("sale_items").insert(saleItemsPayload),
      supabase.from("payments").insert(paymentsPayload),
      supabase.from("stock_movements").insert(stockMovementsPayload),
    ]);
    if (saleItemsInsertRes.error) throw fail(saleItemsInsertRes.error.message);
    if (paymentsInsertRes.error) throw fail(paymentsInsertRes.error.message);
    if (stockMovementsInsertRes.error) throw fail(stockMovementsInsertRes.error.message);

    const inventoryUpdatePromises = [...requiredByProductId.entries()].map(([productId, requiredQty]) => {
      const nextQty = Number(inventoryByProductId.get(productId) || 0) - Number(requiredQty);
      return supabase
        .from("inventory")
        .update({ quantity_in_stock: nextQty, last_updated: new Date().toISOString() })
        .eq("product_id", productId);
    });
    const inventoryUpdates = await Promise.all(inventoryUpdatePromises);
    const inventoryUpdateError = inventoryUpdates.find((r) => r.error);
    if (inventoryUpdateError?.error) throw fail(inventoryUpdateError.error.message);

    await auditLogger({
      user_id:     req.user.id,
      action:      "CREATE_SALE",
      entity_type: "sales",
      entity_id:   sale.id,
      details:     { item_count: items.length, total: netTotal },
      ip_address:  req.ip,
    });

    const [fullItemsRes, fullPaymentsRes, settingsRes] = await Promise.all([
      supabase.from("sale_items").select("*, products(name)").eq("sale_id", sale.id),
      supabase.from("payments").select("*").eq("sale_id", sale.id),
      supabase.from("settings").select("*").eq("id", 1).single(),
    ]);
    const fullItems = fullItemsRes.data || [];
    const fullPayments = fullPaymentsRes.data || [];
    const settings = settingsRes.data;

    const cashPaid = fullPayments.filter((p) => p.method === "CASH").reduce((a, p) => a + Number(p.amount), 0);
    const change_due = Math.max(0, cashPaid - netTotal);
    let receipt = null;
    try {
      receipt = buildReceipt({
        sale,
        items: fullItems,
        payments: fullPayments,
        settings,
        cashierName: req.user.full_name,
        changeDue: change_due,
      });
    } catch (receiptErr) {
      // Sale is already committed; receipt formatting must not fail checkout.
      console.error("Receipt generation failed after sale create:", receiptErr?.message || receiptErr);
    }

    broadcastRealtime({
      type: "sales_updated",
      event: "sale_created",
      sale_id: sale.id,
      cashier_id,
      total_amount: netTotal,
    });

    return ok(res, { sale, items: fullItems, payments: fullPayments, receipt, change_due });
  } catch (e) { next(e); }
};

const list = async (req, res, next) => {
  try {
    const page = Number(req.query.page || 1), limit = Number(req.query.limit || 20), from = (page - 1) * limit;
    let q = supabase.from("sales").select("*, sale_items:sale_items(products:products(name))", { count: "exact" }).order("created_at", { ascending: false });
    if (req.query.status)  q = q.eq("status", req.query.status);
    if (req.user.role === "cashier") q = q.eq("cashier_id", req.user.id);
    else if (req.query.cashier) q = q.eq("cashier_id", req.query.cashier);
    if (req.query.date)    q = q.gte("created_at", dayStartIso(req.query.date)).lte("created_at", dayEndIso(req.query.date));
    let result;
    try {
      result = await q.range(from, from + limit - 1);
    } catch (err) {
      if (err.message?.includes('fetch failed') || err.code === 'UND_ERR_CONNECT_TIMEOUT') {
        throw fail("Connection timeout while fetching sales. Please check your internet and try again.", 503);
      }
      throw err;
    }

    const { data, count, error } = result;
    if (error) throw fail(error.message);
    return paginated(res, data, page, limit, count);
  } catch (e) { next(e); }
};

const getOne = async (req, res, next) => {
  try {
    const { data: sale }     = await supabase.from("sales").select("*").eq("id", req.params.id).single();
    if (!sale) throw fail("Sale not found", 404);
    if (req.user.role === "cashier" && sale.cashier_id !== req.user.id) {
      return res.status(403).json({ success: false, error: "Forbidden: you can only view your own sales", code: 403 });
    }
    const { data: items }    = await supabase.from("sale_items").select("*, products(name)").eq("sale_id", req.params.id);
    const { data: payments } = await supabase.from("payments").select("*").eq("sale_id", req.params.id);
    return ok(res, { sale, items, payments });
  } catch (e) { next(e); }
};

const receipt = async (req, res, next) => {
  try {
    const { data } = await supabase.from("sales").select("*").eq("id", req.params.id).single();
    if (!data) throw fail("Sale not found", 404);
    req.params.id = data.id;
    return getOne(req, res, next);
  } catch (e) { next(e); }
};

const voidSale = async (req, res, next) => {
  try {
    const { data: sale } = await supabase.from("sales").select("*").eq("id", req.params.id).single();
    if (!sale) throw fail("Sale not found", 404);
    if (sale.status !== "completed") throw fail("void can only be applied to status = 'completed'");

    const { data: items } = await supabase
      .from("sale_items")
      .select("*, products(package_size)")
      .eq("sale_id", sale.id);

    for (const item of items) {
      const stockRestore = item.sold_as === "package"
        ? Number(item.products.package_size) * Number(item.quantity)
        : Number(item.quantity);
      await applyMovement({
        product_id:      item.product_id,
        quantity_change: stockRestore,
        movement_type:   "void_return",
        reference_id:    sale.id,
        note:            req.body.void_reason,
        performed_by:    req.user.id,
      });
    }

    const { data: updated } = await supabase
      .from("sales")
      .update({ status: "voided", void_reason: req.body.void_reason, void_approved_by: req.user.id, updated_at: new Date().toISOString() })
      .eq("id", sale.id)
      .select()
      .single();

    await auditLogger({ user_id: req.user.id, action: "VOID_SALE", entity_type: "sales", entity_id: sale.id, details: { reason: req.body.void_reason }, ip_address: req.ip });
    broadcastRealtime({
      type: "sales_updated",
      event: "sale_voided",
      sale_id: sale.id,
      cashier_id: sale.cashier_id,
      total_amount: Number(sale.total_amount || 0),
    });
    return ok(res, updated);
  } catch (e) { next(e); }
};

module.exports = { createSale, list, getOne, receipt, voidSale };
