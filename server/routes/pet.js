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

  // rule-based auto-analysis: flags stool/urine entries containing concerning keywords
  router.get("/insight/:pet", (req, res) => {
    const pet = req.params.pet;
    const CONCERN_WORDS = ["diarrhea", "blood", "vomit", "lethargic", "not eating", "loose", "watery", "hard", "straining"];

    const recentHealth = db.prepare(`
      SELECT * FROM pet_logs WHERE pet_name=? AND log_type='health' AND created_at >= date('now','-7 days')
      ORDER BY created_at DESC
    `).all(pet);

    const flagged = recentHealth.filter((l) =>
      CONCERN_WORDS.some((w) => (l.value || "").toLowerCase().includes(w) || (l.title || "").toLowerCase().includes(w))
    );

    const status = flagged.length > 0 ? "needs attention" : (recentHealth.length > 0 ? "healthy" : "no data");
    res.json({
      pet, status,
      flagged_entries: flagged,
      total_logs_7day: recentHealth.length,
      note: flagged.length > 0
        ? "Recent log(s) mention symptoms worth watching — consider a vet check if it persists beyond 48 hours."
        : "No concerning keywords found in recent logs.",
    });
  });

  return router;
};
