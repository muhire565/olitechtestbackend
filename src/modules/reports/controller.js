const PDFDocument = require("pdfkit");
const { supabase } = require("../../config/supabase");
const { ok, fail } = require("../../utils/http");
const { quantityFromInventoryEmbed } = require("../../utils/inventoryEmbed");
const { inStoreDayRange: inRange } = require("../../utils/storeDayRange");
const { attributePayments } = require("../../utils/paymentUtils");

const formatMoney = (v) => new Intl.NumberFormat("en-RW", { style: "currency", currency: "RWF" }).format(v || 0);

/**
 * Revenue + receipt count for completed sales in a store-day range.
 * Uses `sales` as source of truth so totals remain correct even if a historical
 * row has missing embedded line items.
 */
const aggregateCompletedSalesInRange = async (from, to) => {
  let q = supabase
    .from("sales")
    .select("id,total_amount,status,created_at")
    .eq("status", "completed")
    .limit(100000);
  if (from && to) q = inRange(q, from, to);
  const { data, error } = await q;
  if (error) throw fail(error.message);
  const rows = data || [];
  const revenue = Math.round(rows.reduce((a, s) => a + Number(s.total_amount || 0), 0));
  return { revenue, transactions: rows.length };
};

const drawTable = (doc, title, headers, rows, startY) => {
    doc.fontSize(12).font("Helvetica-Bold").text(title, 50, startY);
    let y = startY + 20;
    
    // Draw Headers
    doc.fontSize(8).font("Helvetica-Bold");
    headers.forEach((h, i) => doc.text(h.label, h.x, y));
    
    y += 15;
    doc.moveTo(50, y).lineTo(550, y).stroke("#E2E8F0");
    y += 10;
    
    // Draw Rows
    doc.font("Helvetica").fontSize(8);
    rows.forEach(row => {
        headers.forEach(h => {
            const val = typeof h.key === 'function' ? h.key(row) : row[h.key];
            doc.text(String(val), h.x, y, { width: h.w || 100 });
        });
        y += 15;
        if (y > 700) { doc.addPage(); y = 50; }
    });
    
    return y + 20;
};

