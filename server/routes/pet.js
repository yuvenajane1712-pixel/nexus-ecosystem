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
    const { pet_name, log_type, title, value, cost_rmb, weight_kg, stool_type, urination_count, heart_rate, food_grams } = req.body;
    const info = db.prepare(`
      INSERT INTO pet_logs (pet_name, log_type, title, value, cost_rmb, weight_kg, stool_type, urination_count, heart_rate, food_grams)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(pet_name, log_type, title || "", value || "", cost_rmb || null, weight_kg || null, stool_type || null, urination_count || null, heart_rate || null, food_grams || null);

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

  // rule-based auto-analysis: flags concerning stool_type values or keyword matches in recent health logs
  router.get("/insight/:pet", (req, res) => {
    const pet = req.params.pet;
    const CONCERN_STOOL = ["loose", "watery", "hard", "straining", "blood", "diarrhea"];
    const CONCERN_WORDS = ["diarrhea", "blood", "vomit", "lethargic", "not eating", "loose", "watery", "hard", "straining"];

    const recentHealth = db.prepare(`
      SELECT * FROM pet_logs WHERE pet_name=? AND log_type='health' AND created_at >= date('now','-7 days')
      ORDER BY created_at DESC
    `).all(pet);

    const flagged = recentHealth.filter((l) =>
      (l.stool_type && CONCERN_STOOL.includes(l.stool_type.toLowerCase())) ||
      CONCERN_WORDS.some((w) => (l.value || "").toLowerCase().includes(w) || (l.title || "").toLowerCase().includes(w))
    );

    const status = flagged.length > 0 ? "needs attention" : (recentHealth.length > 0 ? "healthy" : "no data");
    res.json({
      pet, status,
      flagged_entries: flagged,
      total_logs_7day: recentHealth.length,
      note: flagged.length > 0
        ? "Recent log(s) mention symptoms worth watching — consider a vet check if it persists beyond 48 hours."
        : "No concerning entries found in recent logs.",
    });
  });

  router.get("/weight-chart/:pet", (req, res) => {
    const logs = db.prepare(`
      SELECT date(created_at) d, weight_kg FROM pet_logs
      WHERE pet_name=? AND log_type='health' AND weight_kg IS NOT NULL
      ORDER BY created_at ASC
    `).all(req.params.pet);
    res.json({ pet: req.params.pet, points: logs.map((l) => ({ date: l.d, weight: l.weight_kg })) });
  });

  // ---- Feeding checklist (per pet, per day, AM/PM) ----
  router.get("/checklist/:pet", (req, res) => {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const rows = db.prepare("SELECT * FROM pet_feeding_checklist WHERE pet_name=? AND log_date=?").all(req.params.pet, date);
    const result = { AM: false, PM: false };
    rows.forEach((r) => { result[r.meal] = !!r.fed; });
    res.json(result);
  });

  router.put("/checklist/:pet", (req, res) => {
    const { meal, fed, date } = req.body;
    const logDate = date || new Date().toISOString().slice(0, 10);
    db.prepare(`
      INSERT INTO pet_feeding_checklist (pet_name, log_date, meal, fed) VALUES (?,?,?,?)
      ON CONFLICT(pet_name, log_date, meal) DO UPDATE SET fed=excluded.fed
    `).run(req.params.pet, logDate, meal, fed ? 1 : 0);
    emit();
    res.json({ ok: true });
  });

  return router;
};
