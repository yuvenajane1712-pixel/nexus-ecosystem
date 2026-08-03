const express = require("express");
const db = require("../db");

module.exports = function (io) {
  const router = express.Router();
  const emit = () => io.emit("data:change", { module: "crm" });

  router.get("/", (req, res) => {
    const { kind, q } = req.query;
    let sql = "SELECT * FROM clients WHERE 1=1";
    const params = [];
    if (kind) { sql += " AND kind=?"; params.push(kind); }
    if (q) { sql += " AND (company_name LIKE ? OR person_name LIKE ? OR name LIKE ?)"; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    sql += " ORDER BY COALESCE(company_name, name) ASC";
    const rows = db.prepare(sql).all(...params);
    const certs = db.prepare("SELECT * FROM client_certificates").all();
    rows.forEach((r) => { r.certificates_list = certs.filter((c) => c.client_id === r.id); });
    res.json(rows);
  });

  router.post("/", (req, res) => {
    const { kind, company_name, person_name, whatsapp, wechat, phone, address, alibaba_link, tier } = req.body;
    const displayName = company_name || person_name || "Unnamed";
    const info = db.prepare(`
      INSERT INTO clients (kind, name, company_name, person_name, whatsapp, wechat, phone, address, alibaba_link, tier)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(kind, displayName, company_name || "", person_name || "", whatsapp || "", wechat || "", phone || "", address || "", alibaba_link || "", tier || "");
    emit();
    res.json({ id: info.lastInsertRowid });
  });

  router.put("/:id", (req, res) => {
    const { company_name, person_name, whatsapp, wechat, phone, address, alibaba_link, tier } = req.body;
    const displayName = company_name || person_name || "Unnamed";
    db.prepare(`
      UPDATE clients SET name=?, company_name=?, person_name=?, whatsapp=?, wechat=?, phone=?, address=?, alibaba_link=?, tier=? WHERE id=?
    `).run(displayName, company_name, person_name, whatsapp, wechat, phone, address, alibaba_link, tier, req.params.id);
    emit();
    res.json({ ok: true });
  });

  router.delete("/:id", (req, res) => {
    db.prepare("DELETE FROM client_certificates WHERE client_id=?").run(req.params.id);
    db.prepare("DELETE FROM clients WHERE id=?").run(req.params.id);
    emit();
    res.json({ ok: true });
  });

  // ---- unlimited certificates per contact ----
  router.post("/:id/certificates", (req, res) => {
    const { cert_name } = req.body;
    if (!cert_name) return res.status(400).json({ error: "cert_name required" });
    const info = db.prepare("INSERT INTO client_certificates (client_id, cert_name) VALUES (?,?)").run(req.params.id, cert_name);
    emit();
    res.json({ id: info.lastInsertRowid });
  });

  router.delete("/:id/certificates/:certId", (req, res) => {
    db.prepare("DELETE FROM client_certificates WHERE id=?").run(req.params.certId);
    emit();
    res.json({ ok: true });
  });

  return router;
};
