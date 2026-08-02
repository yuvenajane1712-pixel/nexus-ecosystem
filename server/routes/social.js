const express = require("express");
const db = require("../db");

const ACCOUNTS = {
  "Yuvena": { focus: ["weight loss journey", "Chinese teaching HSK9", "women's health", "song covers"], platform: "TikTok" },
  "Nadine": { focus: ["daily diet cooking", "Chinese learning HSK4", "health awareness"], platform: "Xiaohongshu" },
  "Fur Babies": { focus: ["pet daily life", "pet health", "pet fashion", "snack reviews"], platform: "Instagram" },
  "Nadylan Business": { focus: ["cross-border trade insights", "import-export knowledge"], platform: "TikTok" },
  "Guangzhou Mate": { focus: ["Guangzhou travel", "China travel", "tour services"], platform: "Douyin" },
  "Indocha Cooking": { focus: ["Indonesian recipes", "F&B prep"], platform: "YouTube" },
};

const EQUIPMENT = [
  { name: "DJI Osmo Pocket 3", best_for: ["vlog", "handheld", "walk-and-talk", "b-roll"] },
  { name: "Insta360 X5", best_for: ["360", "action", "travel", "sports"] },
  { name: "Insta360 Go 3S", best_for: ["pov", "hands-free", "pet", "quick clips"] },
  { name: "Insta360 Ace Pro 2", best_for: ["action", "outdoor", "cooking overhead"] },
  { name: "GoPro Hero Max 360", best_for: ["extreme", "360", "sports"] },
  { name: "Sony A7S3", best_for: ["cinematic", "low light", "interview", "studio"] },
  { name: "Sony A6400", best_for: ["talking head", "static shot", "product shot"] },
  { name: "iPhone 16 Pro Max", best_for: ["quick", "everyday", "story", "spontaneous"] },
  { name: "DJI Microphone (x2)", best_for: ["interview", "talking head", "voiceover"] },
];

function matchEquipment(topic) {
  const t = topic.toLowerCase();
  const scored = EQUIPMENT.map((e) => ({
    ...e,
    score: e.best_for.filter((tag) => t.includes(tag.split(" ")[0])).length,
  }));
  scored.sort((a, b) => b.score - a.score);
  const picks = scored.filter((s) => s.score > 0).slice(0, 2);
  if (picks.length === 0) return ["iPhone 16 Pro Max", "DJI Microphone (x2)"];
  return picks.map((p) => p.name);
}

function bestPostingTime(platform) {
  const times = {
    TikTok: "7:00–9:00 PM local time",
    Instagram: "12:00–1:00 PM or 7:00–9:00 PM",
    Douyin: "8:00–10:00 PM (China peak)",
    Xiaohongshu: "8:00–10:00 PM",
    YouTube: "2:00–4:00 PM (allow indexing before evening peak)",
  };
  return times[platform] || "7:00–9:00 PM";
}

function generateScript(account, topic) {
  const acct = ACCOUNTS[account] || { focus: [], platform: "TikTok" };
  const equipment = matchEquipment(topic);
  const length = topic.toLowerCase().includes("tutorial") || topic.toLowerCase().includes("recipe") ? "60–90 sec" : "20–35 sec";
  const script = [
    `HOOK (0-3s): Open on a strong visual tied to "${topic}" — jump straight into the moment, no intro speech.`,
    `SETUP (3-10s): One sentence of context — why this matters to your audience (${acct.focus[0] || "your niche"}).`,
    `BODY (10-${length.includes("60") ? "70" : "25"}s): 3 quick beats — show, don't just tell. Cut every 2-3 seconds to keep pace.`,
    `PAYOFF: Land on the single takeaway or result. Text overlay reinforcing the key point.`,
    `CTA (last 3s): Ask a specific question tied to "${topic}" to drive comments, or point to a saved/pinned resource.`,
  ].join("\n");

  return {
    script,
    equipment: equipment.join(", "),
    video_length: length,
    best_time: bestPostingTime(acct.platform),
    platforms: acct.platform,
  };
}

module.exports = function (io) {
  const router = express.Router();
  const emit = () => io.emit("data:change", { module: "social" });

  router.get("/accounts", (req, res) => res.json(ACCOUNTS));

  router.post("/generate", (req, res) => {
    const { account, topic } = req.body;
    if (!account || !topic) return res.status(400).json({ error: "account and topic required" });
    const result = generateScript(account, topic);
    res.json(result);
  });

  router.get("/posts", (req, res) => {
    const { account } = req.query;
    let sql = "SELECT * FROM social_posts WHERE 1=1";
    const params = [];
    if (account) { sql += " AND account=?"; params.push(account); }
    sql += " ORDER BY post_date ASC";
    res.json(db.prepare(sql).all(...params));
  });

  router.post("/posts", (req, res) => {
    const { account, post_date, topic, script, equipment, video_length, best_time, platforms } = req.body;
    const info = db.prepare(`
      INSERT INTO social_posts (account, post_date, topic, script, equipment, video_length, best_time, platforms)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(account, post_date, topic, script || "", equipment || "", video_length || "", best_time || "", platforms || "");
    emit();
    res.json({ id: info.lastInsertRowid });
  });

  router.put("/posts/:id", (req, res) => {
    const { post_date, topic, status } = req.body;
    const fields = [];
    const params = [];
    if (post_date) { fields.push("post_date=?"); params.push(post_date); }
    if (topic) { fields.push("topic=?"); params.push(topic); }
    if (status) { fields.push("status=?"); params.push(status); }
    params.push(req.params.id);
    db.prepare(`UPDATE social_posts SET ${fields.join(", ")} WHERE id=?`).run(...params);
    emit();
    res.json({ ok: true });
  });

  router.delete("/posts/:id", (req, res) => {
    db.prepare("DELETE FROM social_posts WHERE id=?").run(req.params.id);
    emit();
    res.json({ ok: true });
  });

  // auto-fill a 6-month calendar: 1 post/account/day with rotating topics from that account's focus areas
  router.post("/posts/seed-calendar", (req, res) => {
    const existing = db.prepare("SELECT COUNT(*) c FROM social_posts").get().c;
    if (existing > 0) return res.json({ skipped: true, existing });

    const stmt = db.prepare(`
      INSERT INTO social_posts (account, post_date, topic, script, equipment, video_length, best_time, platforms)
      VALUES (?,?,?,?,?,?,?,?)
    `);
    const start = new Date();
    let count = 0;
    for (let d = 0; d < 182; d++) {
      const date = new Date(start);
      date.setDate(date.getDate() + d);
      const dateStr = date.toISOString().slice(0, 10);
      Object.entries(ACCOUNTS).forEach(([account, meta]) => {
        const topic = meta.focus[d % meta.focus.length];
        const gen = generateScript(account, topic);
        stmt.run(account, dateStr, topic, gen.script, gen.equipment, gen.video_length, gen.best_time, gen.platforms);
        count++;
      });
    }
    emit();
    res.json({ seeded: count });
  });

  return router;
};
