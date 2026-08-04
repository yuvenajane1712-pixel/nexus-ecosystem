let currentPersonId = null;
let currentPersonName = null;
let goalWeight = null;
let foodCache = [];

document.getElementById("fabBtn").addEventListener("click", () => NEXUS.openSheet("actionSheet"));
function openForm(id) {
  NEXUS.closeSheet("actionSheet");
  if (id === "personSheet") renderFoodExclusions("p_foodExclusions", []);
  NEXUS.openSheet(id);
}

function toggleMetricFields() {
  const type = document.getElementById("m_type").value;
  document.getElementById("m_singleField").classList.toggle("hidden", type === "bp");
  document.getElementById("m_bpFields").classList.toggle("hidden", type !== "bp");
}

function toggleWorkoutOther() {
  document.getElementById("w_otherField").classList.toggle("hidden", document.getElementById("w_type").value !== "Other");
}

async function tapBathroom(kind) {
  await NEXUS.post("/api/health/bathroom", { person_name: currentPersonName, kind });
  loadBathroom();
}

async function loadBathroom() {
  const data = await NEXUS.get(`/api/health/bathroom/${encodeURIComponent(currentPersonName)}`);
  document.getElementById("peeCount").textContent = data.pee_count;
  document.getElementById("poopCount").textContent = data.poop_count;
  document.getElementById("bathroomEvents").innerHTML = data.events.map(e =>
    `${e.kind === 'pee' ? '💧' : '💩'} ${NEXUS.fmtDate(e.logged_at)}`
  ).join(" · ") || "No events logged yet today";
}

async function previewShelfLife() {
  const item = document.getElementById("g_title").value.trim();
  const box = document.getElementById("shelfLifePreview");
  if (!item) { box.innerHTML = ""; return; }
  const sl = await NEXUS.get(`/api/health/shelf-life?item=${encodeURIComponent(item)}`);
  box.innerHTML = `
    <div class="row"><span class="label">${sl.fridge ? '🧊 Fridge' : '🌡️ Room temp OK'}</span><span class="val">~${sl.estimated_days} days</span></div>
    <div class="meta">${sl.note}</div>
  `;
}

async function loadPeopleDropdown() {
  const people = await NEXUS.get("/api/people");
  const sel = document.getElementById("personSelect");
  if (!people.length) {
    sel.innerHTML = `<option value="">No people yet — tap + to add</option>`;
    return null;
  }
  sel.innerHTML = people.map(p => `<option value="${p.id}">${p.name}</option>`).join("");
  if (!currentPersonId || !people.find(p => p.id === currentPersonId)) {
    currentPersonId = people[0].id;
  }
  sel.value = currentPersonId;
  currentPersonName = people.find(p => p.id == currentPersonId)?.name;
  return people.find(p => p.id == currentPersonId);
}

document.getElementById("personSelect").addEventListener("change", (e) => {
  currentPersonId = Number(e.target.value);
  refreshAll();
});

async function loadFoodDropdown() {
  if (!foodCache.length) foodCache = await NEXUS.get("/api/people/foods");
  const sel = document.getElementById("meal_food");
  const byCategory = {};
  foodCache.forEach(f => { (byCategory[f.category] = byCategory[f.category] || []).push(f); });
  sel.innerHTML = Object.entries(byCategory).map(([cat, foods]) =>
    `<optgroup label="${cat}">${foods.map(f => `<option value="${f.id}">${f.name}</option>`).join("")}</optgroup>`
  ).join("");
}