const exportFullReportPdf = async (req, res, date) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => res.type("application/pdf").send(Buffer.concat(chunks)));

    // Gather All Data (sale summary via sale_items → sales so it matches profit / product reports)
    const [saleAgg, qProducts, qPayments, qProfit, qStock] = await Promise.all([
        aggregateCompletedSalesInRange(date, date),
        inRange(supabase.from("sale_items").select("product_id, quantity, line_total, products(name), sales!inner(status)").eq("sales.status", "completed"), date, date, "sales.created_at"),
        inRange(supabase.from("payments").select("method,amount,sales!inner(status)").eq("sales.status", "completed"), date, date, "sales.created_at"),
        inRange(supabase.from("sale_items").select("quantity,line_total,products(buying_price),sales!inner(status)").eq("sales.status", "completed"), date, date, "sales.created_at"),
        supabase.from("products").select("name,low_stock_threshold,inventory(quantity_in_stock)")
    ]);

    const revenue = saleAgg.revenue;
    const cost = Math.round((qProfit.data || []).reduce((a, i) => a + Number(i.quantity) * Number(i.products?.buying_price || 0), 0));
    const profit = revenue - cost;

    const productsMap = {};
    (qProducts.data || []).forEach((x) => {
        const k = x.product_id;
        productsMap[k] = productsMap[k] || { name: x.products.name, qty: 0, total: 0 };
        productsMap[k].qty += Number(x.quantity);
        productsMap[k].total += Number(x.line_total);
    });
    const topProducts = Object.values(productsMap).sort((a,b) => b.total - a.total).slice(0, 10);

    const lowStock = (qStock.data || []).filter(p => quantityFromInventoryEmbed(p.inventory) <= p.low_stock_threshold).map(p => ({
        name: p.name,
        qty: quantityFromInventoryEmbed(p.inventory),
        threshold: p.low_stock_threshold
    }));

    // Start PDF Design
    doc.rect(0, 0, 612, 100).fill("#111827");
    doc.fillColor("#00E676").fontSize(24).font("Helvetica-Bold").text("SUPERMARKET MANAGEMENT", 50, 40);
    doc.fillColor("#94A3B8").fontSize(10).font("Helvetica").text(`DAILY PERFORMANCE REPORT • ${date}`, 50, 70);

    let y = 130;
    
    // Summary Cards
    doc.fillColor("#111827").fontSize(10).font("Helvetica-Bold").text("EXECUTIVE SUMMARY", 50, y);
    y += 20;
    
    const drawCard = (label, value, x, y) => {
        doc.rect(x, y, 110, 50).stroke("#E2E8F0");
        doc.fontSize(8).fillColor("#64748B").text(label, x + 10, y + 10);
        doc.fontSize(10).fillColor("#111827").font("Helvetica-Bold").text(value, x + 10, y + 25);
    };

    drawCard("TOTAL REVENUE", formatMoney(revenue), 50, y);
    drawCard("TRANSACTIONS", String(saleAgg.transactions), 170, y);
    drawCard("EST. PROFIT", formatMoney(profit), 290, y);
    drawCard("PROFIT MARGIN", revenue > 0 ? `${Math.round((profit/revenue)*100)}%` : "0%", 410, y);

    y += 80;

    // Tables
    y = drawTable(doc, "TOP SELLING PRODUCTS", [
        { label: "PRODUCT NAME", key: "name", x: 50, w: 250 },
        { label: "QTY SOLD", key: "qty", x: 300, w: 80 },
        { label: "REVENUE", key: (r) => formatMoney(r.total), x: 400, w: 150 }
    ], topProducts, y);

    y = drawTable(doc, "LOW STOCK ALERTS", [
        { label: "PRODUCT NAME", key: "name", x: 50, w: 300 },
        { label: "CURRENT STOCK", key: "qty", x: 350, w: 100 },
        { label: "THRESHOLD", key: "threshold", x: 450, w: 100 }
    ], lowStock, y);

    // Footer
    doc.fontSize(8).fillColor("#94A3B8").text(`Generated on ${new Date().toLocaleString()}`, 50, 750, { align: "center", width: 500 });

    doc.end();
};

const exportProductSalesReportPdf = async (req, res, results, { from, to, paymentMethod }) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => res.type("application/pdf").send(Buffer.concat(chunks)));

    const title = paymentMethod ? `PRODUCT SALES - ${paymentMethod}` : "PRODUCT SALES";
    const dateRange = from === to ? from : `${from} to ${to}`;

    doc.rect(0, 0, 612, 80).fill("#111827");
    doc.fillColor("#00E676").fontSize(18).font("Helvetica-Bold").text(title, 50, 30);
    doc.fillColor("#94A3B8").fontSize(9).font("Helvetica").text(`REPORT PERIOD: ${dateRange}`, 50, 55);

    let y = 110;
    
    y = drawTable(doc, "SALES BREAKDOWN BY PRODUCT", [
        { label: "PRODUCT NAME", key: "product_name", x: 50, w: 280 },
        { label: "QTY SOLD", key: (r) => Number(r.qty || 0).toLocaleString(), x: 330, w: 80 },
        { label: "TOTAL REVENUE", key: (r) => formatMoney(r.total), x: 410, w: 150 }
    ], results, y);

    doc.fontSize(8).fillColor("#94A3B8").text(`Generated on ${new Date().toLocaleString()}`, 50, 750, { align: "center", width: 500 });
    doc.end();
};

