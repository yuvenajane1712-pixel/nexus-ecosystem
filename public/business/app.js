// ===== Tab switching =====
let activeTab = "nadylan";
document.querySelectorAll(".subnav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".subnav-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
    btn.classList.add("active");
    activeTab = btn.dataset.tab;
    document.getElementById("tab-" + activeTab).classList.remove("hidden");
    loadTabData(activeTab);
  });
});

function loadTabData(tab) {
  if (tab === "nadylan") loadOrders();
  if (tab === "trackb") { loadCatalog(); loadTrackBOrders(); }
  if (tab === "crm") loadCRM();
  if (tab === "tours") loadTours();
  if (tab === "social") loadCalendar();
  if (tab === "indocha") { loadPrices(); loadRecipes(); }
  if (tab === "blockchain") loadBlockchain();
}

// ===== FAB: context-aware add button =====
document.getElementById("fabBtn").addEventListener("click", () => {
  const sheetMap = {
    nadylan: "orderSheet", tours: "tourSheet", trackb: "trackbSheet",
    crm: "crmSheet", indocha: null, blockchain: "bcSheet", social: null,
  };
  if (activeTab === "indocha") {
    const choice = prompt("Add what?\n1 = Grocery price\n2 = Recipe", "1");
    NEXUS.openSheet(choice === "2" ? "recipeSheet" : "priceSheet");
    return;
  }
  if (activeTab === "social") { alert("Use the Generate Script form above, or Auto-fill calendar."); return; }
  const target = sheetMap[activeTab];
  if (target) NEXUS.openSheet(target);
});