async function refreshAll() {
  const person = await loadPeopleDropdown();
  if (!person) {
    document.getElementById("profileCard").innerHTML = '<div class="empty">No people added yet. Tap + → "Add a person" to get started.</div>';
    document.getElementById("needsBox").innerHTML = "";
    return;
  }
  currentPersonName = person.name;

  document.getElementById("profileCard").innerHTML = `
    <h3>${person.name}</h3>
    <div class="row"><span class="label">Height / Weight</span><span class="val">${person.height_cm || '-'}cm / ${person.weight_kg || '-'}kg</span></div>
    <div class="row"><span class="label">Age / Gender</span><span class="val">${person.age || '-'} / ${person.gender}</span></div>
    <div class="row"><span class="label">Activity level</span><span class="val">${person.activity_level}</span></div>
    ${person.goal_weight_kg ? `<div class="row"><span class="label">Goal</span><span class="val">${person.goal_weight_kg}kg by ${person.goal_date || '—'}</span></div>` : ''}
    ${person.no_red_meat || person.gluten_free || person.dairy_free || person.soy_free ? `<div class="meta">${[person.no_red_meat&&'no red meat', person.gluten_free&&'gluten-free', person.dairy_free&&'dairy-free', person.soy_free&&'soy-free'].filter(Boolean).join(' · ')}</div>` : ''}
    <button class="small secondary" style="margin-top:8px;" onclick="openUpdatePerson()">Update body info / goal weight</button>
  `;

  await loadFoodDropdown();
  await loadNeeds();
  await loadMealsToday();
  await loadSchedule();
  await loadInsight();
  await loadWeightChart();
  await loadLogs();
  await loadBathroom();
  await loadWater();
  await loadCalorieBalance();
  await loadSupplements();
}

async function renderFoodExclusions(containerId, excludedList) {
  const foods = await NEXUS.get("/api/people/food-options");
  const proteinCarb = foods.filter(f => f.category === "protein" || f.category === "carb" || f.category === "veggie");
  const el = document.getElementById(containerId);
  el.innerHTML = proteinCarb.map(f => `
    <label style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
      <input type="checkbox" class="food-excl-check" value="${f.name}" ${excludedList.includes(f.name) ? '' : 'checked'} style="width:auto;" /> ${f.name} <span class="meta">(${f.category})</span>
    </label>
  `).join("");
}
function collectExcludedFoods(containerId) {
  return Array.from(document.querySelectorAll(`#${containerId} .food-excl-check:not(:checked)`)).map(c => c.value);
}

function openUpdatePerson() {
  NEXUS.get(`/api/people`).then(async people => {
    const p = people.find(pp => pp.id === currentPersonId);
    document.getElementById("up_height").value = p.height_cm || "";
    document.getElementById("up_weight").value = p.weight_kg || "";
    document.getElementById("up_age").value = p.age || "";
    document.getElementById("up_goal").value = p.goal_weight_kg || "";
    document.getElementById("up_goal_date").value = p.goal_date || "";
    let excluded = [];
    try { excluded = JSON.parse(p.excluded_foods || "[]"); } catch (e) {}
    await renderFoodExclusions("up_foodExclusions", excluded);
    NEXUS.openSheet("updatePersonSheet");
  });
}

async function submitPersonUpdate() {
  const height_cm = document.getElementById("up_height").value;
  const weight_kg = document.getElementById("up_weight").value;
  const age = document.getElementById("up_age").value;
  const goal_weight_kg = document.getElementById("up_goal").value || null;
  const goal_date = document.getElementById("up_goal_date").value || null;
  const excluded_foods = collectExcludedFoods("up_foodExclusions");
  const people = await NEXUS.get("/api/people");
  const p = people.find(pp => pp.id === currentPersonId);
  await NEXUS.put(`/api/people/${currentPersonId}`, { ...p, height_cm, weight_kg, age, goal_weight_kg, goal_date, excluded_foods });
  NEXUS.closeSheet("updatePersonSheet");
  refreshAll();
}

async function loadWater() {
  const data = await NEXUS.get(`/api/health/water-today/${encodeURIComponent(currentPersonName)}`);
  const needs = await NEXUS.get(`/api/people/${currentPersonId}/daily-needs`);
  const target = needs.water_target_ml || 2000;
  document.getElementById("waterToday").textContent = `${data.ml_today} / ${target} ml`;
  const pct = Math.min(100, (data.ml_today / target) * 100);
  document.getElementById("waterBar").style.width = pct + "%";
}

async function submitWater() {
  const ml = document.getElementById("water_ml").value;
  if (!ml) { alert("Enter an amount."); return; }
  await NEXUS.post("/api/health/logs", { user_name: currentPersonName, log_type: "water", title: "water", value: ml });
  NEXUS.closeSheet("waterSheet");
  document.getElementById("water_ml").value = "";
  refreshAll();
}