const dailySales = async (req, res, next) => {
    try {
        const from = req.query.from;
        const to = req.query.to;
        const date = req.query.date;
        if (req.query.export === "pdf") {
            const pdfDate = date || from;
            return exportFullReportPdf(req, res, pdfDate);
        }

        const rangeFrom = from && to ? from : date || null;
        const rangeTo = from && to ? to : date || null;

        let revenue = 0;
        let transactions = 0;

        if (rangeFrom && rangeTo) {
            const agg = await aggregateCompletedSalesInRange(rangeFrom, rangeTo);
            revenue = agg.revenue;
            transactions = agg.transactions;
        } else {
            const { data, error } = await supabase
                .from("sales")
                .select("total_amount,status")
                .eq("status", "completed")
                .limit(100000);
            if (error) throw fail(error.message);
            const rows = data || [];
            revenue = rows.reduce((a, s) => a + Number(s.total_amount), 0);
            transactions = rows.length;
        }

        const out = {
            from: rangeFrom,
            to: rangeTo,
            date: date || rangeFrom,
            transactions,
            revenue,
            total_sales: revenue,
        };
        return ok(res, out);
    } catch (e) {
        next(e);
    }
};

const productSales = async (req, res, next) => {
  try {
    const paymentMethod = String(req.query.payment_method || "").trim().toUpperCase();
    let allowedSaleIds = null;
    if (paymentMethod) {
      let paymentsQuery = supabase
        .from("payments")
        .select("sale_id, sales!inner(status, created_at)")
        .eq("sales.status", "completed")
        .eq("method", paymentMethod);
      if (req.query.from && req.query.to) {
        paymentsQuery = inRange(paymentsQuery, req.query.from, req.query.to, "sales.created_at");
      }
      const { data: paymentRows, error: paymentError } = await paymentsQuery;
      if (paymentError) throw fail(paymentError.message);
      allowedSaleIds = [...new Set((paymentRows || []).map((row) => row.sale_id).filter(Boolean))];
      if (!allowedSaleIds.length) return ok(res, []);
    }

    let q = supabase
      .from("sale_items")
      .select("sale_id, product_id, quantity, line_total, products(name), sales!inner(created_at,status)")
      .eq("sales.status", "completed");
    if (req.query.from && req.query.to) q = inRange(q, req.query.from, req.query.to, "sales.created_at");
    if (allowedSaleIds) q = q.in("sale_id", allowedSaleIds);

    const { data, error } = await q;
    if (error) throw fail(error.message);
    const rows = data || [];

    // Fallback for legacy/orphaned sales with missing sale_items:
    // derive product quantity from stock movements and estimate line total.
    let scopedSalesQuery = supabase
      .from("sales")
      .select("id,total_amount,status,created_at")
      .eq("status", "completed");
    if (req.query.from && req.query.to) scopedSalesQuery = inRange(scopedSalesQuery, req.query.from, req.query.to);
    if (allowedSaleIds) scopedSalesQuery = scopedSalesQuery.in("id", allowedSaleIds);
    const { data: scopedSales, error: scopedSalesError } = await scopedSalesQuery;
    if (scopedSalesError) throw fail(scopedSalesError.message);

    const existingSaleIds = new Set(rows.map((r) => String(r.sale_id)));
    const scoped = scopedSales || [];
    const missingSaleIds = scoped.map((s) => String(s.id)).filter((id) => !existingSaleIds.has(id));
    let fallbackRows = [];
    if (missingSaleIds.length) {
      const { data: movementRows, error: movementError } = await supabase
        .from("stock_movements")
        .select("reference_id, product_id, quantity_change, products(name, selling_price)")
        .eq("movement_type", "sale")
        .in("reference_id", missingSaleIds);
      if (movementError) throw fail(movementError.message);


      const movementCountBySale = new Map();
      for (const mv of movementRows || []) {
        const sid = String(mv.reference_id || "");
        if (!sid) continue;
        movementCountBySale.set(sid, Number(movementCountBySale.get(sid) || 0) + 1);
      }

      fallbackRows = (movementRows || []).map((mv) => {
        const saleId = String(mv.reference_id || "");
        const qty = Math.abs(Number(mv.quantity_change || 0));
        const moveCount = Number(movementCountBySale.get(saleId) || 0);
        const saleTotal = Number(saleTotalById.get(saleId) || 0);
        const estimatedLineTotal =
          moveCount === 1
            ? saleTotal
            : Number((qty * Number(mv.products?.selling_price || 0)).toFixed(2));
        return {
          sale_id: saleId,
          product_id: Number(mv.product_id),
          quantity: qty,
          line_total: estimatedLineTotal,
          products: { name: mv.products?.name || "Unknown" },
        };
      });
    }

    // 1. Fetch all payments for these sales to calculate attribution factors for split/over-payments
    const { data: allPayments, error: paymentsErr } = await supabase
      .from("payments")
      .select("sale_id, method, amount")
      .in("sale_id", [...new Set([...rows, ...fallbackRows].map(r => String(r.sale_id)))]);
    if (paymentsErr) throw fail(paymentsErr.message);

    const saleTotalById = new Map(scoped.map((s) => [String(s.id), Number(s.total_amount || 0)]));
    const paymentInfoBySale = {};
    (allPayments || []).forEach(p => {
      const sid = String(p.sale_id);
      paymentInfoBySale[sid] = paymentInfoBySale[sid] || { 
        saleTotal: saleTotalById.get(sid) || 0,
        rawPayments: []
      };
      paymentInfoBySale[sid].rawPayments.push(p);
    });

    const map = {};
    [...rows, ...fallbackRows].forEach((x) => {
      const k = x.product_id;
      const saleId = String(x.sale_id);
      
      // Calculate attribution factor: how much of this item was paid by the target method
      let factor = 1;
      if (paymentMethod && paymentInfoBySale[saleId]) {
        const info = paymentInfoBySale[saleId];
        // Use the new attribution logic to find the captured amount for the specific method
        const attributed = attributePayments(info.saleTotal, info.rawPayments);
        const methodCaptured = attributed
          .filter(p => p.method === paymentMethod)
          .reduce((a, p) => a + p.captured, 0);
          
        factor = info.saleTotal > 0 ? methodCaptured / info.saleTotal : 0;
      }

      map[k] = map[k] || { product_id: k, product_name: x.products?.name || "Unknown", qty: 0, total: 0 };
      map[k].qty += Number(x.quantity);
      map[k].total += Math.round(Number(x.line_total) * factor);
    });

    const out = Object.values(map).sort((a, b) => req.query.sort === "worst" ? a.total - b.total : b.total - a.total);

    if (req.query.export === "pdf") {
      return exportProductSalesReportPdf(req, res, out, { 
        from: req.query.from, 
        to: req.query.to, 
        paymentMethod 
      });
    }

    return ok(res, out);
  } catch (e) { next(e); }
};
const stockUnitCost = (p) => {
  // If we have a specific package buying price, we should derive the piece price from it
  if (p.is_package && Number(p.package_buying_price || 0) > 0 && Number(p.package_size || 0) > 0) {
    return Number(p.package_buying_price) / Number(p.package_size);
  }
  // Otherwise use the individual piece buying price
  return Number(p.buying_price || 0);
};

