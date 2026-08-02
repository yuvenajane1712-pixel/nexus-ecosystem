const express = require("express");
const db = require("../db");

// simple nearest-neighbor style ordering placeholder (no real geocoding available offline) —
// keeps destinations in the order given but groups repeated words, and estimates cost/day.
function buildItinerary(destinations, days, ticketBudgetPerStop) {
  const stops = destinations.map((d) => d.trim()).filter(Boolean);
  const perDay = Math.max(1, Math.ceil(stops.length / days));
  const schedule = [];
  for (let day = 1; day <= days; day++) {
    const dayStops = stops.splice(0, perDay);
    if (dayStops.length === 0) break;
    schedule.push({
      day,
      stops: dayStops,
      dining: `Local recommended dining near ${dayStops[dayStops.length - 1]}`,
      ticket_cost: dayStops.length * ticketBudgetPerStop,
    });
  }
  const ticketTotal = schedule.reduce((s, d) => s + d.ticket_cost, 0);
  return { schedule, ticket_cost_total: ticketTotal };
}

module.exports = function (io) {
  const router = express.Router();
  const emit = () => io.emit("data:change", { module: "itinerary" });

  router.post("/generate", (req, res) => {
    const { destinations, days, ticket_budget_per_stop } = req.body;
    const destList = Array.isArray(destinations) ? destinations : String(destinations || "").split(",");
    const d = Number(days) || Math.max(1, Math.ceil(destList.length / 3));
    const ticketBudget = Number(ticket_budget_per_stop) || 100000; // IDR default per stop

    const result = buildItinerary(destList, d, ticketBudget);
    const feeTotal = d * 89000; // 89,000 IDR/day custom itinerary service fee

    const info = db.prepare(`
      INSERT INTO itineraries (destinations, days, schedule_json, ticket_cost_total, fee_total)
      VALUES (?,?,?,?,?)
    `).run(destList.join(", "), d, JSON.stringify(result.schedule), result.ticket_cost_total, feeTotal);

    emit();
    res.json({ id: info.lastInsertRowid, days: d, schedule: result.schedule, ticket_cost_total: result.ticket_cost_total, service_fee_total: feeTotal, grand_total: result.ticket_cost_total + feeTotal });
  });

  router.get("/", (req, res) => {
    res.json(db.prepare("SELECT * FROM itineraries ORDER BY created_at DESC").all());
  });

  return router;
};