async function loadCalorieBalance() {
  const bal = await NEXUS.get(`/api/health/calorie-balance/${encodeURIComponent(currentPersonName)}`);
  const needs = await NEXUS.get(`/api/people/${currentPersonId}/daily-needs`);
  document.getElementById("calEaten").textContent = bal.eaten + " kcal";
  document.getElementById("calBurned").textContent = bal.burned + " kcal";
  document.getElementById("calNet").textContent = bal.net + " kcal";
  if (needs.calorie_target) {
    const remaining = needs.calorie_target - bal.net;
    document.getElementById("calRemaining").textContent = `${remaining} kcal (of ${needs.calorie_target} target)`;
  }
}

async function loadSupplements() {
  const list = await NEXUS.get(`/api/supplements/person/${encodeURIComponent(currentPersonName)}`);
  const el = document.getElementById("supplementList");
  if (!list.length) { el.innerHTML = '<div class="empty">None added yet</div>'; return; }
  el.innerHTML = list.map(s => `
    <div class="row">
      <label style="display:flex;align-items:center;gap:8px;flex:1;">
        <input type="checkbox" ${s.taken_today ? 'checked' : ''} onchange="toggleSupplement(${s.id}, this.checked)" style="width:auto;" />
        ${s.name} <span class="meta">(${s.portion})</span>
      </label>
      <button class="small secondary" onclick="deleteSupplement(${s.id})">✕</button>
    </div>
  `).join("");
}

async function toggleSupplement(id, taken) {
  await NEXUS.put(`/api/supplements/${id}/check`, { taken });
}

async function submitSupplementDef() {
  const name = document.getElementById("sup_name").value.trim();
  const portion = document.getElementById("sup_portion").value.trim();
  if (!name) { alert("Name is required."); return; }
  await NEXUS.post("/api/supplements", { owner_type: "person", owner_name: currentPersonName, name, portion });
  NEXUS.closeSheet("supplementDefSheet");
  ["sup_name","sup_portion"].forEach(id => document.getElementById(id).value = "");
  loadSupplements();
}

async function deleteSupplement(id) {
  await NEXUS.del(`/api/supplements/${id}`);
  loadSupplements();
}

async function loadNeeds() {
  const url = `/api/people/${currentPersonId}/daily-needs`;
  const needs = await NEXUS.get(url);
  const box = document.getElementById("needsBox");
  if (needs.error) { box.innerHTML = `<div class="empty">${needs.error}</div>`; return; }

  box.innerHTML = `
    <div class="row"><span class="label">BMR</span><span class="val">${needs.bmr} kcal</span></div>
    <div class="row"><span class="label">TDEE (maintenance)</span><span class="val">${needs.tdee} kcal</span></div>
    <div class="row"><span class="label"><strong>Daily calorie target</strong></span><span class="val"><strong>${needs.calorie_target} kcal</strong></span></div>
    <div class="row"><span class="label">Protein target</span><span class="val">${needs.protein_target_g}g</span></div>
    <div class="row"><span class="label">Fat target</span><span class="val">${needs.fat_target_g}g</span></div>
    <div class="row"><span class="label">Carb target</span><span class="val">${needs.carb_target_g}g</span></div>
    <div class="row"><span class="label">Fiber target</span><span class="val">${needs.fiber_target_g}g</span></div>
    <div class="section-title">If 100% protein from one source</div>
    ${needs.protein_food_equivalents.map(f => `<div class="row"><span class="label">${f.food}</span><span class="val">${f.grams_needed}g/day</span></div>`).join("")}
    <div class="section-title">If 100% carbs from one source</div>
    ${needs.carb_food_equivalents.map(f => `<div class="row"><span class="label">${f.food}</span><span class="val">${f.grams_needed}g/day</span></div>`).join("")}
    <div class="section-title">Veg & Fruit</div>
    <div class="row"><span class="label">Vegetables (suggested)</span><span class="val">~${needs.veggie_suggestion_g}g/day</span></div>
    <div class="row"><span class="label">Fruit (suggested)</span><span class="val">~${needs.fruit_suggestion_g}g/day</span></div>
    <div class="row" style="margin-top:8px;"><span class="label"><strong>Weekly protein source needed</strong></span><span class="val"><strong>~${Math.round(needs.protein_target_g*7/1000*10)/10}kg equiv/week</strong></span></div>
    <div class="meta" style="margin-top:8px; font-style:italic;">${needs.note}</div>
  `;
}

