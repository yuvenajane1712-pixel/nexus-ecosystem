const express = require("express");
const db = require("../db");

function getFxRate() {
  const row = db.prepare("SELECT value FROM config WHERE key='fx_rate_idr_per_rmb'").get();
  return row ? parseFloat(row.value) : 2180;
}

const CERTIFICATE_GUIDE = {
  "Coffee": { certs: ["Certificate of Origin (Form E)", "Phytosanitary Certificate", "Fumigation Certificate (if wood pallet used)"], costNote: "Form E ~150,000–300,000 IDR via Ministry of Trade; Phytosanitary ~200,000–500,000 IDR via Ministry of Agriculture (Karantina); Fumigation ~1–3 RMB/CBM via licensed fumigation vendor." },
  "Spices": { certs: ["Phytosanitary Certificate", "Certificate of Origin (Form E)", "Health Certificate"], costNote: "Similar to coffee; Health Certificate (Sertifikat Kesehatan) via BPOM/local health office, ~300,000–600,000 IDR." },
  "Bird's Nest": { certs: ["CITES/Quarantine Certificate", "Health Certificate", "Certificate of Origin"], costNote: "Bird's nest requires additional quarantine clearance — budget 1,000,000–3,000,000 IDR and 1-2 weeks extra processing time." },
  "Palm Oil": { certs: ["SNI Certificate", "ISPO Certificate", "Certificate of Origin (Form E)"], costNote: "ISPO certification is the most involved — typically pre-arranged at the plantation/refinery level, not per-shipment." },
  "Cocoa Butter": { certs: ["Health Certificate", "Certificate of Origin (Form E)"], costNote: "Standard export documentation, ~500,000–1,000,000 IDR combined." },
  "Seaweed": { certs: ["Phytosanitary Certificate", "Certificate of Origin"], costNote: "~300,000–600,000 IDR combined." },
  "Halal Food": { certs: ["Halal Certificate (MUI/BPJPH)", "Health Certificate", "Certificate of Origin"], costNote: "Halal certification is the long-lead item — apply well ahead, can take 4-8 weeks and 1,000,000-5,000,000 IDR depending on product." },
  "Coconut Products": { certs: ["Certificate of Origin (Form E)", "Health Certificate"], costNote: "~300,000–600,000 IDR combined." },
  "Essential Oils": { certs: ["Certificate of Analysis (CoA)", "MSDS", "Certificate of Origin"], costNote: "CoA from an accredited lab ~500,000–1,500,000 IDR depending on analyte panel." },
  "Tropical Fruits": { certs: ["Phytosanitary Certificate", "Certificate of Origin"], costNote: "Fresh fruit needs cold-chain-compatible phytosanitary clearance timed close to shipment date." },
  "Tempeh": { certs: ["Health Certificate", "Halal Certificate (MUI)", "Certificate of Origin"], costNote: "Frozen/fresh product — confirm cold-chain export licensing with the freight forwarder." },
};

