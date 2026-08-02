const express = require("express");
const db = require("../db");

module.exports = function (io) {
  const router = express.Router();
  const emit = () => io.emit("data:change", { module: "pet" });
  const emitBudget = () => io.emit("data:change", { module: "budget" });

  router.get("/logs", (req, res) => {
    const { pet_name, log_type } = req.query;
    let sql = "SELECT * FROM pet_logs WHERE 1=1";
    const params = [];
    if (pet_name) { sql += " AND pet_name=?"; params.push(pet_name); }
    if (log_type) { sql += " AND log_type=?"; params.push(log_type); }
    sql += " ORDER BY created_at DESC LIMIT 200";
    res.json(db.prepare(sql).all(...params));
  });

  router.post("/logs", (req, res) => {
    const { pet_name, log_type, title, value, cost_rmb } = req.body;
    const info = db.prepare(`
      INSERT INTO pet_logs (pet_name, log_type, title, value, cost_rmb)
      VALUES (?,?,?,?,?)
    `).run(pet_name, log_type, title || "", value || "", cost_rmb || null);

    emit();

    if (log_type === "grocery" && cost_rmb) {
      db.prepare("INSERT INTO transactions (kind, category, amount_rmb, source, note) VALUES (?,?,?,?,?)")
        .run("expense", "Pet Supplies & Groceries", Number(cost_rmb), "pet", `${pet_name}: ${title}`);
      emitBudget();
    }

    res.json({ id: info.lastInsertRowid });
  });

  router.delete("/logs/:id", (req, res) => {
    db.prepare("DELETE FROM pet_logs WHERE id=?").run(req.params.id);
    emit();
    res.json({ ok: true });
  });

  return router;
};
