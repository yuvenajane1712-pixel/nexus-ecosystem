const REMINDERS = {
  Yuvena: "Pre-meal lemon water / ACV · low-glycemic meals · prioritize potassium",
  Nadine: "Gluten/dairy/soy-free check · thyroid-supportive foods · moderate protein",
};

document.getElementById("fabBtn").addEventListener("click", () => NEXUS.openSheet("actionSheet"));
function openForm(id) { NEXUS.closeSheet("actionSheet"); NEXUS.openSheet(id); }
document.getElementById("userSelect").addEventListener("change", refreshAll);

function toggleMetricFields() {
  const type = document.getElementById("m_type").value;
  document.getElementById("m_singleField").classList.toggle("hidden", type === "bp");
  document.getElementById("m_bpFields").classList.toggle("hidden", type !== "bp");
}

async function refreshAll() {
  const user = document.getElementById("userSelect").value;
  document.getElementById("userLabel").textContent = user;
  document.getElementById("reminder").textContent = REMINDERS[user];

  const summary = await NEXUS.get(`/api/health/summary/${user}`);
  document.getElementById("calToday").textContent = summary.total_calories + " kcal";
  document.getElementById("latestWeight").textContent = summary.latest_weight || "—";

  const insight = await NEXUS.get(`/api/health/insight/${user}`);
  document.getElementById("insightBox").innerHTML = insight.insights.map(i => `• ${i}`).join("<br>");

  const chart = await NEXUS.get(`/api/health/weight-chart/${user}`);
  const chartEl = document.getElementById("weightChart");
  if (!chart.points.length) {
    chartEl.innerHTML = '<div class="empty">No weight logs yet</div>';
  } else {
    const points = chart.points.map((p, i) => ({ x: i, y: p.weight }));
    chartEl.innerHTML = NEXUS.lineChart({ points, goalY: chart.goal_target, goalLabel: "goal", unit: "kg" });
  }

  const logs = await NEXUS.get(`/api/health/logs?user_name=${encodeURIComponent(user)}`);
  const el = document.getElementById("logsList");
  if (!logs.length) { el.innerHTML = '<div class="empty">No logs yet</div>'; return; }
  el.innerHTML = logs.map(l => `
    <div class="list-item">
      <div>
        <div><strong>${l.title || l.log_type}</strong> <span class="mini-tag">${l.log_type}</span></div>
        <div class="meta">${l.value || ""} ${l.calories ? "· " + l.calories + " kcal" : ""} ${l.protein ? "· P" + l.protein + "g" : ""} ${l.fat ? "F" + l.fat + "g" : ""} ${l.carbs ? "C" + l.carbs + "g" : ""} ${l.cost_rmb ? "· ¥" + l.cost_rmb : ""}</div>
        <div class="meta">${NEXUS.fmtDate(l.created_at)}</div>
      </div>
      <button class="small secondary" onclick="deleteLog(${l.id})">✕</button>
    </div>
  `).join("");
}

function currentUser() { return document.getElementById("userSelect").value; }

async function submitDiet() {
  const title = document.getElementById("d_title").value.trim();
  if (!title) { alert("Meal name is required."); return; }
  await NEXUS.post("/api/health/logs", {
    user_name: currentUser(), log_type: "diet", title,
    calories: document.getElementById("d_calories").value,
    protein: document.getElementById("d_protein").value,
    fat: document.getElementById("d_fat").value,
    carbs: document.getElementById("d_carbs").value,
  });
  NEXUS.closeSheet("dietSheet");
  ["d_title","d_calories","d_protein","d_fat","d_carbs"].forEach(id => document.getElementById(id).value = "");
  refreshAll();
}

async function submitWorkout() {
  const type = document.getElementById("w_type").value;
  const duration = document.getElementById("w_duration").value;
  const burned = document.getElementById("w_burned").value;
  const steps = document.getElementById("w_steps").value;
  await NEXUS.post("/api/health/logs", {
    user_name: currentUser(), log_type: "workout", title: "calories_burned",
    value: String(burned || 0), calories: null,
  });
  if (steps) {
    await NEXUS.post("/api/health/logs", { user_name: currentUser(), log_type: "workout", title: type + " (steps)", value: `${steps} steps, ${duration} min` });
  } else {
    await NEXUS.post("/api/health/logs", { user_name: currentUser(), log_type: "workout", title: type, value: `${duration} min` });
  }
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
  await NEXUS.post("/api/health/logs", { user_name: currentUser(), log_type: "metric", title, value });
  NEXUS.closeSheet("metricSheet");
  ["m_value","m_systolic","m_diastolic"].forEach(id => document.getElementById(id).value = "");
  refreshAll();
}

async function submitSupplement() {
  const title = document.getElementById("s_title").value.trim();
  if (!title) { alert("Name is required."); return; }
  await NEXUS.post("/api/health/logs", { user_name: currentUser(), log_type: "supplement", title, value: document.getElementById("s_value").value });
  NEXUS.closeSheet("supplementSheet");
  ["s_title","s_value"].forEach(id => document.getElementById(id).value = "");
  refreshAll();
}

async function submitGrocery() {
  const title = document.getElementById("g_title").value.trim();
  const cost_rmb = document.getElementById("g_cost").value;
  if (!title || !cost_rmb) { alert("Item and cost are required."); return; }
  await NEXUS.post("/api/health/logs", { user_name: currentUser(), log_type: "grocery", title, cost_rmb });
  NEXUS.closeSheet("grocerySheet");
  ["g_title","g_cost"].forEach(id => document.getElementById(id).value = "");
  refreshAll();
}

async function deleteLog(id) {
  await NEXUS.del(`/api/health/logs/${id}`);
  refreshAll();
}

NEXUS.onChange("health", refreshAll);
refreshAll();
