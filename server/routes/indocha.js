const express = require("express");
const db = require("../db");

module.exports = function (io) {
  const router = express.Router();
  const emit = () => io.emit("data:change", { module: "indocha" });

  // ---- Grocery price comparison ----
  router.get("/prices", (req, res) => {
    const rows = db.prepare("SELECT * FROM grocery_prices ORDER BY item, unit_price ASC").all();
    // group by item, compute effective cost, flag cheapest
    const byItem = {};
    rows.forEach((r) => {
      const effective = r.unit_price + (r.delivery_fee || 0) / 10; // amortized over ~10 units, simple heuristic
      if (!byItem[r.item]) byItem[r.item] = [];
      byItem[r.item].push({ ...r, effective_unit_cost: effective });
    });
    Object.values(byItem).forEach((list) => {
      list.sort((a, b) => a.effective_unit_cost - b.effective_unit_cost);
      list.forEach((r, i) => (r.cheapest = i === 0));
    });
    res.json(byItem);
  });

  router.post("/prices", (req, res) => {
    const { item, channel, unit_price, delivery_fee } = req.body;
    const info = db.prepare("INSERT INTO grocery_prices (item, channel, unit_price, delivery_fee) VALUES (?,?,?,?)")
      .run(item, channel, Number(unit_price) || 0, Number(delivery_fee) || 0);
    emit();
    res.json({ id: info.lastInsertRowid });
  });

  router.delete("/prices/:id", (req, res) => {
    db.prepare("DELETE FROM grocery_prices WHERE id=?").run(req.params.id);
    emit();
    res.json({ ok: true });
  });

  // ---- Recipes (versioned) ----
  router.get("/recipes", (req, res) => {
    // latest version per recipe_group
    const rows = db.prepare(`
      SELECT r.* FROM recipes r
      INNER JOIN (
        SELECT recipe_group, MAX(version) mv FROM recipes GROUP BY recipe_group
      ) latest ON r.recipe_group = latest.recipe_group AND r.version = latest.mv
      ORDER BY r.created_at DESC
    `).all();
    res.json(rows);
  });

  router.get("/recipes/:group/history", (req, res) => {
    res.json(db.prepare("SELECT * FROM recipes WHERE recipe_group=? ORDER BY version ASC").all(req.params.group));
  });

  router.post("/recipes", (req, res) => {
    const { name, category, ingredients_json, instructions, prep_time, shelf_life, storage_method, recipe_group } = req.body;

    let ingredients = [];
    try { ingredients = JSON.parse(ingredients_json || "[]"); } catch (e) {}
    const totalCost = ingredients.reduce((s, ing) => s + (Number(ing.cost) || 0), 0);

    const group = recipe_group || `${name}-${Date.now()}`;
    const prevMax = db.prepare("SELECT MAX(version) mv FROM recipes WHERE recipe_group=?").get(group).mv || 0;

    const info = db.prepare(`
      INSERT INTO recipes (recipe_group, name, category, ingredients_json, unit_cost, total_cost, instructions, prep_time, shelf_life, storage_method, version)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(group, name, category || "food", JSON.stringify(ingredients), totalCost, totalCost, instructions || "", prep_time || "", shelf_life || "", storage_method || "", prevMax + 1);

    emit();
    res.json({ id: info.lastInsertRowid, recipe_group: group, version: prevMax + 1, total_cost: totalCost });
  });

  router.delete("/recipes/:id", (req, res) => {
    db.prepare("DELETE FROM recipes WHERE id=?").run(req.params.id);
    emit();
    res.json({ ok: true });
  });

  return router;
};