// =========================================================
// NADYLAN TRACK A (existing)
// =========================================================
async function refreshAll() {
  loadOrders();
  loadTours();
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
          <a class="export-link" href="/api/export/order/${o.id}/pdf" target="_blank">⬇ Export Invoice PDF</a>
        </div>
        <div style="text-align:right;">
          <div class="tag ${o.status === 'completed' ? 'income' : 'expense'}">${o.status}</div>
          <div class="meta" style="margin-top:6px;">profit ${NEXUS.fmtMoney(o.net_profit)}</div>
          ${o.status === 'open' ? `<button class="small secondary" style="margin-top:6px;" onclick="completeOrder(${o.id})">Complete</button>` : ""}
        </div>
      </div>
    `).join("");
  }
  const tours = window.__tours || [];
  computeProfitSum(orders, tours);
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
          <a class="export-link" href="/api/export/tour/${t.id}/pdf" target="_blank">⬇ Export Invoice PDF</a>
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
  const el = document.getElementById("profitSum");
  if (el) el.textContent = `${NEXUS.fmtMoney(orderProfit)} + ${NEXUS.fmtMoney(tourMargin,'IDR')}`;
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

async function completeOrder(id) { await NEXUS.put(`/api/business/orders/${id}/complete`, {}); loadOrders(); }
async function completeTour(id) { await NEXUS.put(`/api/business/tours/${id}/complete`, {}); loadTours(); }

document.getElementById("o_cost").addEventListener("input", suggestFee);
document.getElementById("o_flags").addEventListener("change", suggestFee);
async function suggestFee() {
  const orderValue = Number(document.getElementById("o_cost").value) || 0;
  const flag = document.getElementById("o_flags").value;
  const res = await NEXUS.post("/api/business/fee-suggest", {
    orderValue, isFirstTime: flag === "firsttime", isOemRebrand: flag === "oem",
  });
  document.getElementById("o_fee").value = res.pct;
}

// =========================================================
// TRACK B
// =========================================================
async function loadCatalog() {
  const catalog = await NEXUS.get("/api/trackb/catalog");
  const el = document.getElementById("catalogList");
  if (!catalog.length) { el.innerHTML = '<div class="empty">No catalog items — tap "Load default product catalog"</div>'; return; }
  const byCategory = {};
  catalog.forEach(c => { (byCategory[c.category] = byCategory[c.category] || []).push(c); });
  el.innerHTML = Object.entries(byCategory).map(([cat, items]) => `
    <div class="card">
      <h3>${cat}</h3>
      ${items.map(i => `<div class="row"><span class="label">${i.name}${i.grade ? ' ('+i.grade+')' : ''}</span><span class="val">${i.ready_stock ? '✅ ready stock' : '⏳ made to order'}</span></div>`).join("")}
    </div>
  `).join("");
}

async function seedCatalog() {
  const res = await NEXUS.post("/api/trackb/catalog/seed-defaults", {});
  if (res.skipped) alert("Catalog already has items."); else alert(`Loaded ${res.seeded} default products.`);
  loadCatalog();
}

async function loadTrackBOrders() {
  const orders = await NEXUS.get("/api/trackb/orders");
  document.getElementById("trackbOpen").textContent = orders.filter(o => o.status === 'open').length;
  const el = document.getElementById("trackbOrdersList");
  if (!orders.length) { el.innerHTML = '<div class="empty">No orders yet</div>'; return; }
  el.innerHTML = orders.map(o => `
    <div class="list-item">
      <div>
        <div><strong>${o.buyer_name}</strong> — ${o.product_summary || ""}</div>
        <div class="meta">${NEXUS.fmtDate(o.created_at)} · ${o.profit_model} model</div>
      </div>
      <div style="text-align:right;">
        <div class="tag ${o.status === 'completed' ? 'income' : 'expense'}">${o.status}</div>
        <div class="meta" style="margin-top:6px;">profit ${NEXUS.fmtMoney(o.profit)} ${o.margin_pct ? '('+o.margin_pct.toFixed(1)+'%)' : ''}</div>
        ${o.status === 'open' ? `<button class="small secondary" style="margin-top:6px;" onclick="completeTrackB(${o.id})">Complete</button>` : ""}
      </div>
    </div>
  `).join("");
}

function toggleProfitModel() {
  const mode = document.getElementById("b_model").value;
  document.getElementById("b_marginFields").classList.toggle("hidden", mode === "broker");
  document.getElementById("b_brokerFields").classList.toggle("hidden", mode !== "broker");
}

async function submitTrackB() {
  const buyer_name = document.getElementById("b_buyer").value.trim();
  const product_summary = document.getElementById("b_summary").value.trim();
  const profit_model = document.getElementById("b_model").value;
  const cost_price = document.getElementById("b_cost").value;
  const selling_price = document.getElementById("b_sell").value;
  const fee_rate = document.getElementById("b_feerate").value;
  const freight = document.getElementById("b_freight").value;
  const insurance = document.getElementById("b_insurance").value;
  const vat = document.getElementById("b_vat").value;
  const misc_fees = document.getElementById("b_misc").value;
  const payment_method = document.getElementById("b_payment").value;
  const status = document.getElementById("b_status").value;
  if (!buyer_name || !selling_price) { alert("Buyer name and selling price are required."); return; }

  await NEXUS.post("/api/trackb/orders", { buyer_name, product_summary, profit_model, fee_rate, cost_price, selling_price, freight, insurance, vat, misc_fees, payment_method, status });
  NEXUS.closeSheet("trackbSheet");
  ["b_buyer","b_summary","b_cost","b_sell","b_feerate","b_freight","b_insurance","b_vat","b_misc","b_payment"].forEach(id => document.getElementById(id).value = "");
  loadTrackBOrders();
}

async function completeTrackB(id) { await NEXUS.put(`/api/trackb/orders/${id}/complete`, {}); loadTrackBOrders(); }

// =========================================================
// CRM
// =========================================================
let crmFilter = "";
function filterCRM(kind) { crmFilter = kind; loadCRM(); }

async function loadCRM() {
  const q = document.getElementById("crm_search").value;
  const params = new URLSearchParams();
  if (crmFilter) params.set("kind", crmFilter);
  if (q) params.set("q", q);
  const list = await NEXUS.get(`/api/crm?${params.toString()}`);
  const el = document.getElementById("crmList");
  if (!list.length) { el.innerHTML = '<div class="empty">No contacts yet</div>'; return; }
  el.innerHTML = list.map(c => `
    <div class="list-item">
      <div>
        <div><strong>${c.name}</strong> <span class="mini-tag">${c.kind}</span></div>
        <div class="meta">${c.contact || ""}</div>
        <div class="meta">${c.tier ? 'Tier/rating: ' + c.tier : ''} ${c.certificates ? '· Certs: ' + c.certificates : ''}</div>
      </div>
      <button class="small secondary" onclick="deleteCRM(${c.id})">✕</button>
    </div>
  `).join("");
}

async function submitCRM() {
  const kind = document.getElementById("c_kind").value;
  const name = document.getElementById("c_name").value.trim();
  const contact = document.getElementById("c_contact").value.trim();
  const tier = document.getElementById("c_tier").value.trim();
  const certificates = document.getElementById("c_certs").value.trim();
  if (!name) { alert("Name is required."); return; }
  await NEXUS.post("/api/crm", { kind, name, contact, tier, certificates });
  NEXUS.closeSheet("crmSheet");
  ["c_name","c_contact","c_tier","c_certs"].forEach(id => document.getElementById(id).value = "");
  loadCRM();
}

async function deleteCRM(id) { await NEXUS.del(`/api/crm/${id}`); loadCRM(); }

// =========================================================
// ITINERARY GENERATOR
// =========================================================
async function generateItinerary() {
  const destinations = document.getElementById("it_destinations").value.split(",").map(s => s.trim()).filter(Boolean);
  const days = document.getElementById("it_days").value;
  if (!destinations.length) { alert("Enter at least one destination."); return; }
  const res = await NEXUS.post("/api/itinerary/generate", { destinations, days });
  const el = document.getElementById("itineraryResult");
  el.innerHTML = `
    <div class="section-title">Generated Itinerary</div>
    ${res.schedule.map(d => `
      <div class="card">
        <h3>Day ${d.day}</h3>
        <div class="meta">Stops: ${d.stops.join(" → ")}</div>
        <div class="meta">${d.dining}</div>
        <div class="row"><span class="label">Ticket cost</span><span class="val">${NEXUS.fmtMoney(d.ticket_cost,'IDR')}</span></div>
      </div>
    `).join("")}
    <div class="card">
      <div class="row"><span class="label">Ticket total</span><span class="val">${NEXUS.fmtMoney(res.ticket_cost_total,'IDR')}</span></div>
      <div class="row"><span class="label">Service fee (89K/day)</span><span class="val">${NEXUS.fmtMoney(res.service_fee_total,'IDR')}</span></div>
      <div class="row"><span class="label"><strong>Grand total</strong></span><span class="val"><strong>${NEXUS.fmtMoney(res.grand_total,'IDR')}</strong></span></div>
    </div>
  `;
}

// =========================================================
// SOCIAL MEDIA
// =========================================================
async function generateScript() {
  const account = document.getElementById("s_account").value;
  const topic = document.getElementById("s_topic").value.trim();
  if (!topic) { alert("Enter a topic."); return; }
  const res = await NEXUS.post("/api/social/generate", { account, topic });
  document.getElementById("scriptResult").innerHTML = `
    <div class="card">
      <div class="row"><span class="label">Length</span><span class="val">${res.video_length}</span></div>
      <div class="row"><span class="label">Equipment</span><span class="val">${res.equipment}</span></div>
      <div class="row"><span class="label">Best post time</span><span class="val">${res.best_time}</span></div>
      <div class="row"><span class="label">Platform</span><span class="val">${res.platforms}</span></div>
      <div class="meta" style="white-space:pre-wrap;margin-top:8px;">${res.script}</div>
    </div>
    <div class="meta" style="margin-top:6px;font-style:italic;">Note: this is a rule-based script template, not a live AI call — wire in a real AI API key for fully generative scripts.</div>
  `;
}

async function seedCalendar() {
  const res = await NEXUS.post("/api/social/posts/seed-calendar", {});
  if (res.skipped) alert("Calendar already has posts."); else alert(`Seeded ${res.seeded} posts across 6 months.`);
  loadCalendar();
}

async function loadCalendar() {
  const posts = await NEXUS.get("/api/social/posts");
  const el = document.getElementById("calendarList");
  if (!posts.length) { el.innerHTML = '<div class="empty">No posts scheduled yet</div>'; return; }
  const upcoming = posts.filter(p => p.status !== 'posted').slice(0, 20);
  el.innerHTML = upcoming.map(p => `
    <div class="list-item">
      <div>
        <div><strong>${p.post_date}</strong> — ${p.account}</div>
        <div class="meta">${p.topic}</div>
      </div>
      <button class="small secondary" onclick="markPosted(${p.id})">Mark posted</button>
    </div>
  `).join("");
}

async function markPosted(id) { await NEXUS.put(`/api/social/posts/${id}`, { status: 'posted' }); loadCalendar(); }

// =========================================================
// INDOCHA: grocery prices + recipes
// =========================================================
async function loadPrices() {
  const grouped = await NEXUS.get("/api/indocha/prices");
  const el = document.getElementById("pricesList");
  const items = Object.entries(grouped);
  if (!items.length) { el.innerHTML = '<div class="empty">No prices logged yet</div>'; return; }
  el.innerHTML = items.map(([item, list]) => `
    <div class="card">
      <h3>${item}</h3>
      ${list.map(p => `
        <div class="row">
          <span class="label">${p.channel} ${p.cheapest ? '🏆' : ''}</span>
          <span class="val">¥${p.unit_price} ${p.delivery_fee ? '+ ¥'+p.delivery_fee+' delivery' : ''}</span>
        </div>
      `).join("")}
    </div>
  `).join("");
}

async function submitPrice() {
  const item = document.getElementById("p_item").value.trim();
  const channel = document.getElementById("p_channel").value;
  const unit_price = document.getElementById("p_price").value;
  const delivery_fee = document.getElementById("p_delivery").value;
  if (!item || !unit_price) { alert("Item and price are required."); return; }
  await NEXUS.post("/api/indocha/prices", { item, channel, unit_price, delivery_fee });
  NEXUS.closeSheet("priceSheet");
  ["p_item","p_price","p_delivery"].forEach(id => document.getElementById(id).value = "");
  loadPrices();
}

async function loadRecipes() {
  const recipes = await NEXUS.get("/api/indocha/recipes");
  const el = document.getElementById("recipesList");
  if (!recipes.length) { el.innerHTML = '<div class="empty">No recipes yet</div>'; return; }
  el.innerHTML = recipes.map(r => `
    <div class="card">
      <h3>${r.name} <span class="mini-tag">${r.category} · v${r.version}</span></h3>
      <div class="meta">Total cost: ¥${r.total_cost} · Prep: ${r.prep_time || '-'} · Shelf life: ${r.shelf_life || '-'}</div>
      <div class="meta" style="margin-top:6px;">${r.instructions || ''}</div>
    </div>
  `).join("");
}

async function submitRecipe() {
  const name = document.getElementById("r_name").value.trim();
  const category = document.getElementById("r_category").value;
  const ingredientsRaw = document.getElementById("r_ingredients").value.trim();
  const instructions = document.getElementById("r_instructions").value.trim();
  const prep_time = document.getElementById("r_preptime").value.trim();
  const shelf_life = document.getElementById("r_shelflife").value.trim();
  const storage_method = document.getElementById("r_storage").value.trim();
  if (!name) { alert("Name is required."); return; }

  const ingredients = ingredientsRaw.split(",").map(part => {
    const [ing_name, cost] = part.split(":").map(s => (s || "").trim());
    return { name: ing_name, cost: Number(cost) || 0 };
  }).filter(i => i.name);

  await NEXUS.post("/api/indocha/recipes", { name, category, ingredients_json: JSON.stringify(ingredients), instructions, prep_time, shelf_life, storage_method });
  NEXUS.closeSheet("recipeSheet");
  ["r_name","r_ingredients","r_instructions","r_preptime","r_shelflife","r_storage"].forEach(id => document.getElementById(id).value = "");
  loadRecipes();
}

// =========================================================
// BLOCKCHAIN LEARNING LOG
// =========================================================
async function loadBlockchain() {
  const summary = await NEXUS.get("/api/blockchain/summary");
  document.getElementById("bcProgress").textContent = (summary.overall_progress_pct || 0).toFixed(0) + "%";
  document.getElementById("bcProgressBar").style.width = (summary.overall_progress_pct || 0) + "%";

  const entries = await NEXUS.get("/api/blockchain");
  const el = document.getElementById("bcList");
  if (!entries.length) { el.innerHTML = '<div class="empty">No entries yet</div>'; return; }
  el.innerHTML = entries.map(e => `
    <div class="list-item">
      <div>
        <div><strong>${e.title}</strong> <span class="mini-tag">${e.section}</span></div>
        <div class="meta">${e.content || ''}</div>
        <div class="meta">Progress: ${e.progress_pct}%</div>
      </div>
      <button class="small secondary" onclick="deleteBC(${e.id})">✕</button>
    </div>
  `).join("");
}

async function submitBlockchain() {
  const section = document.getElementById("bc_section").value;
  const title = document.getElementById("bc_title").value.trim();
  const content = document.getElementById("bc_content").value.trim();
  const progress_pct = document.getElementById("bc_progress").value || 0;
  if (!title) { alert("Title is required."); return; }
  await NEXUS.post("/api/blockchain", { section, title, content, progress_pct });
  NEXUS.closeSheet("bcSheet");
  ["bc_title","bc_content","bc_progress"].forEach(id => document.getElementById(id).value = "");
  loadBlockchain();
}

async function deleteBC(id) { await NEXUS.del(`/api/blockchain/${id}`); loadBlockchain(); }

// ===== init =====
NEXUS.onChange("business", refreshAll);
NEXUS.onChange("budget", refreshAll);
NEXUS.onChange("trackb", () => { if (activeTab === 'trackb') { loadCatalog(); loadTrackBOrders(); } });
NEXUS.onChange("crm", () => { if (activeTab === 'crm') loadCRM(); });
NEXUS.onChange("indocha", () => { if (activeTab === 'indocha') { loadPrices(); loadRecipes(); } });
NEXUS.onChange("blockchain", () => { if (activeTab === 'blockchain') loadBlockchain(); });
NEXUS.onChange("social", () => { if (activeTab === 'social') loadCalendar(); });

refreshAll();
