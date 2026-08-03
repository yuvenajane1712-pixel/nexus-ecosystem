const express = require("express");
const db = require("../db");

module.exports = function (io) {
  const router = express.Router();
  const emit = () => io.emit("data:change", { module: "health" });
  const emitBudget = () => io.emit("data:change", { module: "budget" });

  router.get("/logs", (req, res) => {
    const { user_name, log_type, meal_slot } = req.query;
    let sql = "SELECT * FROM health_logs WHERE 1=1";
    const params = [];
    if (user_name) { sql += " AND user_name=?"; params.push(user_name); }
    if (log_type) { sql += " AND log_type=?"; params.push(log_type); }
    if (meal_slot) { sql += " AND meal_slot=?"; params.push(meal_slot); }
    sql += " ORDER BY created_at DESC LIMIT 200";
    res.json(db.prepare(sql).all(...params));
  });

  // log a meal by picking a food + grams — nutrition auto-calculated from the food database
  router.post("/logs/meal", (req, res) => {
    const { user_name, meal_slot, food_item_id, grams, cooking_method } = req.body;
    const food = db.prepare("SELECT * FROM food_items WHERE id=?").get(food_item_id);
    if (!food) return res.status(400).json({ error: "food not found" });
    const g = Number(grams) || 0;
    const ratio = g / 100;
    const calories = Math.round(food.calories_per100 * ratio);
    const protein = Math.round(food.protein_per100 * ratio * 10) / 10;
    const fat = Math.round(food.fat_per100 * ratio * 10) / 10;
    const carbs = Math.round(food.carbs_per100 * ratio * 10) / 10;
    const fiber = Math.round(food.fiber_per100 * ratio * 10) / 10;

    const info = db.prepare(`
      INSERT INTO health_logs (user_name, log_type, title, value, calories, protein, fat, carbs, fiber, meal_slot, food_item_id, grams)
      VALUES (?, 'diet', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(user_name, food.name, cooking_method || "", calories, protein, fat, carbs, fiber, meal_slot || "", food_item_id, g);

    emit();
    res.json({ id: info.lastInsertRowid, calories, protein, fat, carbs, fiber });
  });

  router.post("/logs", (req, res) => {
    const { user_name, log_type, title, value, calories, protein, fat, carbs, cost_rmb } = req.body;
    const info = db.prepare(`
      INSERT INTO health_logs (user_name, log_type, title, value, calories, protein, fat, carbs, cost_rmb)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(user_name, log_type, title || "", value || "", calories || null, protein || null, fat || null, carbs || null, cost_rmb || null);

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

  // rule-based "AI" insight: compares last 3 days of logs to each user's embedded targets,
  // and suggests concrete burn actions if intake is running high
  router.get("/insight/:user", (req, res) => {
    const user = req.params.user;
    const targets = {
      Yuvena: { calorieTarget: 1600, proteinTarget: 90, fatTarget: 50, carbTarget: 150, note: "no red meat, low glycemic load, high potassium priority" },
      Nadine: { calorieTarget: 1500, proteinTarget: 80, fatTarget: 45, carbTarget: 140, note: "gluten/dairy/soy-free, thyroid-supportive, moderate protein" },
    };
    const t = targets[user] || targets.Yuvena;

    const last3days = db.prepare(`
      SELECT date(created_at) d, SUM(calories) cals, SUM(protein) prot, SUM(fat) fat, SUM(carbs) carb, COUNT(*) n
      FROM health_logs WHERE user_name=? AND log_type='diet' AND created_at >= date('now','-3 days')
      GROUP BY date(created_at)
    `).all(user);

    const workoutDays = db.prepare(`
      SELECT COUNT(DISTINCT date(created_at)) c FROM health_logs
      WHERE user_name=? AND log_type='workout' AND created_at >= date('now','-7 days')
    `).get(user).c;

    const todayBurn = db.prepare(`
      SELECT COALESCE(SUM(CAST(value AS REAL)),0) c FROM health_logs
      WHERE user_name=? AND log_type='workout' AND title='calories_burned' AND date(created_at)=date('now')
    `).get(user).c;

    const insights = [];
    const n = last3days.length || 1;
    const avgCal = last3days.reduce((s, d) => s + (d.cals || 0), 0) / n;
    const avgProt = last3days.reduce((s, d) => s + (d.prot || 0), 0) / n;
    const avgFat = last3days.reduce((s, d) => s + (d.fat || 0), 0) / n;
    const avgCarb = last3days.reduce((s, d) => s + (d.carb || 0), 0) / n;

    if (avgCal === 0) {
      insights.push("No diet logs in the last 3 days — log meals to get a real read on intake.");
    } else {
      const diff = avgCal - t.calorieTarget;
      if (diff > t.calorieTarget * 0.15) {
        const stepsK = Math.max(1, Math.round(diff / 40)); // ~40 kcal burned per 1000 steps
        const cardioMin = Math.max(10, Math.round(diff / 8)); // ~8 kcal/min moderate cardio
        insights.push(`Average intake (${Math.round(avgCal)} kcal) is ~${Math.round(diff)} kcal over your ${t.calorieTarget} kcal target. To balance it: roughly ${stepsK}k extra steps, or ${cardioMin} min of cardio today.`);
      } else if (diff < -t.calorieTarget * 0.3) {
        insights.push(`Average intake (${Math.round(avgCal)} kcal) is well under your ${t.calorieTarget} kcal target — make sure you're not under-eating.`);
      } else {
        insights.push(`Average intake (${Math.round(avgCal)} kcal) is tracking close to your ${t.calorieTarget} kcal target — good consistency.`);
      }
    }

    if (avgProt > 0) {
      insights.push(avgProt < t.proteinTarget * 0.8
        ? `Protein averaging ${Math.round(avgProt)}g vs ${t.proteinTarget}g target — a bit low, add a protein source next meal.`
        : `Protein averaging ${Math.round(avgProt)}g vs ${t.proteinTarget}g target — on track.`);
    }
    if (avgFat > t.fatTarget * 1.3) insights.push(`Fat intake (${Math.round(avgFat)}g) is running above the ${t.fatTarget}g target.`);
    if (avgCarb > t.carbTarget * 1.3) insights.push(`Carb intake (${Math.round(avgCarb)}g) is running above the ${t.carbTarget}g target.`);

    if (workoutDays < 3) {
      insights.push(`Only ${workoutDays} workout day(s) logged this week — aim for the Mon/Wed/Fri gym + Tue/Thu/Sat walk pattern.`);
    } else {
      insights.push(`${workoutDays} workout days logged this week — on pace with your routine.`);
    }

    if (todayBurn > 0) insights.push(`Logged ${todayBurn} kcal burned today from workouts.`);

    insights.push(`Dietary rule reminder: ${t.note}.`);

    res.json({
      user, avg_calories_3day: Math.round(avgCal), avg_protein_3day: Math.round(avgProt),
      avg_fat_3day: Math.round(avgFat), avg_carbs_3day: Math.round(avgCarb),
      workout_days_7day: workoutDays, insights,
      note: "Rule-based coaching using your logged data against embedded targets — not a live AI call.",
    });
  });

  // weight history + goal line for chart rendering
  router.get("/weight-chart/:user", (req, res) => {
    const user = req.params.user;
    const goals = {
      Yuvena: { start: 105, target: 65, unit: "kg" },
      Nadine: { start: 62, target: 55, unit: "kg" },
    };
    const g = goals[user] || goals.Yuvena;
    const logs = db.prepare(`
      SELECT date(created_at) d, value FROM health_logs
      WHERE user_name=? AND log_type='metric' AND title='weight'
      ORDER BY created_at ASC
    `).all(user);
    const points = logs.map((l) => ({ date: l.d, weight: parseFloat(l.value) })).filter((p) => !isNaN(p.weight));
    res.json({ user, goal_start: g.start, goal_target: g.target, points });
  });

  // today's meals grouped by breakfast/lunch/dinner/snack
  router.get("/meals-today/:user", (req, res) => {
    const rows = db.prepare(`
      SELECT * FROM health_logs WHERE user_name=? AND log_type='diet' AND date(created_at)=date('now')
      ORDER BY created_at ASC
    `).all(req.params.user);
    const bySlot = { breakfast: [], lunch: [], dinner: [], snack: [] };
    rows.forEach((r) => { if (bySlot[r.meal_slot]) bySlot[r.meal_slot].push(r); });
    const totals = rows.reduce((acc, r) => ({
      calories: acc.calories + (r.calories || 0), protein: acc.protein + (r.protein || 0),
      fat: acc.fat + (r.fat || 0), carbs: acc.carbs + (r.carbs || 0), fiber: acc.fiber + (r.fiber || 0),
    }), { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 });
    res.json({ bySlot, totals });
  });

  return router;
};
