const express = require("express");
const db = require("../db");

module.exports = function (io) {
  const router = express.Router();
  const emit = () => io.emit("data:change", { module: "bank_accounts" });

  router.get("/", (req, res) => {
    res.json(db.prepare("SELECT * FROM bank_accounts ORDER BY created_at DESC").all());
  });

  router.post("/", (req, res) => {
    const { bank_name, account_name, account_number } = req.body;
    if (!bank_name || !account_number) return res.status(400).json({ error: "bank_name and account_number required" });
    const info = db.prepare("INSERT INTO bank_accounts (bank_name, account_name, account_number) VALUES (?,?,?)")
      .run(bank_name, account_name || "", account_number);
    emit();
    res.json({ id: info.lastInsertRowid });
  });

  router.delete("/:id", (req, res) => {
    db.prepare("DELETE FROM bank_accounts WHERE id=?").run(req.params.id);
    emit();
    res.json({ ok: true });
  });

  return router;
};