module.exports = function (io) {
  const router = express.Router();
  const emit = () => io.emit("data:change", { module: "trackb" });
  const emitBudget = () => io.emit("data:change", { module: "budget" });

  router.get("/certificates/:category", (req, res) => {
    const guide = CERTIFICATE_GUIDE[req.params.category];
    if (!guide) return res.json({ certs: ["Certificate of Origin (Form E)"], costNote: "General export documentation — confirm specifics with your freight forwarder." });
    res.json(guide);
  });

  router.get("/certificates", (req, res) => res.json(CERTIFICATE_GUIDE));

  router.get("/catalog", (req, res) => {
    const { category } = req.query;
    let sql = "SELECT * FROM catalog_products WHERE 1=1";
    const params = [];
    if (category) { sql += " AND category=?"; params.push(category); }
    sql += " ORDER BY category, name";
    res.json(db.prepare(sql).all(...params));
  });

  router.post("/catalog", (req, res) => {
    const {
      category, name, grade, ready_stock, fob_price, cif_price, futures_price, certificate_docs,
      process, altitude, defect_pct, moisture_pct, variety, moq_kg, packaging_kg_per_jute, price_idr_per_kg, price_rmb_per_kg,
    } = req.body;
    const info = db.prepare(`
      INSERT INTO catalog_products (category, name, grade, ready_stock, fob_price, cif_price, futures_price, certificate_docs,
        process, altitude, defect_pct, moisture_pct, variety, moq_kg, packaging_kg_per_jute, price_idr_per_kg, price_rmb_per_kg)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(category, name, grade || "", ready_stock ? 1 : 0, fob_price || 0, cif_price || 0, futures_price || 0, certificate_docs || "",
      process || "", altitude || "", defect_pct || null, moisture_pct || null, variety || "", moq_kg || null, packaging_kg_per_jute || null, price_idr_per_kg || null, price_rmb_per_kg || null);
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

  // 12-stage Track B pipeline (per spec)
  const TRACKB_PIPELINE = [
    { key: "confirmed_both", label: "Already Confirm Both Buyer & Supplier" },
    { key: "partial_paid", label: "Already Pay (Parts)" },
    { key: "packed", label: "Already Pack" },
    { key: "id_port", label: "Already In Indonesia Port" },
    { key: "cn_port", label: "Already In China Port" },
    { key: "arrived_buyer", label: "Already Arrived To China Buyer" },
    { key: "closing", label: "Closing" },
  ];
  router.get("/pipeline-stages", (req, res) => res.json(TRACKB_PIPELINE));

  // ---- unlimited cost line items per pricing model (FOB / CIF / Futures) ----
  router.get("/catalog/:id/cost-items", (req, res) => {
    res.json(db.prepare("SELECT * FROM track_b_cost_items WHERE catalog_product_id=? ORDER BY price_type, id").all(req.params.id));
  });

  router.post("/catalog/:id/cost-items", (req, res) => {
    const { price_type, label, amount, currency } = req.body;
    const info = db.prepare(`
      INSERT INTO track_b_cost_items (catalog_product_id, price_type, label, amount, currency) VALUES (?,?,?,?,?)
    `).run(req.params.id, price_type, label || "", Number(amount) || 0, currency === "RMB" ? "RMB" : "IDR");
    emit();
    res.json({ id: info.lastInsertRowid });
  });

  router.delete("/catalog/:id/cost-items/:itemId", (req, res) => {
    db.prepare("DELETE FROM track_b_cost_items WHERE id=?").run(req.params.itemId);
    emit();
    res.json({ ok: true });
  });

  router.get("/orders", (req, res) => {
    res.json(db.prepare("SELECT * FROM track_b_orders ORDER BY created_at DESC").all());
  });

  function recomputeTrackB(orderId) {
    const o = db.prepare("SELECT * FROM track_b_orders WHERE id=?").get(orderId);
    if (!o) return null;
    const fx = o.fx_rate || getFxRate();
    const toRmb = (val, currency) => (currency === "IDR" ? val / fx : val);

    const cost = toRmb(o.cost_price || 0, o.cost_currency);
    const sell = toRmb(o.selling_price || 0, o.selling_currency);
    const fr = toRmb(o.freight || 0, o.freight_currency);
    const ins = toRmb(o.insurance || 0, o.insurance_currency);
    const v = toRmb(o.vat || 0, o.vat_currency);
    const misc = toRmb(o.misc_fees || 0, o.misc_currency);

    const marginProfit = sell - cost - fr - ins - v - misc;
    const feeProfit = sell * ((o.fee_rate || 0) / 100);
    let profit = 0, marginPct = 0;
    if (o.profit_model === "fee") profit = feeProfit;
    else if (o.profit_model === "both") { profit = marginProfit + feeProfit; marginPct = sell > 0 ? (marginProfit / sell) * 100 : 0; }
    else { profit = marginProfit; marginPct = sell > 0 ? (marginProfit / sell) * 100 : 0; }

    db.prepare("UPDATE track_b_orders SET profit=?, margin_pct=? WHERE id=?").run(profit, marginPct, orderId);
    return { profit, marginPct };
  }

  router.post("/orders", (req, res) => {
    const {
      buyer_name, catalog_product_id, profit_model, fee_rate,
      cost_price, cost_currency, selling_price, selling_currency,
      freight, freight_currency, insurance, insurance_currency,
      vat, vat_currency, misc_fees, misc_currency, payment_method, status
    } = req.body;

    let product_summary = "";
    if (catalog_product_id) {
      const p = db.prepare("SELECT * FROM catalog_products WHERE id=?").get(catalog_product_id);
      if (p) product_summary = `${p.name} (${p.category})`;
    }

    const info = db.prepare(`
      INSERT INTO track_b_orders (
        buyer_name, product_summary, catalog_product_id, profit_model, fee_rate,
        cost_price, cost_currency, selling_price, selling_currency,
        freight, freight_currency, insurance, insurance_currency,
        vat, vat_currency, misc_fees, misc_currency,
        payment_method, status, pipeline_status, fx_rate
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'confirmed_both',?)
    `).run(
      buyer_name, product_summary, catalog_product_id || null, profit_model, fee_rate || 0,
      cost_price || 0, cost_currency || "RMB", selling_price || 0, selling_currency || "RMB",
      freight || 0, freight_currency || "RMB", insurance || 0, insurance_currency || "RMB",
      vat || 0, vat_currency || "RMB", misc_fees || 0, misc_currency || "RMB",
      payment_method || "", status || "open", getFxRate()
    );

    const totals = recomputeTrackB(info.lastInsertRowid);
    emit();

    if ((status || "open") === "completed") {
      db.prepare("INSERT INTO transactions (kind, category, amount_rmb, source, note) VALUES (?,?,?,?,?)")
        .run("income", "Nadylan Trade Profit", totals.profit, "business", `Track B Order #${info.lastInsertRowid} (${buyer_name})`);
      emitBudget();
    }

    res.json({ id: info.lastInsertRowid, profit: totals.profit, margin_pct: totals.marginPct });
  });

  router.put("/orders/:id/status", (req, res) => {
    const { pipeline_status } = req.body;
    const order = db.prepare("SELECT * FROM track_b_orders WHERE id=?").get(req.params.id);
    if (!order) return res.status(404).json({ error: "not found" });
    const wasClosing = order.pipeline_status === "closing";
    db.prepare("UPDATE track_b_orders SET pipeline_status=? WHERE id=?").run(pipeline_status, req.params.id);
    const totals = recomputeTrackB(req.params.id);

    if (pipeline_status === "closing" && !wasClosing) {
      db.prepare("UPDATE track_b_orders SET status='completed' WHERE id=?").run(req.params.id);
      db.prepare("INSERT INTO transactions (kind, category, amount_rmb, source, note) VALUES (?,?,?,?,?)")
        .run("income", "Nadylan Trade Profit", totals.profit, "business", `Track B Order #${order.id} (${order.buyer_name})`);
      emitBudget();
    }
    emit();
    res.json({ ok: true });
  });

  router.delete("/orders/:id", (req, res) => {
    db.prepare("DELETE FROM track_b_orders WHERE id=?").run(req.params.id);
    emit();
    res.json({ ok: true });
  });

  return router;
};