const stock = async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("products")
      .select(
        "id, name, buying_price, is_package, package_size, package_buying_price, low_stock_threshold, inventory(quantity_in_stock)"
      );
    if (error) throw fail(error.message);
    const rows = Array.isArray(data) ? data : [];

    let totalStockValue = 0;
    const products = rows.map((p) => {
      const qty = quantityFromInventoryEmbed(p.inventory);
      const unitCost = stockUnitCost(p);
      const value = Math.round(qty * unitCost);
      totalStockValue += value;

      return {
        product_id: p.id,
        product_name: p.name,
        quantity_in_stock: qty,
        buying_price: p.buying_price,
        value,
        low_stock: qty <= Number(p.low_stock_threshold),
      };
    });

    return ok(res, { total_value: totalStockValue, products });
  } catch (e) {
    next(e);
  }
};
const cashierPerformance = async (req, res, next) => {
  try {
    let qSales = supabase.from("sales").select("cashier_id, total_amount, status, profiles(full_name)").eq("status", "completed");
    let qEod = supabase.from("eod_sessions").select("cashier_id, expected_cash, counted_cash, discrepancy");

    if (req.query.from && req.query.to) {
      qSales = inRange(qSales, req.query.from, req.query.to);
      qEod = qEod.gte("date", req.query.from).lte("date", req.query.to);
    }

    const [salesRes, eodRes] = await Promise.all([qSales, qEod]);
    
    if (salesRes.error) throw fail(salesRes.error.message);
    if (eodRes.error) throw fail(eodRes.error.message);

    const performance = {};

    // Process Sales
    salesRes.data.forEach(s => {
      const id = s.cashier_id;
      performance[id] = performance[id] || { 
        cashier_id: id, 
        cashier_name: s.profiles?.full_name || "Unknown", 
        transactions: 0, 
        total_sales: 0,
        total_shortage: 0,
        total_excess: 0
      };
      performance[id].transactions += 1;
      performance[id].total_sales += Number(s.total_amount);
    });

    // Process EOD Accuracy
    eodRes.data.forEach(e => {
      const id = e.cashier_id;
      if (performance[id]) {
        const disc = Number(e.discrepancy || 0);
        if (disc < 0) performance[id].total_shortage += Math.abs(disc);
        if (disc > 0) performance[id].total_excess += disc;
      }
    });

    return ok(res, Object.values(performance));
  } catch (e) { next(e); }
};
const profitLoss = async (req, res, next) => {
  try {
    let q = supabase
      .from("sale_items")
      .select("quantity,line_total,products(buying_price),sales!inner(created_at,status)")
      .eq("sales.status", "completed");
    if (req.query.from && req.query.to) q = inRange(q, req.query.from, req.query.to, "sales.created_at");
    const { data, error } = await q;
    if (error) throw fail(error.message);
    const rows = data || [];
    const revenue = rows.reduce((a, i) => a + Number(i.line_total), 0);
    const cost = Math.round(rows.reduce((a, i) => a + Number(i.quantity) * Number(i.products?.buying_price || 0), 0));
    const out = { revenue, cost_of_goods: cost, profit: revenue - cost };
    return ok(res, out);
  } catch (e) {
    next(e);
  }
};
const paymentMethods = async (req, res, next) => {
  try {
    let q = supabase.from("payments").select("method, amount, sale_id, sales!inner(total_amount, status, created_at)").eq("sales.status", "completed");
    if (req.query.from && req.query.to) q = inRange(q, req.query.from, req.query.to, "sales.created_at");
    
    const { data, error } = await q;
    if (error) throw fail(error.message);

    const paymentsBySale = {};
    (data || []).forEach((p) => {
      const sid = p.sale_id;
      if (!paymentsBySale[sid]) {
        paymentsBySale[sid] = { total_amount: Number(p.sales?.total_amount || 0), rows: [] };
      }
      paymentsBySale[sid].rows.push(p);
    });

    const out = { CASH: 0, MOMO_CODE: 0, PHONE_NUMBER: 0, POS: 0 };
    Object.values(paymentsBySale).forEach((sale) => {
      const attributed = attributePayments(sale.total_amount, sale.rows);
      attributed.forEach((p) => {
        out[p.method] = (out[p.method] || 0) + p.captured;
      });
    });

    return ok(res, out);
  } catch (e) { next(e); }
};

