const express = require("express");
const db = require("../db");

module.exports = function (io) {
  const router = express.Router();

  router.get("/", (req, res) => {
    const rows = db.prepare("SELECT key, value FROM config").all();
    const obj = {};
    rows.forEach((r) => (obj[r.key] = r.value));
    res.json(obj);
  });

  router.put("/:key", (req, res) => {
    const { value } = req.body;
    db.prepare("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(req.params.key, String(value));
    io.emit("data:change", { module: "config" });
    res.json({ ok: true });
  });

  return router;
};
