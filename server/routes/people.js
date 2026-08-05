const express = require("express");
const db = require("../db");

// Food composition database (per 100g, raw/edible portion, standard reference values)
const FOOD_SEED = [
  // proteins
  { name: "Chicken breast", category: "protein", calories_per100: 165, protein_per100: 31, fat_per100: 3.6, carbs_per100: 0, fiber_per100: 0 },
  { name: "Pork (lean)", category: "protein", calories_per100: 242, protein_per100: 27, fat_per100: 14, carbs_per100: 0, fiber_per100: 0 },
  { name: "Beef (lean)", category: "protein", calories_per100: 250, protein_per100: 26, fat_per100: 15, carbs_per100: 0, fiber_per100: 0 },
  { name: "Fish (salmon)", category: "protein", calories_per100: 208, protein_per100: 20, fat_per100: 13, carbs_per100: 0, fiber_per100: 0 },
  { name: "Fish (white, e.g. tilapia)", category: "protein", calories_per100: 96, protein_per100: 20, fat_per100: 1.7, carbs_per100: 0, fiber_per100: 0 },
  { name: "Egg", category: "protein", calories_per100: 155, protein_per100: 13, fat_per100: 11, carbs_per100: 1.1, fiber_per100: 0 },
  { name: "Tofu", category: "protein", calories_per100: 76, protein_per100: 8, fat_per100: 4.8, carbs_per100: 1.9, fiber_per100: 0.3 },
  { name: "Shrimp", category: "protein", calories_per100: 99, protein_per100: 24, fat_per100: 0.3, carbs_per100: 0.2, fiber_per100: 0 },
  // carbs
  { name: "White rice (cooked)", category: "carb", calories_per100: 130, protein_per100: 2.7, fat_per100: 0.3, carbs_per100: 28, fiber_per100: 0.4 },
  { name: "Three-color rice (cooked)", category: "carb", calories_per100: 123, protein_per100: 3, fat_per100: 1, carbs_per100: 25, fiber_per100: 2 },
  { name: "Potato (boiled)", category: "carb", calories_per100: 87, protein_per100: 2, fat_per100: 0.1, carbs_per100: 17, fiber_per100: 2.2 },
  { name: "Oatmeal (dry)", category: "carb", calories_per100: 389, protein_per100: 13, fat_per100: 7, carbs_per100: 66, fiber_per100: 10 },
  { name: "Sweet potato (boiled)", category: "carb", calories_per100: 90, protein_per100: 2, fat_per100: 0.2, carbs_per100: 21, fiber_per100: 3 },
  // veggies
  { name: "Mixed vegetables", category: "veggie", calories_per100: 35, protein_per100: 2, fat_per100: 0.3, carbs_per100: 6, fiber_per100: 2.5 },
  { name: "Spinach", category: "veggie", calories_per100: 23, protein_per100: 2.9, fat_per100: 0.4, carbs_per100: 3.6, fiber_per100: 2.2 },
  { name: "Broccoli", category: "veggie", calories_per100: 34, protein_per100: 2.8, fat_per100: 0.4, carbs_per100: 7, fiber_per100: 2.6 },
  // fruits
  { name: "Mixed fruit", category: "fruit", calories_per100: 52, protein_per100: 0.5, fat_per100: 0.2, carbs_per100: 13, fiber_per100: 2 },
  { name: "Banana", category: "fruit", calories_per100: 89, protein_per100: 1.1, fat_per100: 0.3, carbs_per100: 23, fiber_per100: 2.6 },
  { name: "Apple", category: "fruit", calories_per100: 52, protein_per100: 0.3, fat_per100: 0.2, carbs_per100: 14, fiber_per100: 2.4 },
];

const ACTIVITY_FACTORS = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 };