async function loadMealsToday() {
  const data = await NEXUS.get(`/api/health/meals-today/${currentPersonName}`);
  const el = document.getElementById("mealsBySlot");
  const slots = ["breakfast", "lunch", "dinner", "snack"];
  el.innerHTML = slots.map(slot => {
    const items = data.bySlot[slot] || [];
    return `
      <div style="margin-bottom:8px;">
        <strong style="text-transform:capitalize;">${slot}</strong>
        ${items.length ? items.map(i => `<div class="meta">${i.title} (${i.grams}g) — ${i.calories} kcal, P${i.protein}g F${i.fat}g C${i.carbs}g</div>`).join("") : '<div class="meta">Not logged yet</div>'}
      </div>
    `;
  }).join("");
  document.getElementById("todayTotals").textContent = `${Math.round(data.totals.calories)} kcal · P${data.totals.protein.toFixed(1)}g F${data.totals.fat.toFixed(1)}g C${data.totals.carbs.toFixed(1)}g Fiber${data.totals.fiber.toFixed(1)}g`;
}

async function loadSchedule() {
  const sched = await NEXUS.get(`/api/people/${currentPersonId}/schedule`);
  ["wake","sleep","breakfast","lunch","snack","dinner","workout"].forEach(k => {
    document.getElementById(`sch_${k}`).value = sched[`${k}_time`] || "";
  });
}

async function saveSchedule() {
  await NEXUS.put(`/api/people/${currentPersonId}/schedule`, {
    wake_time: document.getElementById("sch_wake").value,
    sleep_time: document.getElementById("sch_sleep").value,
    breakfast_time: document.getElementById("sch_breakfast").value,
    lunch_time: document.getElementById("sch_lunch").value,
    snack_time: document.getElementById("sch_snack").value,
    dinner_time: document.getElementById("sch_dinner").value,
    workout_time: document.getElementById("sch_workout").value,
  });
}

async function loadInsight() {
  const insight = await NEXUS.get(`/api/health/insight/${currentPersonName}`);
  document.getElementById("insightBox").innerHTML = (insight.insights || []).map(i => `• ${i}`).join("<br>") || '<div class="empty">Log meals to get coaching insights</div>';
}

async function loadWeightChart() {
  const chart = await NEXUS.get(`/api/health/weight-chart/${currentPersonName}`);
  const chartEl = document.getElementById("weightChart");
  if (!chart.points.length) { chartEl.innerHTML = '<div class="empty">No weight logs yet</div>'; return; }
  const points = chart.points.map((p, i) => ({ x: i, y: p.weight }));
  chartEl.innerHTML = NEXUS.lineChart({ points, goalY: chart.goal_target, goalLabel: "goal", unit: "kg" });
}

async function loadLogs() {
  const logs = await NEXUS.get(`/api/health/logs?user_name=${encodeURIComponent(currentPersonName)}`);
  const el = document.getElementById("logsList");
  if (!logs.length) { el.innerHTML = '<div class="empty">No logs yet</div>'; return; }
  el.innerHTML = logs.map(l => `
    <div class="list-item">
      <div>
        <div><strong>${l.title || l.log_type}</strong> <span class="mini-tag">${l.meal_slot || l.log_type}</span></div>
        <div class="meta">${l.value || ""} ${l.grams ? l.grams+'g' : ''} ${l.calories ? "· " + l.calories + " kcal" : ""} ${l.cost_rmb ? "· ¥" + l.cost_rmb : ""}</div>
        <div class="meta">${NEXUS.fmtDate(l.created_at)}</div>
      </div>
      <button class="small secondary" onclick="deleteLog(${l.id})">✕</button>
    </div>
  `).join("");
}

