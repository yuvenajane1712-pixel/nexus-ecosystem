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

  // rule-based "AI" insight: compares last 3 days of logs to each user's embedded targets
  router.get("/insight/:user", (req, res) => {
    const user = req.params.user;
    const targets = {
      Yuvena: { calorieTarget: 1600, note: "no red meat, low glycemic load, high potassium priority" },
      Nadine: { calorieTarget: 1500, note: "gluten/dairy/soy-free, thyroid-supportive, moderate protein" },
    };
    const t = targets[user] || targets.Yuvena;

    const last3days = db.prepare(`
      SELECT date(created_at) d, SUM(calories) cals, COUNT(*) n
      FROM health_logs WHERE user_name=? AND log_type='diet' AND created_at >= date('now','-3 days')
      GROUP BY date(created_at)
    `).all(user);

    const workoutDays = db.prepare(`
      SELECT COUNT(DISTINCT date(created_at)) c FROM health_logs
      WHERE user_name=? AND log_type='workout' AND created_at >= date('now','-7 days')
    `).get(user).c;

    const insights = [];
    const avgCal = last3days.length ? last3days.reduce((s, d) => s + (d.cals || 0), 0) / last3days.length : 0;

    if (avgCal === 0) {
      insights.push("No diet logs in the last 3 days — log meals to get a real read on intake.");
    } else if (avgCal < t.calorieTarget * 0.7) {
      insights.push(`Average intake (${Math.round(avgCal)} kcal) is well under your ${t.calorieTarget} kcal target — make sure you're not under-eating.`);
    } else if (avgCal > t.calorieTarget * 1.2) {
      insights.push(`Average intake (${Math.round(avgCal)} kcal) is above your ${t.calorieTarget} kcal target — worth reviewing portions this week.`);
    } else {
      insights.push(`Average intake (${Math.round(avgCal)} kcal) is tracking close to your ${t.calorieTarget} kcal target — good consistency.`);
    }

    if (workoutDays < 3) {
      insights.push(`Only ${workoutDays} workout day(s) logged this week — aim for the Mon/Wed/Fri gym + Tue/Thu/Sat walk pattern.`);
    } else {
      insights.push(`${workoutDays} workout days logged this week — on pace with your routine.`);
    }

    insights.push(`Dietary rule reminder: ${t.note}.`);

    res.json({ user, avg_calories_3day: Math.round(avgCal), workout_days_7day: workoutDays, insights });
  });

  return router;
};
