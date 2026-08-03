const express = require("express");
const db = require("../db");

function getFxRate() {
  const row = db.prepare("SELECT value FROM config WHERE key='fx_rate_idr_per_rmb'").get();
  return row ? parseFloat(row.value) : 2180;
}

// auto-suggest a fee tier given order attributes
function suggestFeeTier({ orderValue, isFirstTime, isOemRebrand }) {
  if (orderValue > 50000) return { tier: "Bulk Buyer", pct: 12 };
  if (isOemRebrand && orderValue > 10000) return { tier: "Premium", pct: 15 };
  if (orderValue >= 10000 && orderValue <= 50000 && !isOemRebrand) return { tier: "Standard", pct: 10 };
  if (isFirstTime) return { tier: "Newbie", pct: 15 };
  return { tier: "Newbie (recurring)", pct: 8 };
}

module.exports = function (io) {
  const router = express.Router();
  const emit = () => io.emit("data:change", { module: "business" });
  const emitBudget = () => io.emit("data:change", { module: "budget" });

  // ---- Clients (CRM) ----
  router.get("/clients", (req, res) => {
    res.json(db.prepare("SELECT * FROM clients ORDER BY name ASC").all());
  });
  router.post("/clients", (req, res) => {
    const { kind, name, contact, tier } = req.body;
    const info = db.prepare("INSERT INTO clients (kind, name, contact, tier) VALUES (?,?,?,?)")
      .run(kind, name, contact || "", tier || "");
    emit();
    res.json({ id: info.lastInsertRowid });
  });

  // ---- Products ----
  router.get("/products", (req, res) => {
    res.json(db.prepare("SELECT * FROM products ORDER BY created_at DESC").all());
  });
  router.post("/products", (req, res) => {
    const { name, category, unit_price, cbm, notes } = req.body;
    const info = db.prepare("INSERT INTO products (name, category, unit_price, cbm, notes) VALUES (?,?,?,?,?)")
      .run(name, category || "", unit_price || 0, cbm || 0, notes || "");
    emit();
    res.json({ id: info.lastInsertRowid });
  });

  // ---- Fee tier suggestion ----
  router.post("/fee-suggest", (req, res) => {
    const { orderValue, isFirstTime, isOemRebrand } = req.body;
    res.json(suggestFeeTier({ orderValue: Number(orderValue) || 0, isFirstTime: !!isFirstTime, isOemRebrand: !!isOemRebrand }));
  });

  // 7-stage pipeline (Bahasa Indonesia labels as specified)
  const PIPELINE = [
    { key: "lagi_dicari", label: "Lagi Dicari" },
    { key: "sudah_ketemu", label: "Sudah Ketemu" },
    { key: "sudah_bayar", label: "Sudah Bayar" },
    { key: "sampai_cn_warehouse", label: "Sampai di China Warehouse" },
    { key: "sudah_dikirim", label: "Sudah Dikirim" },
    { key: "sampai_id_warehouse", label: "Sampai di Warehouse Indonesia" },
    { key: "sampai_tujuan", label: "Sampai Tempat Tujuan" },
  ];
  router.get("/pipeline-stages", (req, res) => res.json(PIPELINE));

  function recomputeOrder(orderId) {
    const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId);
    if (!order) return null;
    const items = db.prepare("SELECT * FROM order_items WHERE order_id=?").all(orderId);
    const fx = order.fx_rate || getFxRate(); // IDR per RMB

    const productCost = items.reduce((s, i) => {
      const lineTotal = (i.unit_price || 0) * (i.qty || 1);
      const lineRmb = (i.currency === "IDR") ? lineTotal / fx : lineTotal;
      return s + lineRmb;
    }, 0);
    const cbmTotal = items.reduce((s, i) => s + (i.cbm || 0), 0);
    const logisticsCost = cbmTotal * (order.logistics_rate_per_cbm || 0) + (order.logistics_supplier_to_cn || 0) + (order.logistics_id_to_buyer || 0);
    const serviceFee = productCost * ((order.fee_pct || 0) / 100);
    const totalPayment = productCost + logisticsCost + serviceFee;
    const netProfit = serviceFee;

    db.prepare(`
      UPDATE orders SET product_cost=?, cbm_total=?, logistics_cost=?, service_fee=?, total_payment=?, net_profit=?
      WHERE id=?
    `).run(productCost, cbmTotal, logisticsCost, serviceFee, totalPayment, netProfit, orderId);

    return { productCost, cbmTotal, logisticsCost, serviceFee, totalPayment, netProfit };
  }

  // ---- Track A Product Catalog (unlimited price variants per product) ----
  router.get("/products-catalog", (req, res) => {
    const products = db.prepare("SELECT * FROM track_a_products ORDER BY name").all();
    const variants = db.prepare("SELECT * FROM track_a_variants ORDER BY id").all();
    products.forEach((p) => { p.variants = variants.filter((v) => v.product_id === p.id); });
    res.json(products);
  });

  router.post("/products-catalog", (req, res) => {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: "name required" });
    const info = db.prepare("INSERT INTO track_a_products (name, description) VALUES (?,?)").run(name, description || "");
    emit();
    res.json({ id: info.lastInsertRowid });
  });

  router.put("/products-catalog/:id", (req, res) => {
    const { name, description } = req.body;
    db.prepare("UPDATE track_a_products SET name=?, description=? WHERE id=?").run(name, description || "", req.params.id);
    emit();
    res.json({ ok: true });
  });

  router.delete("/products-catalog/:id", (req, res) => {
    db.prepare("DELETE FROM track_a_variants WHERE product_id=?").run(req.params.id);
    db.prepare("DELETE FROM track_a_products WHERE id=?").run(req.params.id);
    emit();
    res.json({ ok: true });
  });

  router.post("/products-catalog/:id/variants", (req, res) => {
    const { spec_label, price, currency } = req.body;
    if (!spec_label || !price) return res.status(400).json({ error: "spec_label and price required" });
    const info = db.prepare("INSERT INTO track_a_variants (product_id, spec_label, price, currency) VALUES (?,?,?,?)")
      .run(req.params.id, spec_label, Number(price), currency === "IDR" ? "IDR" : "RMB");
    emit();
    res.json({ id: info.lastInsertRowid });
  });

  router.delete("/products-catalog/:id/variants/:variantId", (req, res) => {
    db.prepare("DELETE FROM track_a_variants WHERE id=?").run(req.params.variantId);
    emit();
    res.json({ ok: true });
  });

  // ---- Orders (Nadylan Track A) — with nested line items ----
  router.get("/orders", (req, res) => {
    const orders = db.prepare("SELECT * FROM orders ORDER BY created_at DESC").all();
    const items = db.prepare("SELECT * FROM order_items ORDER BY id ASC").all();
    orders.forEach((o) => { o.items = items.filter((i) => i.order_id === o.id); });
    res.json(orders);
  });

  router.get("/orders/:id", (req, res) => {
    const order = db.prepare("SELECT * FROM orders WHERE id=?").get(req.params.id);
    if (!order) return res.status(404).json({ error: "not found" });
    order.items = db.prepare("SELECT * FROM order_items WHERE order_id=? ORDER BY id ASC").all(order.id);
    res.json(order);
  });

  // create an order shell (buyer + fee); products added as line items afterward
  router.post("/orders", (req, res) => {
    const { buyer_name, fee_pct, urgency } = req.body;
    if (!buyer_name) return res.status(400).json({ error: "buyer_name required" });
    const fx = getFxRate();
    const info = db.prepare(`
      INSERT INTO orders (buyer_name, product_cost, fee_pct, logistics_cost, service_fee, total_payment, net_profit, fx_rate, urgency, status, pipeline_status)
      VALUES (?,0,?,0,0,0,0,?,?, 'open', 'lagi_dicari')
    `).run(buyer_name, fee_pct || 10, fx, urgency || 1);
    emit();
    res.json({ id: info.lastInsertRowid });
  });

  router.put("/orders/:id", (req, res) => {
    const { buyer_name, fee_pct, urgency } = req.body;
    const fields = [], params = [];
    if (buyer_name !== undefined) { fields.push("buyer_name=?"); params.push(buyer_name); }
    if (fee_pct !== undefined) { fields.push("fee_pct=?"); params.push(fee_pct); }
    if (urgency !== undefined) { fields.push("urgency=?"); params.push(urgency); }
    if (fields.length) {
      params.push(req.params.id);
      db.prepare(`UPDATE orders SET ${fields.join(", ")} WHERE id=?`).run(...params);
      recomputeOrder(req.params.id);
    }
    emit();
    res.json({ ok: true, ...recomputeOrder(req.params.id) });
  });

  router.delete("/orders/:id", (req, res) => {
    db.prepare("DELETE FROM order_items WHERE order_id=?").run(req.params.id);
    db.prepare("DELETE FROM orders WHERE id=?").run(req.params.id);
    emit();
    res.json({ ok: true });
  });

  // ---- line items ----
  router.post("/orders/:id/items", (req, res) => {
    const { name, spec, unit_price, qty, cbm, photo_data, currency, category, spec_json } = req.body;
    if (!name) return res.status(400).json({ error: "name required" });
    const info = db.prepare(`
      INSERT INTO order_items (order_id, name, spec, unit_price, qty, cbm, photo_data, currency, category, spec_json)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(req.params.id, name, spec || "", Number(unit_price) || 0, Number(qty) || 1, Number(cbm) || 0, photo_data || null, currency === "IDR" ? "IDR" : "RMB", category || "", spec_json || "{}");
    const totals = recomputeOrder(req.params.id);
    emit();
    res.json({ id: info.lastInsertRowid, ...totals });
  });

  router.put("/orders/:id/items/:itemId", (req, res) => {
    const { name, spec, unit_price, qty, cbm, photo_data, currency } = req.body;
    const fields = [], params = [];
    if (name !== undefined) { fields.push("name=?"); params.push(name); }
    if (spec !== undefined) { fields.push("spec=?"); params.push(spec); }
    if (unit_price !== undefined) { fields.push("unit_price=?"); params.push(Number(unit_price) || 0); }
    if (qty !== undefined) { fields.push("qty=?"); params.push(Number(qty) || 1); }
    if (cbm !== undefined) { fields.push("cbm=?"); params.push(Number(cbm) || 0); }
    if (photo_data !== undefined) { fields.push("photo_data=?"); params.push(photo_data); }
    if (currency !== undefined) { fields.push("currency=?"); params.push(currency === "IDR" ? "IDR" : "RMB"); }
    params.push(req.params.itemId);
    db.prepare(`UPDATE order_items SET ${fields.join(", ")} WHERE id=?`).run(...params);
    const totals = recomputeOrder(req.params.id);
    emit();
    res.json({ ok: true, ...totals });
  });

  router.delete("/orders/:id/items/:itemId", (req, res) => {
    db.prepare("DELETE FROM order_items WHERE id=?").run(req.params.itemId);
    const totals = recomputeOrder(req.params.id);
    emit();
    res.json({ ok: true, ...totals });
  });

  // ---- logistics (auto CBM x rate, plus manual supplier->CN and ID-warehouse->buyer legs) ----
  router.put("/orders/:id/logistics", (req, res) => {
    const { logistics_rate_per_cbm, logistics_supplier_to_cn, logistics_id_to_buyer } = req.body;
    db.prepare(`
      UPDATE orders SET logistics_rate_per_cbm=?, logistics_supplier_to_cn=?, logistics_id_to_buyer=? WHERE id=?
    `).run(Number(logistics_rate_per_cbm) || 0, Number(logistics_supplier_to_cn) || 0, Number(logistics_id_to_buyer) || 0, req.params.id);
    const totals = recomputeOrder(req.params.id);
    emit();
    res.json({ ok: true, ...totals });
  });

  // ---- status pipeline ----
  router.put("/orders/:id/status", (req, res) => {
    const { pipeline_status } = req.body;
    const order = db.prepare("SELECT * FROM orders WHERE id=?").get(req.params.id);
    if (!order) return res.status(404).json({ error: "not found" });
    const wasFinal = order.pipeline_status === "sampai_tujuan";

    // when the buyer actually pays, re-lock the FX rate to today's rate (payment-day pricing)
    if (pipeline_status === "sudah_bayar" && order.pipeline_status !== "sudah_bayar") {
      db.prepare("UPDATE orders SET fx_rate=? WHERE id=?").run(getFxRate(), req.params.id);
    }

    db.prepare("UPDATE orders SET pipeline_status=? WHERE id=?").run(pipeline_status, req.params.id);
    recomputeOrder(req.params.id);

    if (pipeline_status === "sampai_tujuan" && !wasFinal) {
      const updated = db.prepare("SELECT * FROM orders WHERE id=?").get(req.params.id);
      db.prepare("UPDATE orders SET status='completed' WHERE id=?").run(req.params.id);
      db.prepare("INSERT INTO transactions (kind, category, amount_rmb, source, note) VALUES (?,?,?,?,?)")
        .run("income", "Nadylan Trade Profit", updated.net_profit, "business", `Order #${order.id} (${order.buyer_name})`);
      emitBudget();
    }
    emit();
    res.json({ ok: true });
  });

  // ---- tracking code ----
  router.put("/orders/:id/tracking", (req, res) => {
    const { tracking_code } = req.body;
    db.prepare("UPDATE orders SET tracking_code=? WHERE id=?").run(tracking_code || "", req.params.id);
    emit();
    res.json({ ok: true });
  });

  // ---- Tours (Guangzhou Mate) ----
  router.get("/tours", (req, res) => {
    res.json(db.prepare("SELECT * FROM tours ORDER BY created_at DESC").all());
  });

  router.post("/tours", (req, res) => {
    const {
      tour_type, tier_name, pax_or_days, price_per_unit, cost, status,
      client_name, travel_date, pax_adults, pax_children, pax_infants, pax_elderly, amount_client_pays,
    } = req.body;
    // if an explicit amount the client pays is given, use that as revenue; otherwise fall back to pax/day × tier price
    const computedRevenue = (Number(pax_or_days) || 0) * (Number(price_per_unit) || 0);
    const revenue = amount_client_pays ? Number(amount_client_pays) : computedRevenue;
    const c = Number(cost) || 0;
    const bookingFee = revenue * 0.05;
    const margin = revenue - c;

    const info = db.prepare(`
      INSERT INTO tours (
        tour_type, tier_name, pax_or_days, revenue, cost, margin, booking_fee, status,
        client_name, travel_date, pax_adults, pax_children, pax_infants, pax_elderly, amount_client_pays
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      tour_type, tier_name, pax_or_days || 0, revenue, c, margin, bookingFee, status || "open",
      client_name || "", travel_date || "", pax_adults || 0, pax_children || 0, pax_infants || 0, pax_elderly || 0, Number(amount_client_pays) || 0
    );

    emit();

    if ((status || "open") === "completed") {
      const fx = getFxRate(); // IDR per RMB
      const marginRmb = margin / fx;
      db.prepare("INSERT INTO transactions (kind, category, amount_rmb, source, note) VALUES (?,?,?,?,?)")
        .run("income", "Guangzhou Mate Tour Revenue", marginRmb, "business", `Tour #${info.lastInsertRowid} (${tier_name}) - ${margin.toLocaleString()} IDR @ ${fx}`);
      emitBudget();
    }

    res.json({ id: info.lastInsertRowid, revenue, margin, booking_fee: bookingFee });
  });

  router.put("/tours/:id/complete", (req, res) => {
    const tour = db.prepare("SELECT * FROM tours WHERE id=?").get(req.params.id);
    if (!tour) return res.status(404).json({ error: "not found" });
    db.prepare("UPDATE tours SET status='completed' WHERE id=?").run(req.params.id);
    if (tour.status !== "completed") {
      const fx = getFxRate();
      const marginRmb = tour.margin / fx;
      db.prepare("INSERT INTO transactions (kind, category, amount_rmb, source, note) VALUES (?,?,?,?,?)")
        .run("income", "Guangzhou Mate Tour Revenue", marginRmb, "business", `Tour #${tour.id} (${tour.tier_name}) - ${tour.margin.toLocaleString()} IDR @ ${fx}`);
      emitBudget();
    }
    emit();
    res.json({ ok: true });
  });

  return router;
};