// --- meal preview as you type ---
["meal_food", "meal_grams"].forEach(id => {
  document.addEventListener("DOMContentLoaded", () => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", updateMealPreview);
  });
});
function updateMealPreview() {
  const foodId = Number(document.getElementById("meal_food").value);
  const grams = Number(document.getElementById("meal_grams").value) || 0;
  const food = foodCache.find(f => f.id === foodId);
  if (!food || !grams) { document.getElementById("mealPreview").innerHTML = ""; return; }
  const ratio = grams / 100;
  document.getElementById("mealPreview").innerHTML = `
    <div class="row"><span class="label">Calories</span><span class="val">${Math.round(food.calories_per100*ratio)} kcal</span></div>
    <div class="row"><span class="label">Protein / Fat / Carbs</span><span class="val">${(food.protein_per100*ratio).toFixed(1)}g / ${(food.fat_per100*ratio).toFixed(1)}g / ${(food.carbs_per100*ratio).toFixed(1)}g</span></div>
  `;
}
document.getElementById("meal_food").addEventListener("change", updateMealPreview);
document.getElementById("meal_grams").addEventListener("input", updateMealPreview);

async function submitMeal() {
  const meal_slot = document.getElementById("meal_slot").value;
  const food_item_id = document.getElementById("meal_food").value;
  const grams = document.getElementById("meal_grams").value;
  const cooking_method = document.getElementById("meal_cooking").value;
  if (!grams) { alert("Enter grams."); return; }
  await NEXUS.post("/api/health/logs/meal", { user_name: currentPersonName, meal_slot, food_item_id, grams, cooking_method });
  NEXUS.closeSheet("mealSheet");
  document.getElementById("meal_grams").value = "";
  document.getElementById("meal_cooking").value = "";
  document.getElementById("mealPreview").innerHTML = "";
  refreshAll();
}

async function submitWorkout() {
  const type = document.getElementById("w_type").value;
  const workoutName = type === "Other" ? (document.getElementById("w_othername").value.trim() || "Other") : type;
  const duration = document.getElementById("w_duration").value;
  const burned = document.getElementById("w_burned").value;
  const steps = document.getElementById("w_steps").value;
  await NEXUS.post("/api/health/logs", { user_name: currentPersonName, log_type: "workout", title: "calories_burned", value: String(burned || 0) });
  await NEXUS.post("/api/health/logs", { user_name: currentPersonName, log_type: "workout", title: workoutName, value: `${duration} min${steps ? ', ' + steps + ' steps' : ''}` });
  NEXUS.closeSheet("workoutSheet");
  ["w_duration","w_burned","w_steps","w_othername"].forEach(id => document.getElementById(id).value = "");
  refreshAll();
}

async function submitMetric() {
  const type = document.getElementById("m_type").value;
  let title = type, value;
  if (type === "bp") {
    const sys = document.getElementById("m_systolic").value;
    const dia = document.getElementById("m_diastolic").value;
    if (!sys || !dia) { alert("Enter both systolic and diastolic."); return; }
    value = `${sys}/${dia}`;
    title = "blood_pressure";
  } else {
    value = document.getElementById("m_value").value;
    if (!value) { alert("Enter a value."); return; }
    title = { weight: "weight", hr: "heart_rate", spo2: "blood_oxygen" }[type];
  }
  await NEXUS.post("/api/health/logs", { user_name: currentPersonName, log_type: "metric", title, value });
  NEXUS.closeSheet("metricSheet");
  ["m_value","m_systolic","m_diastolic"].forEach(id => document.getElementById(id).value = "");
  refreshAll();
}

async function submitSupplement() {
  const title = document.getElementById("s_title").value.trim();
  if (!title) { alert("Name is required."); return; }
  await NEXUS.post("/api/health/logs", { user_name: currentPersonName, log_type: "supplement", title, value: document.getElementById("s_value").value });
  NEXUS.closeSheet("supplementSheet");
  ["s_title","s_value"].forEach(id => document.getElementById(id).value = "");
  refreshAll();
}

