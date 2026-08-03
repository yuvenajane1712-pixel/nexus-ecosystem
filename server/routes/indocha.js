const express = require("express");
const db = require("../db");

module.exports = function (io) {
  const router = express.Router();
  const emit = () => io.emit("data:change", { module: "indocha" });

  // ---- Grocery price comparison — normalized per 100g, with a clear conclusion ----
  router.get("/prices", (req, res) => {
    const rows = db.prepare("SELECT * FROM grocery_prices ORDER BY item").all();
    const byItem = {};
    rows.forEach((r) => {
      const totalCost = (r.total_price || 0) + (r.delivery_fee || 0);
      const per100g = r.total_weight_g > 0 ? (totalCost / r.total_weight_g) * 100 : null;
      if (!byItem[r.item]) byItem[r.item] = [];
      byItem[r.item].push({ ...r, price_per_100g: per100g ? Math.round(per100g * 100) / 100 : null });
    });
    const result = {};
    Object.entries(byItem).forEach(([item, list]) => {
      list.sort((a, b) => (a.price_per_100g ?? Infinity) - (b.price_per_100g ?? Infinity));
      list.forEach((r, i) => (r.cheapest = i === 0 && r.price_per_100g !== null));
      const cheapest = list.find((r) => r.cheapest);
      result[item] = {
        entries: list,
        conclusion: cheapest ? `${cheapest.channel} is cheaper at ¥${cheapest.price_per_100g}/100g` : "Not enough data yet",
      };
    });
    res.json(result);
  });

  router.post("/prices", (req, res) => {
    const { item, channel, total_weight_g, total_price, delivery_fee } = req.body;
    const info = db.prepare(`
      INSERT INTO grocery_prices (item, channel, total_weight_g, total_price, delivery_fee, unit_price)
      VALUES (?,?,?,?,?,?)
    `).run(item, channel, Number(total_weight_g) || 0, Number(total_price) || 0, Number(delivery_fee) || 0, Number(total_price) || 0);
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
