const express = require("express");
const db = require("../db");

module.exports = function (io) {
  const router = express.Router();
  const emit = () => io.emit("data:change", { module: "trackb" });
  const emitBudget = () => io.emit("data:change", { module: "budget" });

  router.get("/catalog", (req, res) => {
    const { category } = req.query;
    let sql = "SELECT * FROM catalog_products WHERE 1=1";
    const params = [];
    if (category) { sql += " AND category=?"; params.push(category); }
    sql += " ORDER BY category, name";
    res.json(db.prepare(sql).all(...params));
  });

  router.post("/catalog", (req, res) => {
    const { category, name, grade, ready_stock, fob_price, cif_price, futures_price, certificate_docs } = req.body;
    const info = db.prepare(`
      INSERT INTO catalog_products (category, name, grade, ready_stock, fob_price, cif_price, futures_price, certificate_docs)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(category, name, grade || "", ready_stock ? 1 : 0, fob_price || 0, cif_price || 0, futures_price || 0, certificate_docs || "");
    emit();
    res.json({ id: info.lastInsertRowid });
  });

  router.delete("/catalog/:id", (req, res) => {
    db.prepare("DELETE FROM catalog_products WHERE id=?").run(req.params.id);
    emit();
    res.json({ ok: true });
  });

  router.post("/catalog/seed-defaults", (req, res) => {
    const existing = db.prepare("SELECT COUNT(*) c FROM catalog_products").get().c;
    if (existing > 0) return res.json({ skipped: true, existing });
    const defaults = [
      ["Coffee", "Gayo Arabica"], ["Coffee", "Mandeling Arabica (Green)"], ["Coffee", "Mandeling Arabica (Roasted)"],
      ["Coffee", "Robusta Mandailing"], ["Spices", "White Pepper"], ["Spices", "Clove"],
      ["Bird's Nest", "Bird's Nest (Cleaned)"], ["Palm Oil", "Crude Palm Oil"], ["Cocoa Butter", "Cocoa Butter"],
      ["Seaweed", "Dried Seaweed"], ["Halal Food", "Halal Snacks Mix"], ["Coconut Products", "Coconut Sugar"],
      ["Essential Oils", "Clove Leaf Oil"], ["Tropical Fruits", "Dried Mango"], ["Tempeh", "Frozen Tempeh"],
    ];
    const stmt = db.prepare("INSERT INTO catalog_products (category, name) VALUES (?,?)");
    defaults.forEach(([c, n]) => stmt.run(c, n));
    emit();
    res.json({ seeded: defaults.length });
  });

  router.get("/orders", (req, res) => {
    res.json(db.prepare("SELECT * FROM track_b_orders ORDER BY created_at DESC").all());
  });

  router.post("/orders", (req, res) => {
    const {
      buyer_name, product_summary, profit_model, fee_rate,
      cost_price, selling_price, freight, insurance, vat, misc_fees, payment_method, status
    } = req.body;

    const cost = Number(cost_price) || 0;
    const sell = Number(selling_price) || 0;
    const fr = Number(freight) || 0;
    const ins = Number(insurance) || 0;
    const v = Number(vat) || 0;
    const misc = Number(misc_fees) || 0;

    let profit = 0, marginPct = 0;
    if (profit_model === "broker") {
      profit = sell * ((Number(fee_rate) || 0) / 100);
    } else {
      profit = sell - cost;
      marginPct = sell > 0 ? (profit / sell) * 100 : 0;
    }

    const info = db.prepare(`
      INSERT INTO track_b_orders (buyer_name, product_summary, profit_model, fee_rate, cost_price, selling_price, freight, insurance, vat, misc_fees, profit, margin_pct, payment_method, status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(buyer_name, product_summary || "", profit_model, fee_rate || 0, cost, sell, fr, ins, v, misc, profit, marginPct, payment_method || "", status || "open");

    emit();

    if ((status || "open") === "completed") {
      db.prepare("INSERT INTO transactions (kind, category, amount_rmb, source, note) VALUES (?,?,?,?,?)")
        .run("income", "Nadylan Trade Profit", profit, "business", `Track B Order #${info.lastInsertRowid} (${buyer_name})`);
      emitBudget();
    }

    res.json({ id: info.lastInsertRowid, profit, margin_pct: marginPct });
  });

  router.put("/orders/:id/complete", (req, res) => {
    const order = db.prepare("SELECT * FROM track_b_orders WHERE id=?").get(req.params.id);
    if (!order) return res.status(404).json({ error: "not found" });
    db.prepare("UPDATE track_b_orders SET status='completed' WHERE id=?").run(req.params.id);
    if (order.status !== "completed") {
      db.prepare("INSERT INTO transactions (kind, category, amount_rmb, source, note) VALUES (?,?,?,?,?)")
        .run("income", "Nadylan Trade Profit", order.profit, "business", `Track B Order #${order.id} (${order.buyer_name})`);
      emitBudget();
    }
    emit();
    res.json({ ok: true });
  });

  return router;
};