// condition knowledge base — matched by keyword against a person's body_problems text.
// Real, commonly-cited guidance for each condition, not a live AI call.
const CONDITION_GUIDE = [
  {
    match: /pcos|polycystic/i,
    macro_note: "PCOS: prioritize low-glycemic carbs (oats, legumes, whole grains) over refined sugar/white rice to help manage insulin response.",
    workout: ["Strength training 3x/week (builds insulin-sensitive muscle mass)", "Low-intensity walking daily (helps regulate cortisol)", "Avoid excessive high-intensity cardio — can raise cortisol and worsen symptoms"],
    supplements: [{ name: "Inositol (myo + d-chiro, 40:1 ratio)", portion: "2000-4000mg/day" }, { name: "Vitamin D3", portion: "1000-2000 IU/day" }, { name: "Omega-3 fish oil", portion: "1000mg/day" }],
    tcm: [{ name: "艾叶 (Mugwort) foot soak", portion: "15-20g dried herb per soak, 15-20 min, evenings" }, { name: "当归 (Angelica root) tea", portion: "3-5g, 2-3x/week" }],
  },
  {
    match: /insulin resistan|prediabet/i,
    macro_note: "Insulin resistance: spread carbs across meals, pair carbs with protein/fat, avoid large single-serving refined-carb meals.",
    workout: ["Post-meal 10-15 min walks (measurably lowers post-meal glucose spikes)", "Strength training 2-3x/week"],
    supplements: [{ name: "Chromium picolinate", portion: "200-400mcg/day" }, { name: "Magnesium glycinate", portion: "200-400mg/day, evening" }, { name: "Berberine", portion: "500mg, 2-3x/day with meals (consult a doctor first)" }],
    tcm: [{ name: "生姜 (Ginger) foot soak", portion: "20g fresh sliced ginger per soak, 15 min" }],
  },
  {
    match: /hypothyroid|thyroid/i,
    macro_note: "Thyroid support: adequate iodine and selenium-containing foods (seafood, brazil nuts in moderation), consistent meal timing supports metabolism.",
    workout: ["Moderate strength training 2-3x/week — avoid overtraining, which can stress thyroid function further", "Gentle daily movement (walking, stretching)"],
    supplements: [{ name: "Selenium", portion: "100-200mcg/day" }, { name: "Zinc", portion: "15-30mg/day" }, { name: "Iodine (only if not already on medication interactions)", portion: "consult doctor for dose" }],
    tcm: [{ name: "生姜+艾叶 (Ginger + Mugwort) foot soak", portion: "15g each, 15-20 min, helps circulation" }],
  },
  {
    match: /irregular period|menstrual/i,
    macro_note: "Cycle support: consistent iron intake (leafy greens, lean red meat if eaten) and stable blood sugar support hormonal regularity.",
    workout: ["Moderate consistent exercise — avoid extreme calorie deficits which can worsen irregularity"],
    supplements: [{ name: "Vitamin B6", portion: "50-100mg/day" }, { name: "Magnesium", portion: "200-400mg/day" }],
    tcm: [{ name: "艾叶 (Mugwort) foot soak", portion: "15-20g dried herb, 15-20 min, especially week before cycle" }, { name: "红糖姜茶 (Brown sugar ginger tea)", portion: "1 cup, during cycle" }],
  },
  {
    match: /single kidney|kidney/i,
    macro_note: "Single kidney: moderate (not excessive) protein intake, watch sodium, stay well-hydrated — avoid very-high-protein diet trends.",
    workout: ["Moderate cardio and strength training are generally fine — avoid activities with high risk of abdominal trauma"],
    supplements: [{ name: "Consult a nephrologist before any supplement regimen", portion: "-" }],
    tcm: [{ name: "枸杞 (Goji berry) tea", portion: "10-15g, supports general wellness — confirm with your doctor given kidney status" }],
  },
  {
    match: /gluten/i,
    macro_note: "Gluten-free: rely on rice, potatoes, gluten-free oats, quinoa for carbs — check sauces/soy sauce for hidden gluten.",
    workout: [],
    supplements: [{ name: "B-vitamin complex (gluten-free diets can run low)", portion: "1 tablet/day" }],
    tcm: [],
  },
];

function getRecommendations(person) {
  const text = (person.body_problems || "").toLowerCase();
  const matched = CONDITION_GUIDE.filter((c) => c.match.test(text));
  if (!matched.length) {
    return { macro_notes: [], workout: ["General fitness: 150+ min moderate activity/week, strength training 2-3x/week"], supplements: [], tcm: [], matched_conditions: [] };
  }
  return {
    macro_notes: matched.map((c) => c.macro_note),
    workout: [...new Set(matched.flatMap((c) => c.workout))],
    supplements: matched.flatMap((c) => c.supplements),
    tcm: matched.flatMap((c) => c.tcm),
    matched_conditions: matched.map((c) => c.match.source),
  };
}

