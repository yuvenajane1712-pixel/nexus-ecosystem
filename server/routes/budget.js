const express = require("express");
const db = require("../db");

function cfg(key, fallback) {
  const row = db.prepare("SELECT value FROM config WHERE key=?").get(key);
  return row ? parseFloat(row.value) : fallback;
}

module.exports = function (io) {
  const router = express.Router();
  const emit = () => io.emit("data:change", { module: "budget" });

  router.get("/transactions", (req, res) => {
    res.json(db.prepare("SELECT * FROM transactions ORDER BY created_at DESC LIMIT 300").all());
  });

  router.post("/transactions", (req, res) => {
    const { kind, category, amount_rmb, note } = req.body;
    const info = db.prepare("INSERT INTO transactions (kind, category, amount_rmb, source, note) VALUES (?,?,?,?,?)")
      .run(kind, category, Number(amount_rmb) || 0, "manual", note || "");
    emit();
    res.json({ id: info.lastInsertRowid });
  });

  router.delete("/transactions/:id", (req, res) => {
    db.prepare("DELETE FROM transactions WHERE id=?").run(req.params.id);
    emit();
    res.json({ ok: true });
  });

  // dashboard summary: monthly spend vs caps, savings goal progress, reserve runway
  router.get("/summary", (req, res) => {
    const monthCap = cfg("monthly_cap_rmb", 5000);
    const caps = {
      "Rent": cfg("rent_cap_rmb", 3000),
      "Human Groceries": cfg("grocery_cap_rmb", 1000) / 2,
      "Pet Supplies & Groceries": cfg("grocery_cap_rmb", 1000) / 2,
      "Utilities": cfg("utilities_cap_rmb", 80),
      "Transport": cfg("transport_cap_rmb", 200),
    };

    const monthRows = db.prepare(`
      SELECT category, kind, COALESCE(SUM(amount_rmb),0) as total
      FROM transactions
      WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
      GROUP BY category, kind
    `).all();

    let totalExpense = 0, totalIncome = 0;
    const byCategory = {};
    monthRows.forEach((r) => {
      if (r.kind === "expense") {
        totalExpense += r.total;
        byCategory[r.category] = (byCategory[r.category] || 0) + r.total;
      } else {
        totalIncome += r.total;
      }
    });

    const remainingByCategory = {};
    Object.keys(caps).forEach((cat) => {
      remainingByCategory[cat] = caps[cat] - (byCategory[cat] || 0);
    });

    // living reserve runway
    const reserve = cfg("living_reserve_rmb", 125000);
    const reserveDraws = db.prepare(`
      SELECT COALESCE(SUM(amount_rmb),0) as total FROM transactions
      WHERE kind='expense' AND category='Reserve Draw'
    `).get().total;
    const reserveBalance = reserve - reserveDraws;
    const last3moDraw = db.prepare(`
      SELECT COALESCE(SUM(amount_rmb),0) as total FROM transactions
      WHERE kind='expense' AND category='Reserve Draw' AND created_at >= date('now','-90 days')
    `).get().total;
    const monthlyBurn = last3moDraw / 3;
    const runwayMonths = monthlyBurn > 0 ? reserveBalance / monthlyBurn : null;

    // savings goal (short-term: revenue goal in IDR)
    const fx = cfg("fx_rate_idr_per_rmb", 2180);
    const goalIdr = cfg("revenue_goal_idr", 5000000000);
    const businessIncomeRmb = db.prepare(`
      SELECT COALESCE(SUM(amount_rmb),0) as total FROM transactions
      WHERE kind='income' AND source='business'
    `).get().total;
    const businessIncomeIdr = businessIncomeRmb * fx;
    const goalProgressPct = (businessIncomeIdr / goalIdr) * 100;

    res.json({
      monthCap,
      totalExpense,
      totalIncome,
      remainingMonthBudget: monthCap - totalExpense,
      caps,
      byCategory,
      remainingByCategory,
      reserveBalance,
      monthlyBurn,
      runwayMonths,
      businessIncomeIdr,
      goalIdr,
      goalProgressPct,
      overBudget: totalExpense > monthCap,
    });
  });

  // wishlist
  router.get("/wishlist", (req, res) => {
    res.json(db.prepare("SELECT * FROM wishlist ORDER BY priority DESC").all());
  });
  router.post("/wishlist", (req, res) => {
    const { item, price_rmb, priority } = req.body;
    const info = db.prepare("INSERT INTO wishlist (item, price_rmb, priority) VALUES (?,?,?)")
      .run(item, Number(price_rmb) || 0, Number(priority) || 0);
    emit();
    res.json({ id: info.lastInsertRowid });
  });
  router.put("/wishlist/:id/save", (req, res) => {
    const { amount } = req.body;
    db.prepare("UPDATE wishlist SET saved_rmb = saved_rmb + ? WHERE id=?").run(Number(amount) || 0, req.params.id);
    emit();
    res.json({ ok: true });
  });
  router.delete("/wishlist/:id", (req, res) => {
    db.prepare("DELETE FROM wishlist WHERE id=?").run(req.params.id);
    emit();
    res.json({ ok: true });
  });

  return router;
};
