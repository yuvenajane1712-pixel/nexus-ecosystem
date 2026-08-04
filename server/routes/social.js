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

const EQUIPMENT_LIST = [
  "DJI Osmo Pocket 3", "Insta360 X5", "Insta360 Go 3S", "Insta360 Ace Pro 2",
  "GoPro Hero Max 360", "Sony A7S3", "Sony A6400", "iPhone 16 Pro Max", "DJI Microphone (x2)",
];

const PLATFORMS = ["TikTok", "Instagram", "Douyin", "Xiaohongshu", "YouTube"];

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

// script templates authored per language — structure is the same, wording is native to each language,
// NOT a live translation call (no AI API wired in)
const TEMPLATES = {
  en: (topic, niche, platform, duration) => [
    `HOOK (0-3s): Open on a strong visual tied to "${topic}" — jump straight into the moment, no intro speech.`,
    `SETUP (3-10s): One sentence of context — why this matters to your audience (${niche}).`,
    `BODY (10s-${duration}): 3 quick beats — show, don't just tell. Cut every 2-3 seconds to keep pace.`,
    `PAYOFF: Land on the single takeaway or result. Text overlay reinforcing the key point.`,
    `CTA (last 3s): Ask a specific question tied to "${topic}" to drive comments, or point to a saved/pinned resource.`,
    ``,
    `Thumbnail/poster text: bold 3-5 word hook related to "${topic}"`,
    `Filming style: fast cuts, handheld movement, natural light, face-to-camera for the hook`,
    `Best time to post on ${platform}: ${bestPostingTime(platform)}`,
  ].join("\n"),
  zh: (topic, niche, platform, duration) => [
    `钩子 (0-3秒)：直接展示与"${topic}"相关的强视觉画面，不要用开场白。`,
    `铺垫 (3-10秒)：用一句话说明为什么这对你的观众(${niche})很重要。`,
    `正文 (10秒-${duration})：3个快节奏片段——用画面说话，每2-3秒切一次镜头。`,
    `结果：落到一个核心收获或结果上，用文字叠加强调重点。`,
    `行动号召 (最后3秒)：针对"${topic}"提一个具体问题引导评论，或引导保存/置顶资源。`,
    ``,
    `封面/缩略图文字：与"${topic}"相关的3-5个字强钩子`,
    `拍摄风格：快节奏剪辑、手持运镜、自然光、开头面对镜头说话`,
    `${platform}最佳发布时间：${bestPostingTime(platform)}`,
  ].join("\n"),
  id: (topic, niche, platform, duration) => [
    `HOOK (0-3 dtk): Mulai dengan visual kuat terkait "${topic}" — langsung ke intinya, tanpa basa-basi.`,
    `SETUP (3-10 dtk): Satu kalimat konteks — kenapa ini penting buat audiens kamu (${niche}).`,
    `ISI (10 dtk-${duration}): 3 beat cepat — tunjukkan, jangan cuma cerita. Potong setiap 2-3 detik biar ritmenya cepat.`,
    `HASIL: Tutup dengan satu poin utama atau hasil. Tambahkan teks di layar untuk menegaskan poin itu.`,
    `CTA (3 dtk terakhir): Tanyakan sesuatu yang spesifik soal "${topic}" biar orang komen, atau arahkan ke konten tersimpan/pin.`,
    ``,
    `Teks thumbnail/poster: 3-5 kata hook terkait "${topic}"`,
    `Gaya syuting: potongan cepat, kamera handheld, cahaya natural, hadap kamera saat hook`,
    `Waktu terbaik posting di ${platform}: ${bestPostingTime(platform)}`,
  ].join("\n"),
};

function generateScript({ account, topic, duration_sec, equipment, platform, language }) {
  const acct = ACCOUNTS[account] || { focus: [], platform: "TikTok" };
  const niche = acct.focus[0] || "your niche";
  const dur = duration_sec ? `${duration_sec}s` : "30s";
  const plat = platform || acct.platform;
  const lang = TEMPLATES[language] ? language : "en";
  const script = TEMPLATES[lang](topic, niche, plat, dur);

  return {
    script,
    equipment: (equipment && equipment.length) ? equipment.join(", ") : "iPhone 16 Pro Max, DJI Microphone (x2)",
    video_length: dur,
    best_time: bestPostingTime(plat),
    platforms: plat,
    language: lang,
  };
}

module.exports = function (io) {
  const router = express.Router();
  const emit = () => io.emit("data:change", { module: "social" });

  router.get("/accounts", (req, res) => res.json(ACCOUNTS));
  router.get("/equipment-list", (req, res) => res.json(EQUIPMENT_LIST));
  router.get("/platforms", (req, res) => res.json(PLATFORMS));

  router.post("/generate", (req, res) => {
    const { account, topic, duration_sec, equipment, platform, language } = req.body;
    if (!account || !topic) return res.status(400).json({ error: "account and topic required" });
    const result = generateScript({ account, topic, duration_sec, equipment, platform, language });
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
        const gen = generateScript({ account, topic, platform: meta.platform, language: "en" });
        stmt.run(account, dateStr, topic, gen.script, gen.equipment, gen.video_length, gen.best_time, gen.platforms);
        count++;
      });
    }
    emit();
    res.json({ seeded: count });
  });

  return router;
};
