const express = require("express");
const db = require("../db");

module.exports = function (io) {
  const router = express.Router();
  const emit = () => io.emit("data:change", { module: "blockchain" });

  router.get("/", (req, res) => {
    res.json(db.prepare("SELECT * FROM blockchain_log ORDER BY created_at DESC").all());
  });

  router.post("/", (req, res) => {
    const { section, title, content, progress_pct } = req.body;
    const info = db.prepare("INSERT INTO blockchain_log (section, title, content, progress_pct) VALUES (?,?,?,?)")
      .run(section || "notes", title || "", content || "", Number(progress_pct) || 0);
    emit();
    res.json({ id: info.lastInsertRowid });
  });

  router.put("/:id", (req, res) => {
    const { title, content, progress_pct } = req.body;
    db.prepare("UPDATE blockchain_log SET title=?, content=?, progress_pct=? WHERE id=?")
      .run(title, content, Number(progress_pct) || 0, req.params.id);
    emit();
    res.json({ ok: true });
  });

  router.delete("/:id", (req, res) => {
    db.prepare("DELETE FROM blockchain_log WHERE id=?").run(req.params.id);
    emit();
    res.json({ ok: true });
  });

  // overall progress = average of all entries' progress_pct
  router.get("/summary", (req, res) => {
    const row = db.prepare("SELECT AVG(progress_pct) avg_pct, COUNT(*) c FROM blockchain_log").get();
    res.json({ overall_progress_pct: row.avg_pct || 0, entry_count: row.c });
  });

  return router;
};
