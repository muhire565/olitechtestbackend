const { format } = require("date-fns");

const buildReceipt = ({ sale, items, payments, settings, cashierName, changeDue = 0 }) => {
  const createdAt = new Date(sale.created_at);
  const safeSettings = settings || {};
  return {
    receipt_number: sale.receipt_number,
    store_name: safeSettings.store_name || "Supermarket",
    store_address: safeSettings.store_address || "Kimironko",
    store_phone: safeSettings.store_phone || "+250788763374",
    date: format(createdAt, "yyyy-MM-dd"),
    time: format(createdAt, "HH:mm:ss"),
    cashier_name: cashierName,
    items: items.map((item) => ({
      product_name: item.products?.name || item.product_name,
      sold_as: item.sold_as,
      quantity: item.quantity,
      unit_price: Number(item.unit_price),
      line_total: Number(item.line_total),
    })),
    subtotal: Number(sale.total_amount) + Number(sale.discount_amount || 0),
    discount_amount: Number(sale.discount_amount || 0),
    total: Number(sale.total_amount),
    payments: payments.map((p) => ({ method: p.method, amount: Number(p.amount) })),
    change_due: Number(changeDue),
    receipt_footer: safeSettings.receipt_footer || "Thank you for shopping with us.",
    currency: "RWF",
  };
};

module.exports = { buildReceipt };
