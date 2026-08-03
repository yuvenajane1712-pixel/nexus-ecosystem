const express = require("express");
const db = require("../db");

module.exports = function (io) {
  const router = express.Router();
  const emit = () => io.emit("data:change", { module: "supplements" });

  // list supplements for an owner (person or pet), with today's checklist status
  router.get("/:ownerType/:ownerName", (req, res) => {
    const { ownerType, ownerName } = req.params;
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const items = db.prepare("SELECT * FROM supplement_items WHERE owner_type=? AND owner_name=? ORDER BY name").all(ownerType, decodeURIComponent(ownerName));
    const checks = db.prepare("SELECT * FROM supplement_checklist WHERE log_date=?").all(date);
    items.forEach((i) => {
      const c = checks.find((c) => c.supplement_id === i.id);
      i.taken_today = c ? !!c.taken : false;
    });
    res.json(items);
  });

  router.post("/", (req, res) => {
    const { owner_type, owner_name, name, portion } = req.body;
    if (!owner_type || !owner_name || !name) return res.status(400).json({ error: "owner_type, owner_name, name required" });
    const info = db.prepare("INSERT INTO supplement_items (owner_type, owner_name, name, portion) VALUES (?,?,?,?)")
      .run(owner_type, owner_name, name, portion || "");
    emit();
    res.json({ id: info.lastInsertRowid });
  });

  router.delete("/:id", (req, res) => {
    db.prepare("DELETE FROM supplement_checklist WHERE supplement_id=?").run(req.params.id);
    db.prepare("DELETE FROM supplement_items WHERE id=?").run(req.params.id);
    emit();
    res.json({ ok: true });
  });

  router.put("/:id/check", (req, res) => {
    const { taken, date } = req.body;
    const logDate = date || new Date().toISOString().slice(0, 10);
    db.prepare(`
      INSERT INTO supplement_checklist (supplement_id, log_date, taken) VALUES (?,?,?)
      ON CONFLICT(supplement_id, log_date) DO UPDATE SET taken=excluded.taken
    `).run(req.params.id, logDate, taken ? 1 : 0);
    emit();
    res.json({ ok: true });
  });

  return router;
};