function calcDailyNeeds(person, goalWeightKg) {
  const { weight_kg: w, height_cm: h, age, gender, activity_level, goal_type } = person;
  // Mifflin-St Jeor BMR
  const bmr = gender === "male" ? 10 * w + 6.25 * h - 5 * age + 5 : 10 * w + 6.25 * h - 5 * age - 161;
  const tdee = bmr * (ACTIVITY_FACTORS[activity_level] || 1.55);

  // prefer explicit goal_type; fall back to inferring from goal weight vs current weight
  let calorieTarget = tdee;
  let proteinMultiplier = 1.6; // g/kg bodyweight, standard for fat loss / maintenance
  const gt = goal_type || (goalWeightKg && goalWeightKg < w ? "lose_weight" : goalWeightKg && goalWeightKg > w ? "gain_muscle" : "maintain");
  if (gt === "lose_weight") { calorieTarget = tdee * 0.85; proteinMultiplier = 1.8; } // higher protein protects muscle in a deficit
  else if (gt === "gain_muscle") { calorieTarget = tdee * 1.10; proteinMultiplier = 2.0; } // higher protein supports muscle synthesis in a surplus
  else calorieTarget = tdee; // maintain

  const proteinG = Math.round(w * proteinMultiplier);
  const fatG = Math.round((calorieTarget * 0.27) / 9);
  const proteinCal = proteinG * 4;
  const fatCal = fatG * 9;
  const carbG = Math.round(Math.max(0, calorieTarget - proteinCal - fatCal) / 4);
  const fiberG = gender === "male" ? 38 : 25;

  return { bmr: Math.round(bmr), tdee: Math.round(tdee), calorieTarget: Math.round(calorieTarget), proteinG, fatG, carbG, fiberG, goalType: gt };
}

// rule-based diet + workout recommendation based on the person's goal — not a live AI call
function recommendPlan(goalType, activityLevel) {
  const plans = {
    lose_weight: {
      diet: "Moderate calorie deficit (~15% under maintenance) with high protein to preserve muscle. Prioritize lean protein + fiber-rich veg at every meal to stay full on fewer calories. Limit refined carbs and sugary drinks.",
      workout: "4-5x/week: 3 days strength training (full body, preserves muscle during the deficit) + 2 days cardio (20-30 min moderate intensity — walking, cycling, swimming). Strength training matters more than cardio here.",
    },
    gain_muscle: {
      diet: "Moderate calorie surplus (~10% over maintenance) with high protein (2g/kg) spread across meals to maximize muscle protein synthesis. Carbs should be adequate to fuel training.",
      workout: "4-6x/week strength training with progressive overload (increasing weight/reps over time), split by muscle group. Keep cardio light (1-2x/week) so it doesn't compete with recovery.",
    },
    maintain: {
      diet: "Eat at maintenance calories with a balanced macro split. Focus on food quality and consistency rather than restriction.",
      workout: "3-4x/week mixed training — a blend of strength and cardio — to maintain fitness and body composition.",
    },
  };
  return plans[goalType] || plans.maintain;
}

function foodEquivalents(targetGrams, category, foods) {
  return foods.filter((f) => f.category === category).map((f) => {
    const per100 = category === "protein" ? f.protein_per100 : (category === "carb" ? f.carbs_per100 : f.fiber_per100);
    const gramsNeeded = per100 > 0 ? Math.round((targetGrams / per100) * 100) : null;
    return { food: f.name, grams_needed: gramsNeeded };
  });
}

