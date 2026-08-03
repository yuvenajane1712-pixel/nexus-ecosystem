// ===== Tab switching (tap-to-choose dropdown) =====
let activeTab = "nadylan";
document.getElementById("moduleSelect").addEventListener("change", (e) => {
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
  activeTab = e.target.value;
  document.getElementById("tab-" + activeTab).classList.remove("hidden");
  loadTabData(activeTab);
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

// ===== FAB: opens the right sheet, using a real tap-to-choose menu where more than one action exists =====
function openActionSheet(options) {
  const el = document.getElementById("actionSheetOptions");
  el.innerHTML = options.map((o, i) => `<button class="action-option" onclick="actionChosen(${i})">${o.label}</button>`).join("");
  window.__actionOptions = options;
  NEXUS.openSheet("actionSheet");
}
function actionChosen(i) {
  NEXUS.closeSheet("actionSheet");
  window.__actionOptions[i].onSelect();
}

document.getElementById("fabBtn").addEventListener("click", () => {
  const sheetMap = {
    nadylan: "orderSheet", tours: "tourSheet", trackb: "trackbSheet",
    crm: "crmSheet", blockchain: "bcSheet",
  };
  if (activeTab === "indocha") {
    openActionSheet([
      { label: "🛒 Log a grocery price", onSelect: () => NEXUS.openSheet("priceSheet") },
      { label: "📖 Add a recipe", onSelect: () => NEXUS.openSheet("recipeSheet") },
    ]);
    return;
  }
  if (activeTab === "social") { alert("Use the Generate Script form above, or Auto-fill calendar."); return; }
  const target = sheetMap[activeTab];
  if (target) NEXUS.openSheet(target);
});

// =========================================================
// NADYLAN TRACK A — item-based orders, 7-stage pipeline, logistics, tracking code
// =========================================================
const PIPELINE = [
  { key: "lagi_dicari", label: "Lagi Dicari" },
  { key: "sudah_ketemu", label: "Sudah Ketemu" },
  { key: "sudah_bayar", label: "Sudah Bayar" },
  { key: "sampai_cn_warehouse", label: "Sampai di China Warehouse" },
  { key: "sudah_dikirim", label: "Sudah Dikirim" },
  { key: "sampai_id_warehouse", label: "Sampai di Warehouse Indonesia" },
  { key: "sampai_tujuan", label: "Sampai Tempat Tujuan" },
];
function pipelineIndex(key) { return Math.max(0, PIPELINE.findIndex(p => p.key === key)); }

async function refreshAll() {
  loadOrders();
  loadTours();
  loadFxRate();
}

async function loadFxRate() {
  const cfg = await NEXUS.get("/api/config");
  document.getElementById("fx_current").textContent = cfg.fx_rate_idr_per_rmb;
  document.getElementById("fx_rate_input").placeholder = cfg.fx_rate_idr_per_rmb;
}

async function updateFxRate() {
  const val = document.getElementById("fx_rate_input").value;
  if (!val) { alert("Enter today's rate."); return; }
  await NEXUS.put("/api/config/fx_rate_idr_per_rmb", { value: val });
  document.getElementById("fx_rate_input").value = "";
  loadFxRate();
}

async function loadOrders() {
  const orders = await NEXUS.get("/api/business/orders");
  const el = document.getElementById("ordersList");
  const open = orders.filter(o => o.pipeline_status !== "sampai_tujuan").length;
  document.getElementById("openOrders").textContent = open;

  if (!orders.length) { el.innerHTML = '<div class="empty">No orders yet</div>'; }
  else {
    el.innerHTML = orders.map(renderOrderCard).join("");
  }
  const tours = window.__tours || [];
  computeProfitSum(orders, tours);
}

function renderOrderCard(o) {
  const stIdx = pipelineIndex(o.pipeline_status || "lagi_dicari");
  const itemsHtml = (o.items || []).map(i => `
    <div class="item-card">
      ${i.photo_data ? `<img class="item-thumb" src="${i.photo_data}" />` : `<div class="item-thumb"></div>`}
      <div class="item-info">
        <div class="name">${i.name}${i.spec ? ' — ' + i.spec : ''}</div>
        <div class="meta2">qty ${i.qty} × ${i.currency === 'IDR' ? NEXUS.fmtMoney(i.unit_price,'IDR') : NEXUS.fmtMoney(i.unit_price)} <span class="mini-tag">${i.currency || 'RMB'}</span> · CBM ${i.cbm}</div>
      </div>
      <button class="small secondary" onclick="deleteItem(${o.id},${i.id})">✕</button>
    </div>
  `).join("") || '<div class="empty">No products added yet</div>';

  return `
    <div class="order-card">
      <div class="order-head">
        <div>
          <strong>${o.buyer_name}</strong>
          <div class="meta">${NEXUS.fmtDate(o.created_at)} · fee ${o.fee_pct}%</div>
        </div>
        <button class="small secondary" onclick="deleteOrder(${o.id})">🗑 Delete</button>
      </div>

      <select class="status-select st-${stIdx}" onchange="updateStatus(${o.id}, this.value)">
        ${PIPELINE.map(p => `<option value="${p.key}" ${p.key === o.pipeline_status ? 'selected' : ''}>${p.label}</option>`).join("")}
      </select>

      <div class="section-title" style="margin:12px 0 6px;">Products</div>
      ${itemsHtml}
      <button class="small secondary" onclick="openItemSheet(${o.id})">+ Add Product</button>

      <div class="section-title" style="margin:12px 0 6px;">Logistics</div>
      <div class="grid2">
        <div><label>Rate / CBM (RMB)</label><input type="number" value="${o.logistics_rate_per_cbm || 0}" onchange="updateLogistics(${o.id})" id="lr_${o.id}" /></div>
        <div><label>Total CBM</label><input type="number" value="${o.cbm_total || 0}" disabled /></div>
      </div>
      <div class="grid2">
        <div><label>Supplier → China warehouse (RMB)</label><input type="number" value="${o.logistics_supplier_to_cn || 0}" onchange="updateLogistics(${o.id})" id="ls_${o.id}" /></div>
        <div><label>ID warehouse → Buyer (RMB)</label><input type="number" value="${o.logistics_id_to_buyer || 0}" onchange="updateLogistics(${o.id})" id="lb_${o.id}" /></div>
      </div>

      <div class="card" style="margin-top:10px;">
        <div class="row"><span class="label">Product cost</span><span class="val">${NEXUS.fmtMoney(o.product_cost)} <span class="meta">(${NEXUS.fmtMoney(o.product_cost*o.fx_rate,'IDR')})</span></span></div>
        <div class="row"><span class="label">Logistics cost</span><span class="val">${NEXUS.fmtMoney(o.logistics_cost)} <span class="meta">(${NEXUS.fmtMoney(o.logistics_cost*o.fx_rate,'IDR')})</span></span></div>
        <div class="row"><span class="label">Service fee</span><span class="val">${NEXUS.fmtMoney(o.service_fee)} <span class="meta">(${NEXUS.fmtMoney(o.service_fee*o.fx_rate,'IDR')})</span></span></div>
        <div class="row"><span class="label"><strong>Total payment</strong></span><span class="val"><strong>${NEXUS.fmtMoney(o.total_payment)}</strong><br><span class="meta">${NEXUS.fmtMoney(o.total_payment*o.fx_rate,'IDR')}</span></span></div>
        <div class="row"><span class="label">Net profit</span><span class="val" style="color:#1E8449;">${NEXUS.fmtMoney(o.net_profit)} <span class="meta">(${NEXUS.fmtMoney(o.net_profit*o.fx_rate,'IDR')})</span></span></div>
        <div class="meta" style="margin-top:6px;">Locked rate: 1 RMB = ${o.fx_rate} IDR</div>
      </div>

      <label style="margin-top:10px;">Tracking code</label>
      <input class="tracking-input" value="${o.tracking_code || ''}" placeholder="e.g. NX-2026-0001" onchange="updateTracking(${o.id}, this.value)" />

      <a class="export-link" href="/api/export/order/${o.id}/pdf" target="_blank">⬇ Export Invoice PDF</a>
    </div>
  `;
}

async function updateStatus(orderId, val) { await NEXUS.put(`/api/business/orders/${orderId}/status`, { pipeline_status: val }); loadOrders(); }
async function updateTracking(orderId, val) { await NEXUS.put(`/api/business/orders/${orderId}/tracking`, { tracking_code: val }); }
async function updateLogistics(orderId) {
  const logistics_rate_per_cbm = document.getElementById(`lr_${orderId}`).value;
  const logistics_supplier_to_cn = document.getElementById(`ls_${orderId}`).value;
  const logistics_id_to_buyer = document.getElementById(`lb_${orderId}`).value;
  await NEXUS.put(`/api/business/orders/${orderId}/logistics`, { logistics_rate_per_cbm, logistics_supplier_to_cn, logistics_id_to_buyer });
  loadOrders();
}
async function deleteOrder(orderId) {
  if (!confirm("Delete this order and all its products?")) return;
  await NEXUS.del(`/api/business/orders/${orderId}`);
  loadOrders();
}
async function deleteItem(orderId, itemId) { await NEXUS.del(`/api/business/orders/${orderId}/items/${itemId}`); loadOrders(); }

function toggleCategoryFields() {
  const cat = document.getElementById("i_category").value;
  document.getElementById("i_techFields").classList.toggle("hidden", cat !== "tech");
  document.getElementById("i_apparelFields").classList.toggle("hidden", cat !== "apparel");
  document.getElementById("i_generalFields").classList.toggle("hidden", cat !== "general");
}

function openItemSheet(orderId) {
  document.getElementById("i_orderId").value = orderId;
  ["i_name","i_price","i_cbm","i_tech_params","i_tech_model","i_tech_variant","i_apparel_size","i_apparel_color","i_apparel_material","i_general_grade","i_general_moq","i_general_volume"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("i_qty").value = 1;
  document.getElementById("i_category").value = "tech";
  toggleCategoryFields();
  document.getElementById("i_photoPreview").style.display = "none";
  window.__itemPhotoData = null;
  NEXUS.openSheet("itemSheet");
}

function previewItemPhoto() {
  const file = document.getElementById("i_photo").files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    window.__itemPhotoData = e.target.result;
    const img = document.getElementById("i_photoPreview");
    img.src = e.target.result;
    img.style.display = "block";
  };
  reader.readAsDataURL(file);
}

async function submitItem() {
  const orderId = document.getElementById("i_orderId").value;
  const name = document.getElementById("i_name").value.trim();
  const category = document.getElementById("i_category").value;
  const unit_price = document.getElementById("i_price").value;
  const currency = document.getElementById("i_currency").value;
  const qty = document.getElementById("i_qty").value || 1;
  const cbm = document.getElementById("i_cbm").value || 0;
  if (!name) { alert("Product name is required."); return; }

  let spec_json = {}, specParts = [];
  if (category === "tech") {
    spec_json = { params: document.getElementById("i_tech_params").value, model: document.getElementById("i_tech_model").value, variant: document.getElementById("i_tech_variant").value };
    specParts = [spec_json.model, spec_json.variant, spec_json.params].filter(Boolean);
  } else if (category === "apparel") {
    spec_json = { size: document.getElementById("i_apparel_size").value, color: document.getElementById("i_apparel_color").value, material: document.getElementById("i_apparel_material").value };
    specParts = [spec_json.size, spec_json.color, spec_json.material].filter(Boolean);
  } else {
    spec_json = { grade: document.getElementById("i_general_grade").value, moq: document.getElementById("i_general_moq").value, volume: document.getElementById("i_general_volume").value };
    specParts = [spec_json.grade, spec_json.moq && spec_json.moq+' MOQ', spec_json.volume].filter(Boolean);
  }
  const spec = specParts.join(", ");

  await NEXUS.post(`/api/business/orders/${orderId}/items`, { name, spec, category, spec_json: JSON.stringify(spec_json), unit_price, currency, qty, cbm, photo_data: window.__itemPhotoData });
  NEXUS.closeSheet("itemSheet");
  loadOrders();
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
          <div class="meta">${NEXUS.fmtDate(t.created_at)} · rev ${NEXUS.fmtMoney(t.revenue,'IDR')} · booking fee ${NEXUS.fmtMoney(t.booking_fee,'IDR')}</div>
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
  const fee_pct = document.getElementById("o_fee").value || 10;
  const urgency = document.getElementById("o_urgency").value || 1;
  if (!buyer_name) { alert("Buyer name is required."); return; }

  await NEXUS.post("/api/business/orders", { buyer_name, fee_pct, urgency });
  NEXUS.closeSheet("orderSheet");
  document.getElementById("o_buyer").value = "";
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

async function completeTour(id) { await NEXUS.put(`/api/business/tours/${id}/complete`, {}); loadTours(); }

document.getElementById("o_flags").addEventListener("change", suggestFee);
async function suggestFee() {
  const flag = document.getElementById("o_flags").value;
  const res = await NEXUS.post("/api/business/fee-suggest", {
    orderValue: flag === "bulk" ? 60000 : (flag === "oem" ? 20000 : 0),
    isFirstTime: flag === "firsttime", isOemRebrand: flag === "oem",
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

  const cards = await Promise.all(Object.entries(byCategory).map(async ([cat, items]) => {
    const itemsHtml = await Promise.all(items.map(async (i) => {
      const costItems = await NEXUS.get(`/api/trackb/catalog/${i.id}/cost-items`);
      const byType = {};
      costItems.forEach(c => { (byType[c.price_type] = byType[c.price_type] || []).push(c); });
      const costHtml = Object.entries(byType).map(([type, list]) => {
        const total = list.reduce((s, c) => s + c.amount, 0);
        return `<div class="meta">${type}: ${list.map(c => `${c.label} ${NEXUS.fmtMoney(c.amount, c.currency)}`).join(' + ')} = <strong>${NEXUS.fmtMoney(total, list[0].currency)}</strong></div>`;
      }).join("");

      return `
        <div style="border-top:1px solid #EEE; padding-top:8px; margin-top:8px;">
          <div class="row"><span class="label"><strong>${i.name}</strong>${i.grade ? ' ('+i.grade+')' : ''}</span><span class="val">${i.ready_stock ? '✅ ready' : '⏳ order'}</span></div>
          ${i.process || i.altitude || i.variety ? `<div class="meta">${[i.process, i.altitude, i.variety].filter(Boolean).join(' · ')}</div>` : ''}
          ${i.moisture_pct || i.defect_pct ? `<div class="meta">Moisture ${i.moisture_pct||'-'}% · Defect ${i.defect_pct||'-'}%</div>` : ''}
          ${costHtml}
          <button class="small secondary" style="margin-top:4px;" onclick="openCostItemSheet(${i.id})">+ Add cost item</button>
          <div style="margin-top:4px;">
            <a class="export-link" href="/api/export/catalog/${i.id}/xlsx">⬇ Excel</a> ·
            <a class="export-link" href="/api/export/catalog/${i.id}/docx">⬇ Word</a>
          </div>
        </div>
      `;
    }));
    return `<div class="card"><h3>${cat}</h3>${itemsHtml.join("")}</div>`;
  }));

  el.innerHTML = cards.join("");
}

function openCostItemSheet(productId) {
  document.getElementById("ci_productId").value = productId;
  ["ci_label","ci_amount"].forEach(id => document.getElementById(id).value = "");
  NEXUS.openSheet("costItemSheet");
}

async function submitCostItem() {
  const productId = document.getElementById("ci_productId").value;
  const price_type = document.getElementById("ci_type").value;
  const label = document.getElementById("ci_label").value.trim();
  const amount = document.getElementById("ci_amount").value;
  const currency = document.getElementById("ci_currency").value;
  if (!label || !amount) { alert("Label and amount are required."); return; }
  await NEXUS.post(`/api/trackb/catalog/${productId}/cost-items`, { price_type, label, amount, currency });
  NEXUS.closeSheet("costItemSheet");
  loadCatalog();
}

async function showCertGuide() {
  const category = document.getElementById("cat_category").value;
  const guide = await NEXUS.get(`/api/trackb/certificates/${encodeURIComponent(category)}`);
  document.getElementById("certGuideBox").innerHTML = `
    <strong>Certificates needed:</strong> ${guide.certs.join(", ")}<br>
    <span class="meta">${guide.costNote}</span>
  `;
}

async function submitCatalogProduct() {
  const category = document.getElementById("cat_category").value;
  const name = document.getElementById("cat_name").value.trim();
  if (!name) { alert("Product name is required."); return; }
  await NEXUS.post("/api/trackb/catalog", {
    category, name,
    grade: document.getElementById("cat_grade").value,
    process: document.getElementById("cat_process").value,
    altitude: document.getElementById("cat_altitude").value,
    variety: document.getElementById("cat_variety").value,
    moq_kg: document.getElementById("cat_moq").value,
    moisture_pct: document.getElementById("cat_moisture").value,
    defect_pct: document.getElementById("cat_defect").value,
    packaging_kg_per_jute: document.getElementById("cat_packaging").value,
    price_idr_per_kg: document.getElementById("cat_price_idr").value,
    price_rmb_per_kg: document.getElementById("cat_price_rmb").value,
    ready_stock: document.getElementById("cat_ready").checked,
  });
  ["cat_name","cat_grade","cat_process","cat_altitude","cat_variety","cat_moq","cat_moisture","cat_defect","cat_packaging","cat_price_idr","cat_price_rmb"].forEach(id => document.getElementById(id).value = "");
  loadCatalog();
}

async function seedCatalog() {
  const res = await NEXUS.post("/api/trackb/catalog/seed-defaults", {});
  if (res.skipped) alert("Catalog already has items."); else alert(`Loaded ${res.seeded} default products.`);
  loadCatalog();
}

const TRACKB_PIPELINE = [
  { key: "confirmed_both", label: "Already Confirm Both Buyer & Supplier" },
  { key: "partial_paid", label: "Already Pay (Parts)" },
  { key: "packed", label: "Already Pack" },
  { key: "id_port", label: "Already In Indonesia Port" },
  { key: "cn_port", label: "Already In China Port" },
  { key: "arrived_buyer", label: "Already Arrived To China Buyer" },
  { key: "closing", label: "Closing" },
];
function trackbPipelineIndex(key) { return Math.max(0, TRACKB_PIPELINE.findIndex(p => p.key === key)); }

async function loadTrackBProductDropdown() {
  const catalog = await NEXUS.get("/api/trackb/catalog");
  const sel = document.getElementById("b_product");
  if (!catalog.length) { sel.innerHTML = '<option value="">No catalog products — add one in the catalog section first</option>'; return; }
  sel.innerHTML = catalog.map(p => `<option value="${p.id}">${p.name} (${p.category})</option>`).join("");
}

async function loadTrackBOrders() {
  await loadTrackBProductDropdown();
  const orders = await NEXUS.get("/api/trackb/orders");
  document.getElementById("trackbOpen").textContent = orders.filter(o => o.status === 'open').length;
  const el = document.getElementById("trackbOrdersList");
  if (!orders.length) { el.innerHTML = '<div class="empty">No orders yet</div>'; return; }
  el.innerHTML = orders.map(o => {
    const stIdx = trackbPipelineIndex(o.pipeline_status || "confirmed_both");
    return `
    <div class="order-card">
      <div class="order-head">
        <div>
          <strong>${o.buyer_name}</strong> — ${o.product_summary || ""}
          <div class="meta">${NEXUS.fmtDate(o.created_at)} · ${o.profit_model} model</div>
          <div class="meta">Cost ${o.cost_price} ${o.cost_currency} · Sell ${o.selling_price} ${o.selling_currency}</div>
        </div>
        <button class="small secondary" onclick="deleteTrackB(${o.id})">🗑</button>
      </div>
      <select class="status-select st-${stIdx}" onchange="updateTrackBStatus(${o.id}, this.value)">
        ${TRACKB_PIPELINE.map(p => `<option value="${p.key}" ${p.key === o.pipeline_status ? 'selected' : ''}>${p.label}</option>`).join("")}
      </select>
      <div class="row" style="margin-top:8px;"><span class="label">Profit (RMB)</span><span class="val">${NEXUS.fmtMoney(o.profit)} ${o.margin_pct ? '('+o.margin_pct.toFixed(1)+'%)' : ''}</span></div>
      <a class="export-link" href="/api/export/trackb/orders/${o.id}/docx-zh" target="_blank">⬇ 中文订单确认书 (Chinese Word doc)</a>
    </div>
  `;
  }).join("");
}

function toggleProfitModel() {
  const mode = document.getElementById("b_model").value;
  document.getElementById("b_marginFields").classList.toggle("hidden", mode === "fee");
  document.getElementById("b_brokerFields").classList.toggle("hidden", mode === "margin");
}

async function submitTrackB() {
  const buyer_name = document.getElementById("b_buyer").value.trim();
  const catalog_product_id = document.getElementById("b_product").value;
  const profit_model = document.getElementById("b_model").value;
  const cost_price = document.getElementById("b_cost").value;
  const cost_currency = document.getElementById("b_cost_cur").value;
  const selling_price = document.getElementById("b_sell").value;
  const selling_currency = document.getElementById("b_sell_cur").value;
  const fee_rate = document.getElementById("b_feerate").value;
  const freight = document.getElementById("b_freight").value;
  const freight_currency = document.getElementById("b_freight_cur").value;
  const insurance = document.getElementById("b_insurance").value;
  const insurance_currency = document.getElementById("b_insurance_cur").value;
  const vat = document.getElementById("b_vat").value;
  const vat_currency = document.getElementById("b_vat_cur").value;
  const misc_fees = document.getElementById("b_misc").value;
  const misc_currency = document.getElementById("b_misc_cur").value;
  const payment_method = document.getElementById("b_payment").value;
  const status = document.getElementById("b_status").value;
  if (!buyer_name || !selling_price) { alert("Buyer name and selling price are required."); return; }

  await NEXUS.post("/api/trackb/orders", {
    buyer_name, catalog_product_id, profit_model, fee_rate,
    cost_price, cost_currency, selling_price, selling_currency,
    freight, freight_currency, insurance, insurance_currency,
    vat, vat_currency, misc_fees, misc_currency, payment_method, status,
  });
  NEXUS.closeSheet("trackbSheet");
  ["b_buyer","b_cost","b_sell","b_feerate","b_freight","b_insurance","b_vat","b_misc","b_payment"].forEach(id => document.getElementById(id).value = "");
  loadTrackBOrders();
}

async function updateTrackBStatus(id, val) { await NEXUS.put(`/api/trackb/orders/${id}/status`, { pipeline_status: val }); loadTrackBOrders(); }
async function deleteTrackB(id) {
  if (!confirm("Delete this Track B order?")) return;
  await NEXUS.del(`/api/trackb/orders/${id}`);
  loadTrackBOrders();
}

// =========================================================
// CRM
// =========================================================
let crmFilter = "";
function filterCRM(kind) { crmFilter = kind; loadCRM(); }
const TIER_LABELS = {
  big_fish_client: "Big Fish Client", newbie_client: "Newbie Client", potential_client: "Potential Client",
  alibaba_trusted_supplier: "Alibaba Trusted Supplier", mature_supplier: "Mature Supplier", newbie_supplier: "Newbie Supplier",
};

async function loadCRM() {
  const q = document.getElementById("crm_search").value;
  const params = new URLSearchParams();
  if (crmFilter) params.set("kind", crmFilter);
  if (q) params.set("q", q);
  const list = await NEXUS.get(`/api/crm?${params.toString()}`);
  const el = document.getElementById("crmList");
  if (!list.length) { el.innerHTML = '<div class="empty">No contacts yet</div>'; return; }
  el.innerHTML = list.map(c => `
    <div class="card">
      <div class="row"><span class="label"><strong>${c.company_name || c.name}</strong></span><span class="mini-tag">${c.kind}</span></div>
      ${c.person_name ? `<div class="meta">Contact: ${c.person_name}</div>` : ''}
      ${c.whatsapp ? `<div class="meta">WA: ${c.whatsapp}</div>` : ''}
      ${c.wechat ? `<div class="meta">WeChat: ${c.wechat}</div>` : ''}
      ${c.phone ? `<div class="meta">Phone: ${c.phone}</div>` : ''}
      ${c.address ? `<div class="meta">${c.address}</div>` : ''}
      ${c.alibaba_link ? `<div class="meta"><a href="${c.alibaba_link}" target="_blank">Alibaba link</a></div>` : ''}
      ${c.tier ? `<div class="meta">Tier: ${TIER_LABELS[c.tier] || c.tier}</div>` : ''}
      <div class="meta" style="margin-top:6px;">
        Certificates: ${(c.certificates_list || []).map(cert => `<span class="mini-tag">${cert.cert_name} <a href="#" onclick="deleteCert(${cert.id});return false;">✕</a></span>`).join(" ") || 'none'}
      </div>
      <div class="grid2" style="margin-top:8px;">
        <button class="small secondary" onclick="openCertSheet(${c.id})">+ Add certificate</button>
        <button class="small secondary" onclick="deleteCRM(${c.id})">🗑 Delete contact</button>
      </div>
    </div>
  `).join("");
}

async function submitCRM() {
  const kind = document.getElementById("c_kind").value;
  const company_name = document.getElementById("c_company").value.trim();
  const person_name = document.getElementById("c_person").value.trim();
  if (!company_name && !person_name) { alert("Enter a company or person name."); return; }
  await NEXUS.post("/api/crm", {
    kind, company_name, person_name,
    whatsapp: document.getElementById("c_whatsapp").value,
    wechat: document.getElementById("c_wechat").value,
    phone: document.getElementById("c_phone").value,
    address: document.getElementById("c_address").value,
    alibaba_link: document.getElementById("c_alibaba").value,
    tier: document.getElementById("c_tier").value,
  });
  NEXUS.closeSheet("crmSheet");
  ["c_company","c_person","c_whatsapp","c_wechat","c_phone","c_address","c_alibaba"].forEach(id => document.getElementById(id).value = "");
  loadCRM();
}

function openCertSheet(clientId) {
  document.getElementById("cert_clientId").value = clientId;
  document.getElementById("cert_name").value = "";
  NEXUS.openSheet("certSheet");
}
async function submitCertificate() {
  const clientId = document.getElementById("cert_clientId").value;
  const cert_name = document.getElementById("cert_name").value.trim();
  if (!cert_name) { alert("Enter a certificate name."); return; }
  await NEXUS.post(`/api/crm/${clientId}/certificates`, { cert_name });
  NEXUS.closeSheet("certSheet");
  loadCRM();
}
async function deleteCert(certId) {
  const list = await NEXUS.get("/api/crm");
  const owner = list.find(c => (c.certificates_list || []).some(cert => cert.id === certId));
  if (owner) await NEXUS.del(`/api/crm/${owner.id}/certificates/${certId}`);
  loadCRM();
}

async function deleteCRM(id) {
  if (!confirm("Delete this contact?")) return;
  await NEXUS.del(`/api/crm/${id}`);
  loadCRM();
}

// =========================================================
// ITINERARY GENERATOR
// =========================================================
async function generateItinerary() {
  const destinations = document.getElementById("it_destinations").value.split(",").map(s => s.trim()).filter(Boolean);
  const days = document.getElementById("it_days").value;
  const use_rideshare = document.getElementById("it_rideshare").checked;
  if (!destinations.length) { alert("Enter at least one destination."); return; }
  const res = await NEXUS.post("/api/itinerary/generate", { destinations, days, use_rideshare });
  const el = document.getElementById("itineraryResult");
  el.innerHTML = `
    <div class="section-title">Generated Itinerary</div>
    ${res.schedule.map(d => `
      <div class="card">
        <h3>Day ${d.day}</h3>
        <div class="meta" style="margin-bottom:8px;">${d.route_note}</div>
        ${d.legs.map(l => `
          <div style="border-top:1px solid #EEE; padding-top:8px; margin-top:8px;">
            <div><strong>📍 ${l.stop}</strong></div>
            <div class="meta">🏞 ${l.scenery}</div>
            <div class="meta">🍜 ${l.food}</div>
            ${l.rideshare ? `<div class="meta">🚗 ${l.rideshare.mode}: ${l.rideshare.from} → ${l.rideshare.to} (~${NEXUS.fmtMoney(l.rideshare.est_cost_idr,'IDR')})</div>` : ''}
          </div>
        `).join("")}
        <div class="row" style="margin-top:8px;"><span class="label">Ticket cost</span><span class="val">${NEXUS.fmtMoney(d.ticket_cost,'IDR')}</span></div>
        ${d.rideshare_total ? `<div class="row"><span class="label">Rideshare total</span><span class="val">${NEXUS.fmtMoney(d.rideshare_total,'IDR')}</span></div>` : ''}
      </div>
    `).join("")}
    <div class="card">
      <div class="row"><span class="label">Ticket total</span><span class="val">${NEXUS.fmtMoney(res.ticket_cost_total,'IDR')}</span></div>
      <div class="row"><span class="label">Rideshare total</span><span class="val">${NEXUS.fmtMoney(res.rideshare_total,'IDR')}</span></div>
      <div class="row"><span class="label">Service fee (89K/day)</span><span class="val">${NEXUS.fmtMoney(res.service_fee_total,'IDR')}</span></div>
      <div class="row"><span class="label"><strong>Grand total</strong></span><span class="val"><strong>${NEXUS.fmtMoney(res.grand_total,'IDR')}</strong></span></div>
    </div>
    <div class="meta" style="font-style:italic;">${res.note}</div>
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
  const entries = await NEXUS.get("/api/blockchain");
  const el = document.getElementById("bcList");
  if (!entries.length) { el.innerHTML = '<div class="empty">No entries yet</div>'; return; }
  el.innerHTML = entries.map(e => `
    <div class="list-item">
      <div>
        <div><strong>${e.title}</strong></div>
        <div class="meta">${e.content || ''}</div>
      </div>
      <button class="small secondary" onclick="deleteBC(${e.id})">✕</button>
    </div>
  `).join("");
}

async function submitBlockchain() {
  const content = document.getElementById("bc_content").value.trim();
  if (!content) { alert("Write something you learned today."); return; }
  await NEXUS.post("/api/blockchain", { content });
  NEXUS.closeSheet("bcSheet");
  document.getElementById("bc_content").value = "";
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
