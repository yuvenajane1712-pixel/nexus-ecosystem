const express = require("express");
const db = require("../db");

module.exports = function (io) {
  const router = express.Router();
  const emit = () => io.emit("data:change", { module: "crm" });

  // list with optional kind filter + A-Z search
  router.get("/", (req, res) => {
    const { kind, q } = req.query;
    let sql = "SELECT * FROM clients WHERE 1=1";
    const params = [];
    if (kind) { sql += " AND kind=?"; params.push(kind); }
    if (q) { sql += " AND name LIKE ?"; params.push(`%${q}%`); }
    sql += " ORDER BY name ASC";
    res.json(db.prepare(sql).all(...params));
  });

  router.post("/", (req, res) => {
    const { kind, name, contact, tier, trust_rating, certificates } = req.body;
    const info = db.prepare(`
      INSERT INTO clients (kind, name, contact, tier, trust_rating, certificates)
      VALUES (?,?,?,?,?,?)
    `).run(kind, name, contact || "", tier || "", trust_rating || "", certificates || "");
    emit();
    res.json({ id: info.lastInsertRowid });
  });

  router.put("/:id", (req, res) => {
    const { name, contact, tier, trust_rating, certificates } = req.body;
    db.prepare(`
      UPDATE clients SET name=?, contact=?, tier=?, trust_rating=?, certificates=? WHERE id=?
    `).run(name, contact, tier, trust_rating, certificates, req.params.id);
    emit();
    res.json({ ok: true });
  });

  router.delete("/:id", (req, res) => {
    db.prepare("DELETE FROM clients WHERE id=?").run(req.params.id);
    emit();
    res.json({ ok: true });
  });

  return router;
};