async function submitGrocery() {
  const title = document.getElementById("g_title").value.trim();
  const grocery_grams = document.getElementById("g_grams").value;
  const cost_rmb = document.getElementById("g_cost").value;
  if (!title || !cost_rmb) { alert("Item and cost are required."); return; }
  const res = await NEXUS.post("/api/health/logs", { user_name: currentPersonName, log_type: "grocery", title, cost_rmb, grocery_grams });
  NEXUS.closeSheet("grocerySheet");
  ["g_title","g_grams","g_cost"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("shelfLifePreview").innerHTML = "";
  if (res.shelf_life) {
    alert(`Shelf life estimate: ~${res.shelf_life.estimated_days} days, ${res.shelf_life.fridge ? 'keep refrigerated' : 'room temp OK'}.\n${res.shelf_life.note}`);
  }
  refreshAll();
}

async function submitPerson() {
  const name = document.getElementById("p_name").value.trim();
  if (!name) { alert("Name is required."); return; }
  const excluded_foods = collectExcludedFoods("p_foodExclusions");
  const res = await NEXUS.post("/api/people", {
    name,
    height_cm: document.getElementById("p_height").value,
    weight_kg: document.getElementById("p_weight").value,
    age: document.getElementById("p_age").value,
    gender: document.getElementById("p_gender").value,
    activity_level: document.getElementById("p_activity").value,
    no_red_meat: document.getElementById("p_noredmeat").checked,
    gluten_free: document.getElementById("p_glutenfree").checked,
    dairy_free: document.getElementById("p_dairyfree").checked,
    soy_free: document.getElementById("p_soyfree").checked,
  });
  await NEXUS.put(`/api/people/${res.id}`, {
    name, height_cm: document.getElementById("p_height").value, weight_kg: document.getElementById("p_weight").value,
    age: document.getElementById("p_age").value, gender: document.getElementById("p_gender").value,
    activity_level: document.getElementById("p_activity").value,
    goal_weight_kg: document.getElementById("p_goal").value || null,
    goal_date: document.getElementById("p_goal_date").value || null,
    excluded_foods,
  });
  NEXUS.closeSheet("personSheet");
  ["p_name","p_height","p_weight","p_age","p_goal","p_goal_date"].forEach(id => document.getElementById(id).value = "");
  currentPersonId = res.id;
  refreshAll();
}

// ===== batch meal entry (Meal A / B / C for one slot) =====
let mbRowCount = 0;
function addMealBatchRow() {
  mbRowCount++;
  const el = document.getElementById("mb_rows");
  const letter = String.fromCharCode(64 + mbRowCount); // A, B, C...
  const row = document.createElement("div");
  row.className = "card";
  row.innerHTML = `
    <div class="row"><span class="label"><strong>Meal ${letter}</strong></span><button class="small secondary" type="button" onclick="this.closest('.card').remove()">✕</button></div>
    <label>Name / menu</label>
    <input type="text" class="mb-name" placeholder="e.g. Grilled chicken rice bowl" />
    <div class="grid2">
      <div><label>Grams</label><input type="number" class="mb-grams" placeholder="200" /></div>
      <div><label>Calories</label><input type="number" class="mb-kcal" placeholder="350" /></div>
    </div>
    <label>Cooking method</label>
    <input type="text" class="mb-cooking" placeholder="e.g. grilled" />
  `;
  el.appendChild(row);
}
function resetMealBatch() {
  document.getElementById("mb_rows").innerHTML = "";
  mbRowCount = 0;
  addMealBatchRow();
}
function openMealBatch() {
  NEXUS.closeSheet("actionSheet");
  resetMealBatch();
  NEXUS.openSheet("mealBatchSheet");
}

async function submitMealBatch() {
  const meal_slot = document.getElementById("mb_slot").value;
  const rows = document.querySelectorAll("#mb_rows .card");
  const items = Array.from(rows).map(row => ({
    name: row.querySelector(".mb-name").value.trim(),
    grams: row.querySelector(".mb-grams").value,
    calories: row.querySelector(".mb-kcal").value,
    cooking_method: row.querySelector(".mb-cooking").value,
  })).filter(i => i.name);
  if (!items.length) { alert("Add at least one meal item with a name."); return; }

  await NEXUS.post("/api/health/logs/meal-batch", { user_name: currentPersonName, meal_slot, items });
  NEXUS.closeSheet("mealBatchSheet");
  refreshAll();
}

async function deleteLog(id) {
  await NEXUS.del(`/api/health/logs/${id}`);
  refreshAll();
}

NEXUS.onChange("health", refreshAll);
NEXUS.onChange("people", refreshAll);
NEXUS.onChange("supplements", () => loadSupplements());
refreshAll();
