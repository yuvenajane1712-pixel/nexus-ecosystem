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

  // ---- Orders (Nadylan) ----
  router.get("/orders", (req, res) => {
    res.json(db.prepare("SELECT * FROM orders ORDER BY created_at DESC").all());
  });

  router.post("/orders", (req, res) => {
    const { buyer_name, product_summary, product_cost, fee_pct, logistics_cost, urgency, status } = req.body;
    const pc = Number(product_cost) || 0;
    const feePct = Number(fee_pct) || 0;
    const logistics = Number(logistics_cost) || 0;
    const serviceFee = pc * (feePct / 100);
    const totalPayment = pc + logistics + serviceFee;
    const netProfit = serviceFee; // handling costs not tracked at MVP level
    const fx = getFxRate();

    const info = db.prepare(`
      INSERT INTO orders (buyer_name, product_summary, product_cost, fee_pct, logistics_cost, service_fee, total_payment, net_profit, fx_rate, urgency, status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(buyer_name, product_summary || "", pc, feePct, logistics, serviceFee, totalPayment, netProfit, fx, urgency || 1, status || "open");

    emit();

    if ((status || "open") === "completed") {
      db.prepare("INSERT INTO transactions (kind, category, amount_rmb, source, note) VALUES (?,?,?,?,?)")
        .run("income", "Nadylan Trade Profit", netProfit, "business", `Order #${info.lastInsertRowid} (${buyer_name})`);
      emitBudget();
    }

    res.json({ id: info.lastInsertRowid, service_fee: serviceFee, total_payment: totalPayment, net_profit: netProfit });
  });

  router.put("/orders/:id/complete", (req, res) => {
    const order = db.prepare("SELECT * FROM orders WHERE id=?").get(req.params.id);
    if (!order) return res.status(404).json({ error: "not found" });
    db.prepare("UPDATE orders SET status='completed' WHERE id=?").run(req.params.id);
    if (order.status !== "completed") {
      db.prepare("INSERT INTO transactions (kind, category, amount_rmb, source, note) VALUES (?,?,?,?,?)")
        .run("income", "Nadylan Trade Profit", order.net_profit, "business", `Order #${order.id} (${order.buyer_name})`);
      emitBudget();
    }
    emit();
    res.json({ ok: true });
  });

  // ---- Tours (Guangzhou Mate) ----
  router.get("/tours", (req, res) => {
    res.json(db.prepare("SELECT * FROM tours ORDER BY created_at DESC").all());
  });

  router.post("/tours", (req, res) => {
    const { tour_type, tier_name, pax_or_days, price_per_unit, cost, status } = req.body;
    const revenue = (Number(pax_or_days) || 0) * (Number(price_per_unit) || 0);
    const c = Number(cost) || 0;
    const margin = revenue - c;

    const info = db.prepare(`
      INSERT INTO tours (tour_type, tier_name, pax_or_days, revenue, cost, margin, status)
      VALUES (?,?,?,?,?,?,?)
    `).run(tour_type, tier_name, pax_or_days || 0, revenue, c, margin, status || "open");

    emit();

    if ((status || "open") === "completed") {
      const fx = getFxRate(); // IDR per RMB
      const marginRmb = margin / fx;
      db.prepare("INSERT INTO transactions (kind, category, amount_rmb, source, note) VALUES (?,?,?,?,?)")
        .run("income", "Guangzhou Mate Tour Revenue", marginRmb, "business", `Tour #${info.lastInsertRowid} (${tier_name}) - ${margin.toLocaleString()} IDR @ ${fx}`);
      emitBudget();
    }

    res.json({ id: info.lastInsertRowid, revenue, margin });
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
