const express = require("express");
const db = require("../db");

module.exports = function (io) {
  const router = express.Router();
  const emit = () => io.emit("data:change", { module: "health" });
  const emitBudget = () => io.emit("data:change", { module: "budget" });

  router.get("/logs", (req, res) => {
    const { user_name, log_type } = req.query;
    let sql = "SELECT * FROM health_logs WHERE 1=1";
    const params = [];
    if (user_name) { sql += " AND user_name=?"; params.push(user_name); }
    if (log_type) { sql += " AND log_type=?"; params.push(log_type); }
    sql += " ORDER BY created_at DESC LIMIT 200";
    res.json(db.prepare(sql).all(...params));
  });

  router.post("/logs", (req, res) => {
    const { user_name, log_type, title, value, calories, cost_rmb } = req.body;
    const info = db.prepare(`
      INSERT INTO health_logs (user_name, log_type, title, value, calories, cost_rmb)
      VALUES (?,?,?,?,?,?)
    `).run(user_name, log_type, title || "", value || "", calories || null, cost_rmb || null);

    emit();

    // grocery logs auto-post to Budget as an expense (no duplicate entry)
    if (log_type === "grocery" && cost_rmb) {
      db.prepare("INSERT INTO transactions (kind, category, amount_rmb, source, note) VALUES (?,?,?,?,?)")
        .run("expense", "Human Groceries", Number(cost_rmb), "health", `${user_name}: ${title}`);
      emitBudget();
    }

    res.json({ id: info.lastInsertRowid });
  });

  router.delete("/logs/:id", (req, res) => {
    db.prepare("DELETE FROM health_logs WHERE id=?").run(req.params.id);
    emit();
    res.json({ ok: true });
  });

  // today's calorie summary per user
  router.get("/summary/:user", (req, res) => {
    const rows = db.prepare(`
      SELECT COALESCE(SUM(calories),0) as total_calories
      FROM health_logs
      WHERE user_name=? AND log_type='diet' AND date(created_at)=date('now')
    `).get(req.params.user);
    const latestWeight = db.prepare(`
      SELECT value FROM health_logs WHERE user_name=? AND log_type='metric' AND title='weight'
      ORDER BY created_at DESC LIMIT 1
    `).get(req.params.user);
    res.json({ total_calories: rows.total_calories, latest_weight: latestWeight ? latestWeight.value : null });
  });

  return router;
};
