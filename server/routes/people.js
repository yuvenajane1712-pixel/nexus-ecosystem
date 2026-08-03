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

function calcDailyNeeds(person, goalWeightKg) {
  const { weight_kg: w, height_cm: h, age, gender, activity_level } = person;
  // Mifflin-St Jeor BMR
  const bmr = gender === "male" ? 10 * w + 6.25 * h - 5 * age + 5 : 10 * w + 6.25 * h - 5 * age - 161;
  const tdee = bmr * (ACTIVITY_FACTORS[activity_level] || 1.55);

  // if there's a weight goal (losing), apply a moderate ~15% deficit; if gaining, ~10% surplus
  let calorieTarget = tdee;
  if (goalWeightKg && goalWeightKg < w) calorieTarget = tdee * 0.85;
  else if (goalWeightKg && goalWeightKg > w) calorieTarget = tdee * 1.10;

  const proteinG = Math.round(w * 1.6); // g/kg bodyweight — supports fat loss / muscle retention
  const fatG = Math.round((calorieTarget * 0.27) / 9);
  const proteinCal = proteinG * 4;
  const fatCal = fatG * 9;
  const carbG = Math.round(Math.max(0, calorieTarget - proteinCal - fatCal) / 4);
  const fiberG = gender === "male" ? 38 : 25;

  return { bmr: Math.round(bmr), tdee: Math.round(tdee), calorieTarget: Math.round(calorieTarget), proteinG, fatG, carbG, fiberG };
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
    const { name, height_cm, weight_kg, age, gender, activity_level, no_red_meat, gluten_free, dairy_free, soy_free, notes } = req.body;
    if (!name) return res.status(400).json({ error: "name required" });
    const info = db.prepare(`
      INSERT INTO people (name, height_cm, weight_kg, age, gender, activity_level, no_red_meat, gluten_free, dairy_free, soy_free, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(name, height_cm || null, weight_kg || null, age || null, gender || "female", activity_level || "moderate",
      no_red_meat ? 1 : 0, gluten_free ? 1 : 0, dairy_free ? 1 : 0, soy_free ? 1 : 0, notes || "");
    emit();
    res.json({ id: info.lastInsertRowid });
  });

  router.put("/:id", (req, res) => {
    const { name, height_cm, weight_kg, age, gender, activity_level, no_red_meat, gluten_free, dairy_free, soy_free, notes } = req.body;
    db.prepare(`
      UPDATE people SET name=?, height_cm=?, weight_kg=?, age=?, gender=?, activity_level=?, no_red_meat=?, gluten_free=?, dairy_free=?, soy_free=?, notes=?
      WHERE id=?
    `).run(name, height_cm || null, weight_kg || null, age || null, gender || "female", activity_level || "moderate",
      no_red_meat ? 1 : 0, gluten_free ? 1 : 0, dairy_free ? 1 : 0, soy_free ? 1 : 0, notes || "", req.params.id);
    emit();
    res.json({ ok: true });
  });

  router.delete("/:id", (req, res) => {
    db.prepare("DELETE FROM people WHERE id=?").run(req.params.id);
    emit();
    res.json({ ok: true });
  });

  // daily needs: BMR/TDEE-based calorie + macro targets, converted into food gram equivalents
  router.get("/:id/daily-needs", (req, res) => {
    const person = db.prepare("SELECT * FROM people WHERE id=?").get(req.params.id);
    if (!person) return res.status(404).json({ error: "not found" });
    if (!person.weight_kg || !person.height_cm || !person.age) {
      return res.json({ error: "Fill in weight, height, and age for this person to calculate daily needs." });
    }
    const goalWeight = req.query.goal_weight ? Number(req.query.goal_weight) : null;
    const needs = calcDailyNeeds(person, goalWeight);
    const foods = db.prepare("SELECT * FROM food_items").all();

    let proteinFoods = foodEquivalents(needs.proteinG, "protein", foods);
    if (person.no_red_meat) proteinFoods = proteinFoods.filter((f) => !["Pork (lean)", "Beef (lean)"].includes(f.food));

    const carbFoods = foodEquivalents(needs.carbG, "carb", foods);

    res.json({
      person: person.name,
      bmr: needs.bmr, tdee: needs.tdee, calorie_target: needs.calorieTarget,
      protein_target_g: needs.proteinG, fat_target_g: needs.fatG, carb_target_g: needs.carbG, fiber_target_g: needs.fiberG,
      protein_food_equivalents: proteinFoods,
      carb_food_equivalents: carbFoods,
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

  return router;
};
