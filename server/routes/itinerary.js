const express = require("express");
const db = require("../db");

// curated knowledge for common Guangzhou/China destinations — used to enrich AI-style itinerary output
const SPOT_GUIDE = {
  "canton tower": { scenery: "Iconic 600m TV tower with panoramic city views, especially striking at night when lit up.", food: "Try local Cantonese dim sum nearby, or the riverside food stalls along Pearl River." },
  "shamian island": { scenery: "Colonial-era European architecture, tree-lined boulevards — great for photos and a slow walk.", food: "Small French/Portuguese-influenced cafes on the island; try the local egg tarts." },
  "chimelong": { scenery: "Large theme park + safari + ocean kingdom complex — plan a full day here.", food: "Food courts inside the park; get the combo meal ticket to save time." },
  "beijing road": { scenery: "Pedestrian shopping street with a glass-covered ancient road relic visible underfoot.", food: "Street food alley just off the main strip — try the Cantonese roast goose." },
  "yuexiu park": { scenery: "Largest park in Guangzhou, home to the Five Rams sculpture and old city wall remains.", food: "Bring a picnic, or grab noodles at the park's east gate stalls." },
  "chen clan academy": { scenery: "Ornate Qing dynasty ancestral hall with intricate wood/stone carvings — a top architecture stop.", food: "Nearby old-town alley has classic Guangzhou breakfast spots (rice noodle rolls)." },
};

function guideFor(spot) {
  const key = spot.toLowerCase().trim();
  return SPOT_GUIDE[key] || { scenery: `Local sightseeing spot at ${spot} — worth a stop for photos and a walk.`, food: `Ask your guide for the nearest well-reviewed local eatery near ${spot}.` };
}

// simple 顺路 (same-route) grouping: keeps user's input order but chunks into daily legs,
// since real geographic routing needs a maps API this sandbox doesn't have access to.
function buildItinerary(destinations, days, ticketBudgetPerStop, useRideshare) {
  const stops = destinations.map((d) => d.trim()).filter(Boolean);
  const perDay = Math.max(1, Math.ceil(stops.length / days));
  const schedule = [];

  for (let day = 1; day <= days; day++) {
    const dayStops = stops.splice(0, perDay);
    if (dayStops.length === 0) break;

    const legs = [];
    for (let i = 0; i < dayStops.length; i++) {
      const guide = guideFor(dayStops[i]);
      const rideshareLeg = (useRideshare && i > 0)
        ? { from: dayStops[i - 1], to: dayStops[i], mode: "打车 (rideshare)", est_cost_idr: 30000 + i * 5000 }
        : null;
      legs.push({ stop: dayStops[i], scenery: guide.scenery, food: guide.food, rideshare: rideshareLeg });
    }

    schedule.push({
      day,
      route_note: "顺路 order — stops grouped to minimize backtracking based on the sequence you provided",
      legs,
      ticket_cost: dayStops.length * ticketBudgetPerStop,
      rideshare_total: legs.reduce((s, l) => s + (l.rideshare ? l.rideshare.est_cost_idr : 0), 0),
    });
  }

  const ticketTotal = schedule.reduce((s, d) => s + d.ticket_cost, 0);
  const rideshareTotal = schedule.reduce((s, d) => s + d.rideshare_total, 0);
  return { schedule, ticket_cost_total: ticketTotal, rideshare_total: rideshareTotal };
}

module.exports = function (io) {
  const router = express.Router();
  const emit = () => io.emit("data:change", { module: "itinerary" });

  router.post("/generate", (req, res) => {
    const { destinations, days, ticket_budget_per_stop, use_rideshare } = req.body;
    const destList = Array.isArray(destinations) ? destinations : String(destinations || "").split(",");
    const d = Number(days) || Math.max(1, Math.ceil(destList.length / 3));
    const ticketBudget = Number(ticket_budget_per_stop) || 100000;

    const result = buildItinerary(destList, d, ticketBudget, use_rideshare !== false);
    const feeTotal = d * 89000;

    const info = db.prepare(`
      INSERT INTO itineraries (destinations, days, schedule_json, ticket_cost_total, fee_total)
      VALUES (?,?,?,?,?)
    `).run(destList.join(", "), d, JSON.stringify(result.schedule), result.ticket_cost_total, feeTotal);

    emit();
    res.json({
      id: info.lastInsertRowid, days: d, schedule: result.schedule,
      ticket_cost_total: result.ticket_cost_total, rideshare_total: result.rideshare_total,
      service_fee_total: feeTotal,
      grand_total: result.ticket_cost_total + result.rideshare_total + feeTotal,
      note: "Route grouping and recommendations are rule-based from a curated local knowledge set, not a live AI call — for real generative planning, wire in an AI API key.",
    });
  });

  router.get("/", (req, res) => {
    res.json(db.prepare("SELECT * FROM itineraries ORDER BY created_at DESC").all());
  });

  return router;
};