const expensesSummary = async (req, res, next) => {
  try {
    const from = req.query.from;
    const to = req.query.to;
    let q = supabase.from("expenses").select("id, amount, expense_date, category, description");
    if (from && to) q = q.gte("expense_date", from).lte("expense_date", to);
    const { data, error } = await q;
    if (error) throw fail(error.message);
    const rows = data || [];
    const total = rows.reduce((acc, x) => acc + Number(x.amount || 0), 0);
    const byCategory = rows.reduce((acc, x) => {
      const key = x.category || "Other";
      acc[key] = Number(acc[key] || 0) + Number(x.amount || 0);
      return acc;
    }, {});
    return ok(res, { total, count: rows.length, by_category: byCategory, items: rows });
  } catch (e) {
    next(e);
  }
};

const dashboardSummary = async (req, res, next) => {
  try {
    const date = req.query.date;
    const from = req.query.from || date;
    const to = req.query.to || date;
    const [salesAgg, payRowsRes, profitRowsRes, expenseRowsRes, stockRowsRes] = await Promise.all([
      from && to ? aggregateCompletedSalesInRange(from, to) : aggregateCompletedSalesInRange(null, null),
      (() => {
        let q = supabase.from("payments").select("method, amount, sale_id, sales!inner(total_amount, status, created_at)").eq("sales.status", "completed");
        if (from && to) q = inRange(q, from, to, "sales.created_at");
        return q;
      })(),
      (() => {
        let q = supabase
          .from("sale_items")
          .select("quantity,line_total,products(buying_price),sales!inner(created_at,status)")
          .eq("sales.status", "completed");
        if (from && to) q = inRange(q, from, to, "sales.created_at");
        return q;
      })(),
      (() => {
        let q = supabase.from("expenses").select("id, amount, expense_date, category");
        if (from && to) q = q.gte("expense_date", from).lte("expense_date", to);
        return q;
      })(),
      supabase
        .from("products")
        .select("id, name, buying_price, is_package, package_size, package_buying_price, low_stock_threshold, is_active, inventory(quantity_in_stock)"),
    ]);

    if (payRowsRes.error) throw fail(payRowsRes.error.message);
    if (profitRowsRes.error) throw fail(profitRowsRes.error.message);
    if (expenseRowsRes.error) throw fail(expenseRowsRes.error.message);
    if (stockRowsRes.error) throw fail(stockRowsRes.error.message);

    const paymentsBySale = {};
    (payRowsRes.data || []).forEach((p) => {
      const sid = p.sale_id;
      if (!paymentsBySale[sid]) {
        paymentsBySale[sid] = {
          total_amount: Number(p.sales?.total_amount || 0),
          rows: [],
        };
      }
      paymentsBySale[sid].rows.push(p);
    });

    const paymentData = { CASH: 0, MOMO_CODE: 0, PHONE_NUMBER: 0, POS: 0 };
    Object.values(paymentsBySale).forEach((sale) => {
      const attributed = attributePayments(sale.total_amount, sale.rows);
      attributed.forEach((p) => {
        paymentData[p.method] = (paymentData[p.method] || 0) + p.captured;
      });
    });

    const profitRows = profitRowsRes.data || [];
    const revenue = Math.round(profitRows.reduce((a, i) => a + Number(i.line_total), 0));
    const cost = Math.round(profitRows.reduce((a, i) => a + Number(i.quantity) * Number(i.products?.buying_price || 0), 0));
    const profitData = { revenue, cost_of_goods: cost, profit: revenue - cost };
    const expenseRows = expenseRowsRes.data || [];
    const expenseData = {
      total: expenseRows.reduce((acc, x) => acc + Number(x.amount || 0), 0),
      count: expenseRows.length,
    };
    const stockRows = stockRowsRes.data || [];
    const totalStockValue = Math.round(stockRows.reduce((acc, p) => {
      const qty = quantityFromInventoryEmbed(p.inventory);
      const unitCost = stockUnitCost(p);
      return acc + qty * unitCost;
    }, 0));
    const { data: s } = await supabase.from("settings").select("default_low_stock_threshold").eq("id", 1).single();
    const defaultThreshold = Number(s?.default_low_stock_threshold ?? 10);
    
    const lowCount = stockRows.filter((p) => {
      if (p.is_active === false) return false;
      const qty = quantityFromInventoryEmbed(p.inventory);
      const thr = p.low_stock_threshold === null || p.low_stock_threshold === undefined
        ? defaultThreshold
        : Number(p.low_stock_threshold);
      return qty <= thr;
    }).length;

    return ok(res, {
      date: date || from,
      daily: {
        transactions: Number(salesAgg.transactions || 0),
        revenue: Number(salesAgg.revenue || 0),
      },
      payments: paymentData,
      profit: profitData,
      expenses: expenseData,
      stock: { total_value: Number(totalStockValue || 0) },
      low_stock_count: lowCount,
      default_low_stock_threshold: defaultThreshold,
    });
  } catch (e) {
    next(e);
  }
};

module.exports = {
  dailySales,
  productSales,
  stock,
  cashierPerformance,
  profitLoss,
  paymentMethods,
  expensesSummary,
  dashboardSummary,
};
