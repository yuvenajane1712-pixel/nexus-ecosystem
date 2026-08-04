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

    const productCostRaw = items.reduce((s, i) => {
      const lineTotal = (i.unit_price || 0) * (i.qty || 1);
      const lineRmb = (i.currency === "IDR") ? lineTotal / fx : lineTotal;
      return s + lineRmb;
    }, 0);
    const cbmTotal = items.reduce((s, i) => s + (i.cbm || 0), 0);
    const logisticsCost = cbmTotal * (order.logistics_rate_per_cbm || 0) + (order.logistics_supplier_to_cn || 0) + (order.logistics_id_to_buyer || 0);

    // markup_mode: 'markup' (hidden in product cost) | 'fee' (shown as its own line) | 'both'
    const mode = order.markup_mode || "fee";
    let productCost = productCostRaw;
    let markupAmount = 0;
    if (mode === "markup" || mode === "both") {
      productCost = productCostRaw * (1 + (order.markup_pct || 0) / 100);
      markupAmount = productCost - productCostRaw;
    }
    let serviceFee = 0;
    if (mode === "fee" || mode === "both") {
      serviceFee = productCost * ((order.fee_pct || 0) / 100);
    }

    const totalPayment = productCost + logisticsCost + serviceFee;
    const netProfit = markupAmount + serviceFee; // internal only — never shown on the invoice

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
    const suppliers = db.prepare("SELECT id, company_name, person_name FROM clients").all();
    products.forEach((p) => {
      p.variants = variants.filter((v) => v.product_id === p.id);
      const supplier = suppliers.find((s) => s.id === p.supplier_id);
      p.supplier_name = supplier ? (supplier.company_name || supplier.person_name) : null;
    });
    res.json(products);
  });

  router.post("/products-catalog", (req, res) => {
    const { name, description, quality, photo_data, specs_count, colors, supplier_id, cost_per_cbm_intl, markup_pct } = req.body;
    if (!name) return res.status(400).json({ error: "name required" });
    const info = db.prepare(`
      INSERT INTO track_a_products (name, description, quality, photo_data, specs_count, colors, supplier_id, cost_per_cbm_intl, markup_pct)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(name, description || "", quality || "", photo_data || null, specs_count || null, JSON.stringify(colors || []), supplier_id || null, cost_per_cbm_intl || null, markup_pct || 0);
    emit();
    res.json({ id: info.lastInsertRowid });
  });

  router.put("/products-catalog/:id", (req, res) => {
    const { name, description, quality, photo_data, specs_count, colors, supplier_id, cost_per_cbm_intl, markup_pct } = req.body;
    db.prepare(`
      UPDATE track_a_products SET name=?, description=?, quality=?, photo_data=?, specs_count=?, colors=?, supplier_id=?, cost_per_cbm_intl=?, markup_pct=? WHERE id=?
    `).run(name, description || "", quality || "", photo_data || null, specs_count || null, JSON.stringify(colors || []), supplier_id || null, cost_per_cbm_intl || null, markup_pct || 0, req.params.id);
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
    const { buyer_name, fee_pct, urgency, markup_mode, markup_pct, bank_account_id, team_member_id } = req.body;
    if (!buyer_name) return res.status(400).json({ error: "buyer_name required" });
    const fx = getFxRate();
    const existingCount = db.prepare("SELECT COUNT(*) c FROM orders").get().c;
    const invoiceNumber = `${existingCount + 1}A`;
    const info = db.prepare(`
      INSERT INTO orders (buyer_name, product_cost, fee_pct, logistics_cost, service_fee, total_payment, net_profit, fx_rate, urgency, status, pipeline_status, markup_mode, markup_pct, invoice_number, bank_account_id, team_member_id)
      VALUES (?,0,?,0,0,0,0,?,?, 'open', 'lagi_dicari', ?, ?, ?, ?, ?)
    `).run(buyer_name, fee_pct || 10, fx, urgency || 1, markup_mode || "fee", markup_pct || 0, invoiceNumber, bank_account_id || null, team_member_id || null);
    emit();
    res.json({ id: info.lastInsertRowid, invoice_number: invoiceNumber });
  });

  router.put("/orders/:id", (req, res) => {
    const { buyer_name, fee_pct, urgency, markup_mode, markup_pct, logistics_tracking_code, bank_account_id, team_member_id } = req.body;
    const fields = [], params = [];
    if (buyer_name !== undefined) { fields.push("buyer_name=?"); params.push(buyer_name); }
    if (fee_pct !== undefined) { fields.push("fee_pct=?"); params.push(fee_pct); }
    if (urgency !== undefined) { fields.push("urgency=?"); params.push(urgency); }
    if (markup_mode !== undefined) { fields.push("markup_mode=?"); params.push(markup_mode); }
    if (markup_pct !== undefined) { fields.push("markup_pct=?"); params.push(markup_pct); }
    if (logistics_tracking_code !== undefined) { fields.push("logistics_tracking_code=?"); params.push(logistics_tracking_code); }
    if (bank_account_id !== undefined) { fields.push("bank_account_id=?"); params.push(bank_account_id); }
    if (team_member_id !== undefined) { fields.push("team_member_id=?"); params.push(team_member_id); }
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

    // when the buyer actually pays, re-lock the FX rate to today's rate (payment-day pricing) and stamp payment date
    if (pipeline_status === "sudah_bayar" && order.pipeline_status !== "sudah_bayar") {
      db.prepare("UPDATE orders SET fx_rate=?, payment_date=date('now') WHERE id=?").run(getFxRate(), req.params.id);
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

  const TOUR_PIPELINE = [
    { key: "just_order", label: "Just Order" },
    { key: "already_book", label: "Already Book" },
    { key: "already_pay", label: "Already Pay" },
    { key: "already_ongoing", label: "Already Ongoing" },
    { key: "already_done", label: "Already Done" },
  ];
  router.get("/tours/pipeline-stages", (req, res) => res.json(TOUR_PIPELINE));

  // ---- itemized cost list: customer-facing (IDR) or our own cost (RMB) ----
  router.get("/tours/:id/cost-items", (req, res) => {
    res.json(db.prepare("SELECT * FROM tour_cost_items WHERE tour_id=? ORDER BY id").all(req.params.id));
  });
  router.post("/tours/:id/cost-items", (req, res) => {
    const { label, amount, is_ours } = req.body;
    if (!label) return res.status(400).json({ error: "label required" });
    const currency = is_ours ? "RMB" : "IDR";
    const info = db.prepare("INSERT INTO tour_cost_items (tour_id, label, amount, currency, is_ours) VALUES (?,?,?,?,?)")
      .run(req.params.id, label, Number(amount) || 0, currency, is_ours ? 1 : 0);
    recomputeTour(req.params.id);
    emit();
    res.json({ id: info.lastInsertRowid });
  });
  router.delete("/tours/:id/cost-items/:itemId", (req, res) => {
    const item = db.prepare("SELECT tour_id FROM tour_cost_items WHERE id=?").get(req.params.itemId);
    db.prepare("DELETE FROM tour_cost_items WHERE id=?").run(req.params.itemId);
    if (item) recomputeTour(item.tour_id);
    emit();
    res.json({ ok: true });
  });

  // recompute revenue/cost/margin for a tour based on its category and cost items
  function recomputeTour(tourId) {
    const t = db.prepare("SELECT * FROM tours WHERE id=?").get(tourId);
    if (!t) return null;
    const items = db.prepare("SELECT * FROM tour_cost_items WHERE tour_id=?").all(tourId);
    const customerItemsTotal = items.filter((i) => !i.is_ours).reduce((s, i) => s + i.amount, 0); // IDR
    const ourItemsTotalRmb = items.filter((i) => i.is_ours).reduce((s, i) => s + i.amount, 0); // RMB
    const fx = getFxRate(); // IDR per RMB
    const totalPax = (t.pax_adults || 0) + (t.pax_children || 0) + (t.pax_infants || 0) + (t.pax_elderly || 0);

    let revenue = 0;
    let bookingFee = 0;

    if (t.tour_category === "only_booking") {
      // list all the bookings they want (customer cost items), our fee = 5% of that total — this IS the revenue, no separate fee added
      revenue = customerItemsTotal * 0.05;
      bookingFee = revenue;
    } else if (t.tour_category === "custom_itinerary") {
      // days × 89,000 IDR — this IS the fee, nothing added on top
      revenue = (t.days || 0) * 89000;
    } else if (t.tour_category === "bigbus") {
      // total people × tier price per pax
      const paxCount = totalPax > 0 ? totalPax : (t.pax_or_days || 0);
      revenue = paxCount * (t.price_per_unit_cache || 0);
    } else if (t.tour_category === "private") {
      // price per day, doubled for every full group of 4 people beyond the first 4
      const paxCount = totalPax > 0 ? totalPax : 1;
      const multiplier = Math.ceil(paxCount / 4);
      revenue = (t.price_per_unit_cache || 0) * (t.days || t.pax_or_days || 1) * multiplier;
    }

    const ourCostIdr = ourItemsTotalRmb * fx;
    const legacyCost = t.cost || 0; // manual fallback if no itemized "our cost" entries exist
    const totalCost = ourItemsTotalRmb > 0 ? ourCostIdr : legacyCost;
    const margin = revenue - totalCost;

    db.prepare("UPDATE tours SET revenue=?, cost=?, margin=?, booking_fee=?, pax_or_days=? WHERE id=?")
      .run(revenue, totalCost, margin, bookingFee, totalPax || t.pax_or_days || 0, tourId);
    return { revenue, cost: totalCost, margin, bookingFee };
  }

  router.post("/tours", (req, res) => {
    const {
      tour_category, tier_name, pax_or_days, price_per_unit, cost, status,
      client_name, date_from, date_to, days, destinations, pax_adults, pax_children, pax_infants, pax_elderly,
      food_wanted, food_avoid, bank_account_id, team_member_id, invoice_lang,
    } = req.body;

    const category = tour_category || "bigbus";
    const PREFIX = { only_booking: "Booking", custom_itinerary: "Itinerary", bigbus: "BBT", private: "PT" };
    const existingInCategory = db.prepare("SELECT COUNT(*) c FROM tours WHERE tour_category=?").get(category).c;
    const invoiceNumber = `${PREFIX[category] || "Tour"}${existingInCategory + 1}`;

    const info = db.prepare(`
      INSERT INTO tours (
        tour_type, tier_name, pax_or_days, revenue, cost, margin, booking_fee, status,
        client_name, travel_date, pax_adults, pax_children, pax_infants, pax_elderly,
        tour_category, date_from, date_to, days, destinations, invoice_number,
        food_wanted, food_avoid, tour_status, bank_account_id, team_member_id, invoice_lang, price_per_unit_cache
      ) VALUES (?,?,?,0,0,0,0,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'just_order',?,?,?,?)
    `).run(
      category, tier_name || "", pax_or_days || 0, status || "open",
      client_name || "", date_from || "", pax_adults || 0, pax_children || 0, pax_infants || 0, pax_elderly || 0,
      category, date_from || "", date_to || "", days || 0, destinations || "", invoiceNumber,
      food_wanted || "", food_avoid || "", bank_account_id || null, team_member_id || null, invoice_lang || "en", Number(price_per_unit) || 0
    );

    const totals = recomputeTour(info.lastInsertRowid);
    emit();

    if ((status || "open") === "completed") {
      db.prepare("UPDATE tours SET payment_date=date('now') WHERE id=?").run(info.lastInsertRowid);
      const fx = getFxRate(); // IDR per RMB
      const marginRmb = totals.margin / fx;
      db.prepare("INSERT INTO transactions (kind, category, amount_rmb, source, note) VALUES (?,?,?,?,?)")
        .run("income", "Guangzhou Mate Tour Revenue", marginRmb, "business", `Tour #${invoiceNumber} - ${totals.margin.toLocaleString()} IDR @ ${fx}`);
      emitBudget();
    }

    res.json({ id: info.lastInsertRowid, revenue: totals.revenue, margin: totals.margin, booking_fee: totals.bookingFee, invoice_number: invoiceNumber });
  });

  // ---- tour status pipeline (drives the auto-generated feedback questionnaire on "already_done") ----
  router.put("/tours/:id/status", (req, res) => {
    const { tour_status } = req.body;
    const tour = db.prepare("SELECT * FROM tours WHERE id=?").get(req.params.id);
    if (!tour) return res.status(404).json({ error: "not found" });
    const wasDone = tour.tour_status === "already_done";

    if (tour_status === "already_pay" && tour.tour_status !== "already_pay") {
      db.prepare("UPDATE tours SET payment_date=date('now') WHERE id=?").run(req.params.id);
    }
    db.prepare("UPDATE tours SET tour_status=? WHERE id=?").run(tour_status, req.params.id);

    if (tour_status === "already_done" && !wasDone) {
      db.prepare("UPDATE tours SET status='completed' WHERE id=?").run(req.params.id);
      const fx = getFxRate();
      db.prepare("INSERT INTO transactions (kind, category, amount_rmb, source, note) VALUES (?,?,?,?,?)")
        .run("income", "Guangzhou Mate Tour Revenue", tour.margin / fx, "business", `Tour #${tour.invoice_number || tour.id} - ${tour.margin.toLocaleString()} IDR @ ${fx}`);
      emitBudget();
    }
    emit();
    res.json({ ok: true });
  });

  // auto-generated post-trip feedback questionnaire (fixed, well-designed template — not a live AI call)
  router.get("/tours/:id/feedback-form", (req, res) => {
    const tour = db.prepare("SELECT * FROM tours WHERE id=?").get(req.params.id);
    if (!tour) return res.status(404).json({ error: "not found" });
    const questions = [
      "Overall, how would you rate your trip experience? (1-5 stars)",
      "Which part of the trip did you enjoy the most?",
      "Was the itinerary paced well, or did it feel too rushed / too slow?",
      "How was the food selection — anything you'd want more or less of next time?",
      "How was the transportation and driver/guide service?",
      "Was communication with our team clear and timely throughout?",
      "Would you recommend Guangzhou Mate to a friend or colleague?",
      "Any suggestions for how we could improve future trips?",
    ];
    res.json({ tour_id: tour.id, invoice_number: tour.invoice_number, client_name: tour.client_name, questions });
  });

  router.post("/tours/:id/feedback", (req, res) => {
    const { answers } = req.body;
    db.prepare("UPDATE tours SET feedback_json=? WHERE id=?").run(JSON.stringify(answers || {}), req.params.id);
    emit();
    res.json({ ok: true });
  });

  router.put("/tours/:id/complete", (req, res) => {
    const tour = db.prepare("SELECT * FROM tours WHERE id=?").get(req.params.id);
    if (!tour) return res.status(404).json({ error: "not found" });
    db.prepare("UPDATE tours SET status='completed', payment_date=date('now') WHERE id=?").run(req.params.id);
    if (tour.status !== "completed") {
      const fx = getFxRate();
      const marginRmb = tour.margin / fx;
      db.prepare("INSERT INTO transactions (kind, category, amount_rmb, source, note) VALUES (?,?,?,?,?)")
        .run("income", "Guangzhou Mate Tour Revenue", marginRmb, "business", `Tour #${tour.invoice_number || tour.id} - ${tour.margin.toLocaleString()} IDR @ ${fx}`);
      emitBudget();
    }
    emit();
    res.json({ ok: true });
  });

  return router;
};