module.exports = function (io) {
  const router = express.Router();
  const emit = () => io.emit("data:change", { module: "people" });

  // seed food database once
  const existingFoods = db.prepare("SELECT COUNT(*) c FROM food_items").get().c;
  if (existingFoods === 0) {
    const stmt = db.prepare(`INSERT INTO food_items (name, category, calories_per100, protein_per100, fat_per100, carbs_per100, fiber_per100) VALUES (?,?,?,?,?,?,?)`);
    FOOD_SEED.forEach((f) => stmt.run(f.name, f.category, f.calories_per100, f.protein_per100, f.fat_per100, f.carbs_per100, f.fiber_per100));
  }

  router.get("/foods", (req, res) => {
    const { category } = req.query;
    let sql = "SELECT * FROM food_items WHERE 1=1";
    const params = [];
    if (category) { sql += " AND category=?"; params.push(category); }
    sql += " ORDER BY category, name";
    res.json(db.prepare(sql).all(...params));
  });

  router.get("/", (req, res) => {
    res.json(db.prepare("SELECT * FROM people ORDER BY name").all());
  });

  router.post("/", (req, res) => {
    const { name, height_cm, weight_kg, age, gender, activity_level, no_red_meat, gluten_free, dairy_free, soy_free, notes, goal_type, goal_weight_kg, goal_date, body_problems } = req.body;
    if (!name) return res.status(400).json({ error: "name required" });
    const info = db.prepare(`
      INSERT INTO people (name, height_cm, weight_kg, age, gender, activity_level, no_red_meat, gluten_free, dairy_free, soy_free, notes, goal_type, goal_weight_kg, goal_date, body_problems)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(name, height_cm || null, weight_kg || null, age || null, gender || "female", activity_level || "moderate",
      no_red_meat ? 1 : 0, gluten_free ? 1 : 0, dairy_free ? 1 : 0, soy_free ? 1 : 0, notes || "", goal_type || "", goal_weight_kg || null, goal_date || null, body_problems || "");
    emit();
    res.json({ id: info.lastInsertRowid });
  });

  router.put("/:id", (req, res) => {
    const { name, height_cm, weight_kg, age, gender, activity_level, no_red_meat, gluten_free, dairy_free, soy_free, notes, goal_type, goal_weight_kg, goal_date, excluded_foods, body_problems } = req.body;
    db.prepare(`
      UPDATE people SET name=?, height_cm=?, weight_kg=?, age=?, gender=?, activity_level=?, no_red_meat=?, gluten_free=?, dairy_free=?, soy_free=?, notes=?, goal_type=?, goal_weight_kg=?, goal_date=?, excluded_foods=?, body_problems=?
      WHERE id=?
    `).run(name, height_cm || null, weight_kg || null, age || null, gender || "female", activity_level || "moderate",
      no_red_meat ? 1 : 0, gluten_free ? 1 : 0, dairy_free ? 1 : 0, soy_free ? 1 : 0, notes || "", goal_type || "", goal_weight_kg || null, goal_date || null,
      excluded_foods !== undefined ? JSON.stringify(excluded_foods) : "[]", body_problems || "", req.params.id);
    emit();
    res.json({ ok: true });
  });

  router.delete("/:id", (req, res) => {
    db.prepare("DELETE FROM people WHERE id=?").run(req.params.id);
    emit();
    res.json({ ok: true });
  });

  // condition-aware recommendations: workout, supplements, TCM/foot-soak — matched from body_problems
  router.get("/:id/recommendations", (req, res) => {
    const person = db.prepare("SELECT * FROM people WHERE id=?").get(req.params.id);
    if (!person) return res.status(404).json({ error: "not found" });
    res.json(getRecommendations(person));
  });

  // list of all known foods, used for the "which proteins/carbs does this person eat" picker
  router.get("/food-options", (req, res) => {
    const foods = db.prepare("SELECT id, name, category FROM food_items ORDER BY category, name").all();
    res.json(foods);
  });

  // daily needs: BMR/TDEE-based calorie + macro targets, converted into food gram equivalents
  router.get("/:id/daily-needs", (req, res) => {
    const person = db.prepare("SELECT * FROM people WHERE id=?").get(req.params.id);
    if (!person) return res.status(404).json({ error: "not found" });
    if (!person.weight_kg || !person.height_cm || !person.age) {
      return res.json({ error: "Fill in weight, height, and age for this person to calculate daily needs." });
    }
    const goalWeight = person.goal_weight_kg || null;
    const needs = calcDailyNeeds(person, goalWeight);
    const foods = db.prepare("SELECT * FROM food_items").all();
    let excluded = [];
    try { excluded = JSON.parse(person.excluded_foods || "[]"); } catch (e) {}

    let proteinFoods = foodEquivalents(needs.proteinG, "protein", foods);
    if (person.no_red_meat) proteinFoods = proteinFoods.filter((f) => !["Pork (lean)", "Beef (lean)"].includes(f.food));
    proteinFoods = proteinFoods.filter((f) => !excluded.includes(f.food));

    let carbFoods = foodEquivalents(needs.carbG, "carb", foods).filter((f) => !excluded.includes(f.food));
    let fiberFoods = foodEquivalents(needs.fiberG, "veggie", foods).filter((f) => !excluded.includes(f.food));
    const waterTargetMl = Math.round((person.weight_kg || 60) * 33); // ~33ml/kg bodyweight, standard hydration guidance

    res.json({
      person: person.name,
      bmr: needs.bmr, tdee: needs.tdee, calorie_target: needs.calorieTarget,
      protein_target_g: needs.proteinG, fat_target_g: needs.fatG, carb_target_g: needs.carbG, fiber_target_g: needs.fiberG,
      water_target_ml: waterTargetMl,
      goal_weight_kg: person.goal_weight_kg, goal_date: person.goal_date, goal_type: needs.goalType,
      recommended_plan: recommendPlan(needs.goalType, person.activity_level),
      excluded_foods: excluded,
      protein_food_equivalents: proteinFoods,
      carb_food_equivalents: carbFoods,
      fiber_food_equivalents: fiberFoods,
      veggie_suggestion_g: 400,
      fruit_suggestion_g: 250,
      note: "Calculated using the Mifflin-St Jeor BMR formula and standard food composition data — not a live AI call. Food-equivalent grams assume getting 100% of that macro from a single food; in practice you'll mix sources.",
    });
  });

  // ---- daily schedule checklist ----
  router.get("/:id/schedule", (req, res) => {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const row = db.prepare("SELECT * FROM daily_schedule WHERE person_id=? AND log_date=?").get(req.params.id, date);
    res.json(row || {});
  });

  router.put("/:id/schedule", (req, res) => {
    const { date, wake_time, sleep_time, breakfast_time, lunch_time, snack_time, dinner_time, workout_time } = req.body;
    const logDate = date || new Date().toISOString().slice(0, 10);
    db.prepare(`
      INSERT INTO daily_schedule (person_id, log_date, wake_time, sleep_time, breakfast_time, lunch_time, snack_time, dinner_time, workout_time)
      VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(person_id, log_date) DO UPDATE SET
        wake_time=excluded.wake_time, sleep_time=excluded.sleep_time, breakfast_time=excluded.breakfast_time,
        lunch_time=excluded.lunch_time, snack_time=excluded.snack_time, dinner_time=excluded.dinner_time, workout_time=excluded.workout_time
    `).run(req.params.id, logDate, wake_time || "", sleep_time || "", breakfast_time || "", lunch_time || "", snack_time || "", dinner_time || "", workout_time || "");
    emit();
    res.json({ ok: true });
  });

  // ---- weekly menu planner ----
  function mondayOf(dateStr) {
    const d = dateStr ? new Date(dateStr) : new Date();
    const day = d.getDay(); // 0=Sun..6=Sat
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
  }

  router.get("/weekly-menu/week-start", (req, res) => res.json({ week_start: mondayOf(req.query.date) }));

  router.get("/weekly-menu", (req, res) => {
    const weekStart = req.query.week_start || mondayOf();
    const rows = db.prepare("SELECT * FROM weekly_menus WHERE week_start=? ORDER BY day_of_week, meal_slot").all(weekStart);
    rows.forEach((r) => {
      try { r.participants = JSON.parse(r.participants_json || "[]"); } catch (e) { r.participants = []; }
      try { r.ingredients = JSON.parse(r.ingredients_json || "[]"); } catch (e) { r.ingredients = []; }
    });
    // a day is "complete" once breakfast, lunch, and dinner all have an entry
    const completion = [0, 1, 2, 3, 4, 5, 6].map((d) => {
      const slots = rows.filter((r) => r.day_of_week === d).map((r) => r.meal_slot);
      return { day_of_week: d, complete: ["breakfast", "lunch", "dinner"].every((s) => slots.includes(s)) };
    });
    const weekComplete = completion.every((c) => c.complete);
    res.json({ week_start: weekStart, menus: rows, completion, week_complete: weekComplete });
  });

  router.post("/weekly-menu", (req, res) => {
    const { week_start, day_of_week, meal_slot, menu_name, participants, ingredients } = req.body;
    if (!week_start || day_of_week === undefined || !meal_slot || !menu_name) {
      return res.status(400).json({ error: "week_start, day_of_week, meal_slot, menu_name required" });
    }
    const info = db.prepare(`
      INSERT INTO weekly_menus (week_start, day_of_week, meal_slot, menu_name, participants_json, ingredients_json)
      VALUES (?,?,?,?,?,?)
    `).run(week_start, day_of_week, meal_slot, menu_name, JSON.stringify(participants || []), JSON.stringify(ingredients || []));
    emit();
    res.json({ id: info.lastInsertRowid });
  });

  router.delete("/weekly-menu/:id", (req, res) => {
    db.prepare("DELETE FROM weekly_menus WHERE id=?").run(req.params.id);
    emit();
    res.json({ ok: true });
  });

  // per-person adjusted portions for a single menu entry, scaled by each participant's calorie target
  router.get("/weekly-menu/:id/portions", (req, res) => {
    const menu = db.prepare("SELECT * FROM weekly_menus WHERE id=?").get(req.params.id);
    if (!menu) return res.status(404).json({ error: "not found" });
    let participants = [], ingredients = [];
    try { participants = JSON.parse(menu.participants_json || "[]"); } catch (e) {}
    try { ingredients = JSON.parse(menu.ingredients_json || "[]"); } catch (e) {}

    const people = db.prepare("SELECT * FROM people").all().filter((p) => participants.includes(p.name));
    const targets = people.map((p) => {
      if (!p.weight_kg || !p.height_cm || !p.age) return { name: p.name, calorieTarget: 2000 };
      const needs = calcDailyNeeds(p, p.goal_weight_kg);
      return { name: p.name, calorieTarget: needs.calorieTarget };
    });
    const avgTarget = targets.length ? targets.reduce((s, t) => s + t.calorieTarget, 0) / targets.length : 2000;

    const perPerson = targets.map((t) => ({
      name: t.name,
      ratio: Math.round((t.calorieTarget / avgTarget) * 100) / 100,
      portions: ingredients.map((i) => ({ name: i.name, grams: Math.round(i.grams * (t.calorieTarget / avgTarget)) })),
    }));

    res.json({ menu_name: menu.menu_name, base_ingredients: ingredients, per_person: perPerson, note: "Portions scaled by each person's calorie target relative to the group average — a reasonable heuristic, not a live AI call." });
  });

  // weekly grocery total — sums each person's scaled portions across every menu in the week
  router.get("/weekly-menu/grocery", (req, res) => {
    const weekStart = req.query.week_start || mondayOf();
    const rows = db.prepare("SELECT * FROM weekly_menus WHERE week_start=?").all(weekStart);
    const people = db.prepare("SELECT * FROM people").all();
    const totals = {}; // { personName: { ingredientName: grams } }

    rows.forEach((menu) => {
      let participants = [], ingredients = [];
      try { participants = JSON.parse(menu.participants_json || "[]"); } catch (e) {}
      try { ingredients = JSON.parse(menu.ingredients_json || "[]"); } catch (e) {}
      const activePeople = people.filter((p) => participants.includes(p.name));
      if (!activePeople.length) return;

      const targets = activePeople.map((p) => {
        if (!p.weight_kg || !p.height_cm || !p.age) return { name: p.name, calorieTarget: 2000 };
        const needs = calcDailyNeeds(p, p.goal_weight_kg);
        return { name: p.name, calorieTarget: needs.calorieTarget };
      });
      const avgTarget = targets.reduce((s, t) => s + t.calorieTarget, 0) / targets.length;

      targets.forEach((t) => {
        if (!totals[t.name]) totals[t.name] = {};
        ingredients.forEach((i) => {
          const scaledGrams = i.grams * (t.calorieTarget / avgTarget);
          totals[t.name][i.name] = (totals[t.name][i.name] || 0) + scaledGrams;
        });
      });
    });

    Object.keys(totals).forEach((person) => {
      Object.keys(totals[person]).forEach((ing) => { totals[person][ing] = Math.round(totals[person][ing]); });
    });

    res.json({ week_start: weekStart, totals, note: "Weekly totals scaled by each person's calorie target — use as a grocery shopping guide." });
  });

  return router;
};
