const REMINDERS = {
  Yuvena: "Pre-meal lemon water / ACV · low-glycemic meals · prioritize potassium",
  Nadine: "Gluten/dairy/soy-free check · thyroid-supportive foods · moderate protein",
};

document.getElementById("fabBtn").addEventListener("click", () => NEXUS.openSheet("logSheet"));
document.getElementById("userSelect").addEventListener("change", refreshAll);

async function refreshAll() {
  const user = document.getElementById("userSelect").value;
  document.getElementById("userLabel").textContent = user;
  document.getElementById("reminder").textContent = REMINDERS[user];

  const summary = await NEXUS.get(`/api/health/summary/${user}`);
  document.getElementById("calToday").textContent = summary.total_calories + " kcal";
  document.getElementById("latestWeight").textContent = summary.latest_weight || "—";

  const logs = await NEXUS.get(`/api/health/logs?user_name=${encodeURIComponent(user)}`);
  const el = document.getElementById("logsList");
  if (!logs.length) { el.innerHTML = '<div class="empty">No logs yet</div>'; return; }
  el.innerHTML = logs.map(l => `
    <div class="list-item">
      <div>
        <div><strong>${l.title || l.log_type}</strong> <span class="meta">(${l.log_type})</span></div>
        <div class="meta">${l.value || ""} ${l.calories ? "· " + l.calories + " kcal" : ""} ${l.cost_rmb ? "· ¥" + l.cost_rmb : ""}</div>
        <div class="meta">${NEXUS.fmtDate(l.created_at)}</div>
      </div>
      <button class="small secondary" onclick="deleteLog(${l.id})">✕</button>
    </div>
  `).join("");
}

async function submitLog() {
  const user_name = document.getElementById("userSelect").value;
  const log_type = document.getElementById("l_type").value;
  const title = document.getElementById("l_title").value.trim();
  const value = document.getElementById("l_value").value.trim();
  const calories = document.getElementById("l_calories").value || null;
  const cost_rmb = document.getElementById("l_cost").value || null;
  if (!title) { alert("Title is required."); return; }

  await NEXUS.post("/api/health/logs", { user_name, log_type, title, value, calories, cost_rmb });
  NEXUS.closeSheet("logSheet");
  ["l_title","l_value","l_calories","l_cost"].forEach(id => document.getElementById(id).value = "");
  refreshAll();
}

async function deleteLog(id) {
  await NEXUS.del(`/api/health/logs/${id}`);
  refreshAll();
}

NEXUS.onChange("health", refreshAll);
refreshAll();
