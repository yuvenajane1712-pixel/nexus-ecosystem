let currentPersonId = null;
let currentPersonName = null;
let goalWeight = null;
let foodCache = [];

document.getElementById("fabBtn").addEventListener("click", () => NEXUS.openSheet("actionSheet"));
function openForm(id) { NEXUS.closeSheet("actionSheet"); NEXUS.openSheet(id); }

function toggleMetricFields() {
  const type = document.getElementById("m_type").value;
  document.getElementById("m_singleField").classList.toggle("hidden", type === "bp");
  document.getElementById("m_bpFields").classList.toggle("hidden", type !== "bp");
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
  goalWeight = null;

  document.getElementById("profileCard").innerHTML = `
    <h3>${person.name}</h3>
    <div class="row"><span class="label">Height / Weight</span><span class="val">${person.height_cm || '-'}cm / ${person.weight_kg || '-'}kg</span></div>
    <div class="row"><span class="label">Age / Gender</span><span class="val">${person.age || '-'} / ${person.gender}</span></div>
    <div class="row"><span class="label">Activity level</span><span class="val">${person.activity_level}</span></div>
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
}

function openUpdatePerson() {
  NEXUS.get(`/api/people`).then(people => {
    const p = people.find(pp => pp.id === currentPersonId);
    document.getElementById("up_height").value = p.height_cm || "";
    document.getElementById("up_weight").value = p.weight_kg || "";
    document.getElementById("up_age").value = p.age || "";
    NEXUS.openSheet("updatePersonSheet");
  });
}

async function submitPersonUpdate() {
  const height_cm = document.getElementById("up_height").value;
  const weight_kg = document.getElementById("up_weight").value;
  const age = document.getElementById("up_age").value;
  goalWeight = document.getElementById("up_goal").value || null;
  const people = await NEXUS.get("/api/people");
  const p = people.find(pp => pp.id === currentPersonId);
  await NEXUS.put(`/api/people/${currentPersonId}`, { ...p, height_cm, weight_kg, age });
  NEXUS.closeSheet("updatePersonSheet");
  refreshAll();
}

async function loadNeeds() {
  const url = `/api/people/${currentPersonId}/daily-needs` + (goalWeight ? `?goal_weight=${goalWeight}` : "");
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
  const duration = document.getElementById("w_duration").value;
  const burned = document.getElementById("w_burned").value;
  const steps = document.getElementById("w_steps").value;
  await NEXUS.post("/api/health/logs", { user_name: currentPersonName, log_type: "workout", title: "calories_burned", value: String(burned || 0) });
  await NEXUS.post("/api/health/logs", { user_name: currentPersonName, log_type: "workout", title: type, value: `${duration} min${steps ? ', ' + steps + ' steps' : ''}` });
  NEXUS.closeSheet("workoutSheet");
  ["w_duration","w_burned","w_steps"].forEach(id => document.getElementById(id).value = "");
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
    title = { weight: "weight", hr: "heart_rate", spo2: "blood_oxygen", stool: "stool", urination: "urination" }[type];
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
  const cost_rmb = document.getElementById("g_cost").value;
  if (!title || !cost_rmb) { alert("Item and cost are required."); return; }
  await NEXUS.post("/api/health/logs", { user_name: currentPersonName, log_type: "grocery", title, cost_rmb });
  NEXUS.closeSheet("grocerySheet");
  ["g_title","g_cost"].forEach(id => document.getElementById(id).value = "");
  refreshAll();
}

async function submitPerson() {
  const name = document.getElementById("p_name").value.trim();
  if (!name) { alert("Name is required."); return; }
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
  NEXUS.closeSheet("personSheet");
  ["p_name","p_height","p_weight","p_age"].forEach(id => document.getElementById(id).value = "");
  currentPersonId = res.id;
  refreshAll();
}

async function deleteLog(id) {
  await NEXUS.del(`/api/health/logs/${id}`);
  refreshAll();
}

NEXUS.onChange("health", refreshAll);
NEXUS.onChange("people", refreshAll);
refreshAll();
