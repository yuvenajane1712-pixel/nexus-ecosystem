document.getElementById("fabBtn").addEventListener("click", () => NEXUS.openSheet("logSheet"));
document.getElementById("petSelect").addEventListener("change", refreshAll);

async function refreshAll() {
  const pet = document.getElementById("petSelect").value;
  const logs = await NEXUS.get(`/api/pet/logs?pet_name=${encodeURIComponent(pet)}`);
  const el = document.getElementById("logsList");
  if (!logs.length) { el.innerHTML = '<div class="empty">No logs yet</div>'; return; }
  el.innerHTML = logs.map(l => `
    <div class="list-item">
      <div>
        <div><strong>${l.title || l.log_type}</strong> <span class="meta">(${l.log_type})</span></div>
        <div class="meta">${l.value || ""} ${l.cost_rmb ? "· ¥" + l.cost_rmb : ""}</div>
        <div class="meta">${NEXUS.fmtDate(l.created_at)}</div>
      </div>
      <button class="small secondary" onclick="deleteLog(${l.id})">✕</button>
    </div>
  `).join("");
}

async function submitLog() {
  const pet_name = document.getElementById("petSelect").value;
  const log_type = document.getElementById("l_type").value;
  const title = document.getElementById("l_title").value.trim();
  const value = document.getElementById("l_value").value.trim();
  const cost_rmb = document.getElementById("l_cost").value || null;
  if (!title) { alert("Title is required."); return; }

  await NEXUS.post("/api/pet/logs", { pet_name, log_type, title, value, cost_rmb });
  NEXUS.closeSheet("logSheet");
  ["l_title","l_value","l_cost"].forEach(id => document.getElementById(id).value = "");
  refreshAll();
}

async function deleteLog(id) {
  await NEXUS.del(`/api/pet/logs/${id}`);
  refreshAll();
}

NEXUS.onChange("pet", refreshAll);
refreshAll();
