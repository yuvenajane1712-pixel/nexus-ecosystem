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

  // batch-log a whole meal slot at once: Meal A / Meal B / Meal C, each with its own
  // name/grams/kcal/cooking method — free-form, not limited to the preset food database
  router.post("/logs/meal-batch", (req, res) => {
    const { user_name, meal_slot, items } = req.body;
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "items array required" });

    const stmt = db.prepare(`
      INSERT INTO health_logs (user_name, log_type, title, value, calories, protein, fat, carbs, fiber, meal_slot, grams)
      VALUES (?, 'diet', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertedIds = [];
    items.forEach((item) => {
      const info = stmt.run(
        user_name, item.name || "Meal item", item.cooking_method || "",
        Number(item.calories) || 0, Number(item.protein) || null, Number(item.fat) || null, Number(item.carbs) || null, Number(item.fiber) || null,
        meal_slot || "", Number(item.grams) || null
      );
      insertedIds.push(info.lastInsertRowid);
    });
    emit();
    res.json({ ids: insertedIds, count: insertedIds.length });
  });

  router.post("/logs", (req, res) => {
    const { user_name, log_type, title, value, calories, protein, fat, carbs, cost_rmb, grocery_grams } = req.body;
    const info = db.prepare(`
      INSERT INTO health_logs (user_name, log_type, title, value, calories, protein, fat, carbs, cost_rmb, grocery_grams)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(user_name, log_type, title || "", value || "", calories || null, protein || null, fat || null, carbs || null, cost_rmb || null, grocery_grams || null);

    emit();

    let shelfLife = null;
    // grocery logs auto-post to Budget as an expense (no duplicate entry) + get a shelf-life estimate
    if (log_type === "grocery" && cost_rmb) {
      db.prepare("INSERT INTO transactions (kind, category, amount_rmb, source, note) VALUES (?,?,?,?,?)")
        .run("expense", "Human Groceries", Number(cost_rmb), "health", `${user_name}: ${title}`);
      emitBudget();
      shelfLife = estimateShelfLife(title || "");
    }

    res.json({ id: info.lastInsertRowid, shelf_life: shelfLife });
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

  // ---- bathroom quick-tap log (pee/poop) — with stool type (Bristol-style) and pee color tracking ----
  router.post("/bathroom", (req, res) => {
    const { person_name, kind, stool_type, pee_color } = req.body;
    const info = db.prepare("INSERT INTO bathroom_log (person_name, kind, stool_type, pee_color) VALUES (?,?,?,?)")
      .run(person_name, kind, stool_type || null, pee_color || null);
    emit();
    res.json({ id: info.lastInsertRowid });
  });

  router.get("/bathroom/:person", (req, res) => {
    const date = req.query.date || null;
    const dateClause = date ? "date(logged_at)=?" : "date(logged_at)=date('now')";
    const params = date ? [req.params.person, date] : [req.params.person];
    const rows = db.prepare(`
      SELECT * FROM bathroom_log WHERE person_name=? AND ${dateClause} ORDER BY logged_at ASC
    `).all(...params);

    const poopEvents = rows.filter((r) => r.kind === "poop");
    const peeEvents = rows.filter((r) => r.kind === "pee");

    const stoolBreakdown = {};
    poopEvents.forEach((r) => { const t = r.stool_type || "unspecified"; stoolBreakdown[t] = (stoolBreakdown[t] || 0) + 1; });
    const peeColorBreakdown = {};
    peeEvents.forEach((r) => { const c = r.pee_color || "unspecified"; peeColorBreakdown[c] = (peeColorBreakdown[c] || 0) + 1; });

    res.json({
      pee_count: peeEvents.length,
      poop_count: poopEvents.length,
      events: rows,
      stool_breakdown: stoolBreakdown,
      pee_color_breakdown: peeColorBreakdown,
    });
  });

  // 7-day history for the frequency/type chart
  router.get("/bathroom/:person/history", (req, res) => {
    const rows = db.prepare(`
      SELECT * FROM bathroom_log WHERE person_name=? AND logged_at >= datetime('now','-7 days') ORDER BY logged_at ASC
    `).all(req.params.person);
    const byDay = {};
    rows.forEach((r) => {
      const day = r.logged_at.slice(0, 10);
      if (!byDay[day]) byDay[day] = { pee: 0, poop: 0 };
      byDay[day][r.kind] = (byDay[day][r.kind] || 0) + 1;
    });
    res.json({ by_day: byDay, events: rows });
  });

  router.delete("/bathroom/:id", (req, res) => {
    db.prepare("DELETE FROM bathroom_log WHERE id=?").run(req.params.id);
    emit();
    res.json({ ok: true });
  });

  // rule-based shelf-life estimate for grocery purchases (small curated reference table)
  const SHELF_LIFE_GUIDE = [
    { match: /chicken|pork|beef|meat|fish|shrimp/i, fridge: true, days: 2, note: "Raw meat/fish — use within 1-2 days refrigerated, or freeze for longer storage." },
    { match: /egg/i, fridge: true, days: 21, note: "Eggs keep well refrigerated for 3+ weeks." },
    { match: /leafy|spinach|lettuce|veg/i, fridge: true, days: 5, note: "Leafy greens wilt fast — refrigerate, use within 3-5 days." },
    { match: /potato|onion|garlic/i, fridge: false, days: 21, note: "Root vegetables store best in a cool, dark, dry place outside the fridge." },
    { match: /rice|oat|grain/i, fridge: false, days: 180, note: "Dry grains store long-term in an airtight container at room temperature." },
    { match: /fruit|apple|banana|mango/i, fridge: false, days: 5, note: "Most fruit is fine at room temp for a few days; refrigerate to extend a bit longer." },
    { match: /milk|dairy|cheese|yogurt/i, fridge: true, days: 7, note: "Dairy — keep refrigerated, use within about a week of opening." },
    { match: /tofu/i, fridge: true, days: 5, note: "Tofu — refrigerate in water, change water daily, use within 5 days." },
  ];
  function estimateShelfLife(itemName) {
    const match = SHELF_LIFE_GUIDE.find((g) => g.match.test(itemName));
    if (match) return { fridge: match.fridge, estimated_days: match.days, note: match.note };
    return { fridge: true, estimated_days: 4, note: "No specific match found — defaulting to a conservative refrigerated estimate; adjust based on the actual item." };
  }
  router.get("/shelf-life", (req, res) => {
    const { item } = req.query;
    if (!item) return res.status(400).json({ error: "item required" });
    res.json(estimateShelfLife(item));
  });

  // water intake today
  router.get("/water-today/:user", (req, res) => {
    const row = db.prepare(`
      SELECT COALESCE(SUM(CAST(value AS REAL)),0) ml FROM health_logs
      WHERE user_name=? AND log_type='water' AND date(created_at)=date('now')
    `).get(req.params.user);
    res.json({ ml_today: row.ml });
  });

  // calories eaten vs burned today
  router.get("/calorie-balance/:user", (req, res) => {
    const eaten = db.prepare(`
      SELECT COALESCE(SUM(calories),0) c FROM health_logs WHERE user_name=? AND log_type='diet' AND date(created_at)=date('now')
    `).get(req.params.user).c;
    const burned = db.prepare(`
      SELECT COALESCE(SUM(CAST(value AS REAL)),0) c FROM health_logs
      WHERE user_name=? AND log_type='workout' AND title='calories_burned' AND date(created_at)=date('now')
    `).get(req.params.user).c;
    res.json({ eaten, burned, net: eaten - burned });
  });

  return router;
};
