let sheetChoice = "order";

document.getElementById("fabBtn").addEventListener("click", () => {
  // simple toggle: tap once for order, long-press-ish alt not needed — use confirm-style quick menu
  const choice = prompt("Add what?\n1 = New Order\n2 = New Tour", "1");
  if (choice === "2") NEXUS.openSheet("tourSheet");
  else NEXUS.openSheet("orderSheet");
});

document.getElementById("t_type").addEventListener("change", (e) => {
  document.getElementById("t_qtyLabel").textContent = e.target.value === "bigbus" ? "Pax count" : "Number of days";
});

async function refreshAll() {
  await Promise.all([loadOrders(), loadTours()]);
}

async function loadOrders() {
  const orders = await NEXUS.get("/api/business/orders");
  const el = document.getElementById("ordersList");
  const open = orders.filter(o => o.status === "open").length;
  document.getElementById("openOrders").textContent = open;

  if (!orders.length) { el.innerHTML = '<div class="empty">No orders yet</div>'; }
  else {
    el.innerHTML = orders.map(o => `
      <div class="list-item">
        <div>
          <div><strong>${o.buyer_name}</strong> — ${o.product_summary || ""}</div>
          <div class="meta">${NEXUS.fmtDate(o.created_at)} · fee ${o.fee_pct}% · total ${NEXUS.fmtMoney(o.total_payment)}</div>
        </div>
        <div style="text-align:right;">
          <div class="tag ${o.status === 'completed' ? 'income' : 'expense'}">${o.status}</div>
          <div class="meta" style="margin-top:6px;">profit ${NEXUS.fmtMoney(o.net_profit)}</div>
          ${o.status === 'open' ? `<button class="small secondary" style="margin-top:6px;" onclick="completeOrder(${o.id})">Complete</button>` : ""}
        </div>
      </div>
    `).join("");
  }
  computeProfitSum(orders, window.__tours || []);
}

async function loadTours() {
  const tours = await NEXUS.get("/api/business/tours");
  window.__tours = tours;
  const el = document.getElementById("toursList");
  const open = tours.filter(t => t.status === "open").length;
  document.getElementById("openTours").textContent = open;

  if (!tours.length) { el.innerHTML = '<div class="empty">No tours yet</div>'; }
  else {
    el.innerHTML = tours.map(t => `
      <div class="list-item">
        <div>
          <div><strong>${t.tier_name}</strong></div>
          <div class="meta">${NEXUS.fmtDate(t.created_at)} · rev ${NEXUS.fmtMoney(t.revenue,'IDR')}</div>
        </div>
        <div style="text-align:right;">
          <div class="tag ${t.status === 'completed' ? 'income' : 'expense'}">${t.status}</div>
          <div class="meta" style="margin-top:6px;">margin ${NEXUS.fmtMoney(t.margin,'IDR')}</div>
          ${t.status === 'open' ? `<button class="small secondary" style="margin-top:6px;" onclick="completeTour(${t.id})">Complete</button>` : ""}
        </div>
      </div>
    `).join("");
  }
  const orders = await NEXUS.get("/api/business/orders");
  computeProfitSum(orders, tours);
}

function computeProfitSum(orders, tours) {
  const orderProfit = orders.filter(o => o.status === 'completed').reduce((s,o) => s + o.net_profit, 0);
  const tourMargin = tours.filter(t => t.status === 'completed').reduce((s,t) => s + t.margin, 0);
  document.getElementById("profitSum").textContent = `${NEXUS.fmtMoney(orderProfit)} + ${NEXUS.fmtMoney(tourMargin,'IDR')}`;
}

async function submitOrder() {
  const buyer_name = document.getElementById("o_buyer").value.trim();
  const product_summary = document.getElementById("o_summary").value.trim();
  const product_cost = document.getElementById("o_cost").value;
  const fee_pct = document.getElementById("o_fee").value || 10;
  const logistics_cost = document.getElementById("o_logistics").value || 0;
  const urgency = document.getElementById("o_urgency").value || 1;
  const status = document.getElementById("o_status").value;
  if (!buyer_name || !product_cost) { alert("Buyer name and product cost are required."); return; }

  await NEXUS.post("/api/business/orders", { buyer_name, product_summary, product_cost, fee_pct, logistics_cost, urgency, status });
  NEXUS.closeSheet("orderSheet");
  ["o_buyer","o_summary","o_cost","o_fee","o_logistics"].forEach(id => document.getElementById(id).value = "");
  loadOrders();
}

async function submitTour() {
  const tour_type = document.getElementById("t_type").value;
  const [tier_name, price_per_unit] = document.getElementById("t_tier").value.split("|");
  const pax_or_days = document.getElementById("t_qty").value;
  const cost = document.getElementById("t_cost").value;
  const status = document.getElementById("t_status").value;
  if (!pax_or_days || !cost) { alert("Pax/days and cost are required."); return; }

  await NEXUS.post("/api/business/tours", { tour_type, tier_name, pax_or_days, price_per_unit, cost, status });
  NEXUS.closeSheet("tourSheet");
  document.getElementById("t_qty").value = "";
  document.getElementById("t_cost").value = "";
  loadTours();
}

async function completeOrder(id) {
  await NEXUS.put(`/api/business/orders/${id}/complete`, {});
  loadOrders();
}
async function completeTour(id) {
  await NEXUS.put(`/api/business/tours/${id}/complete`, {});
  loadTours();
}

// auto-suggest fee % as cost/flags change
document.getElementById("o_cost").addEventListener("input", suggestFee);
document.getElementById("o_flags").addEventListener("change", suggestFee);
async function suggestFee() {
  const orderValue = Number(document.getElementById("o_cost").value) || 0;
  const flag = document.getElementById("o_flags").value;
  const res = await NEXUS.post("/api/business/fee-suggest", {
    orderValue,
    isFirstTime: flag === "firsttime",
    isOemRebrand: flag === "oem",
  });
  document.getElementById("o_fee").value = res.pct;
}

NEXUS.onChange("business", refreshAll);
NEXUS.onChange("budget", refreshAll);
refreshAll();
