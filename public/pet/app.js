const PETS = {
  "妹妹": { nameEn: "Meimei", species: "Munchkin cat", coat: "蓝白 (blue-white)", gender: "Female", dob: "2023-07-01", baselineWeight: 2.6 },
  "馒头": { nameEn: "Mantou", species: "Munchkin cat", coat: "纯白 (pure white)", gender: "Male", dob: "2025-02-15", baselineWeight: 3.6 },
  "Mason": { nameEn: "Mason", species: "Shih Tzu dog", coat: "-", gender: "Male", dob: "2025-03-15", baselineWeight: 4.5 },
};

function ageString(dobStr) {
  const dob = new Date(dobStr);
  const now = new Date();
  let months = (now.getFullYear() - dob.getFullYear()) * 12 + (now.getMonth() - dob.getMonth());
  if (now.getDate() < dob.getDate()) months--;
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  return years > 0 ? `${years}y ${remMonths}mo` : `${remMonths} months`;
}

document.getElementById("fabBtn").addEventListener("click", () => NEXUS.openSheet("actionSheet"));
function openForm(id) { NEXUS.closeSheet("actionSheet"); NEXUS.openSheet(id); }
document.getElementById("petSelect").addEventListener("change", refreshAll);

function currentPet() { return document.getElementById("petSelect").value; }

function renderProfile() {
  const pet = currentPet();
  const p = PETS[pet];
  document.getElementById("profileCard").innerHTML = `
    <h3>${pet} (${p.nameEn})</h3>
    <div class="row"><span class="label">Species / breed</span><span class="val">${p.species}</span></div>
    <div class="row"><span class="label">Coat</span><span class="val">${p.coat}</span></div>
    <div class="row"><span class="label">Gender</span><span class="val">${p.gender}</span></div>
    <div class="row"><span class="label">DOB</span><span class="val">${p.dob}</span></div>
    <div class="row"><span class="label">Age</span><span class="val">${ageString(p.dob)}</span></div>
    <div class="row"><span class="label">Baseline weight</span><span class="val">${p.baselineWeight} kg</span></div>
  `;
}

async function refreshAll() {
  renderProfile();
  const pet = currentPet();

  const checklist = await NEXUS.get(`/api/pet/checklist/${encodeURIComponent(pet)}`);
  document.getElementById("feed_AM").checked = !!checklist.AM;
  document.getElementById("feed_PM").checked = !!checklist.PM;

  const insight = await NEXUS.get(`/api/pet/insight/${encodeURIComponent(pet)}`);
  const statusIcon = insight.status === "healthy" ? "✅" : (insight.status === "needs attention" ? "⚠️" : "ℹ️");
  document.getElementById("statusBox").innerHTML = `${statusIcon} <strong>${insight.status}</strong><br>${insight.note}`;

  const chart = await NEXUS.get(`/api/pet/weight-chart/${encodeURIComponent(pet)}`);
  const chartEl = document.getElementById("weightChart");
  if (!chart.points.length) {
    chartEl.innerHTML = '<div class="empty">No weight logs yet</div>';
  } else {
    const points = chart.points.map((p, i) => ({ x: i, y: p.weight }));
    chartEl.innerHTML = NEXUS.lineChart({ points, unit: "kg", color: "#8B5CF6" });
  }

  const logs = await NEXUS.get(`/api/pet/logs?pet_name=${encodeURIComponent(pet)}`);
  const el = document.getElementById("logsList");
  if (!logs.length) { el.innerHTML = '<div class="empty">No logs yet</div>'; return; }
  el.innerHTML = logs.map(l => `
    <div class="list-item">
      <div>
        <div><strong>${l.title || l.log_type}</strong> <span class="mini-tag">${l.log_type}</span></div>
        <div class="meta">${l.value || ""} ${l.weight_kg ? "· " + l.weight_kg + "kg" : ""} ${l.stool_type ? "· stool: " + l.stool_type : ""} ${l.urination_count ? "· urination: " + l.urination_count : ""} ${l.heart_rate ? "· HR " + l.heart_rate + "bpm" : ""} ${l.food_grams ? "· " + l.food_grams + "g" : ""} ${l.cost_rmb ? "· ¥" + l.cost_rmb : ""}</div>
        <div class="meta">${NEXUS.fmtDate(l.created_at)}</div>
      </div>
      <button class="small secondary" onclick="deleteLog(${l.id})">✕</button>
    </div>
  `).join("");
}

async function toggleFeed(meal) {
  const fed = document.getElementById(`feed_${meal}`).checked;
  await NEXUS.put(`/api/pet/checklist/${encodeURIComponent(currentPet())}`, { meal, fed });
}

async function submitDiet() {
  const food = document.getElementById("d_food").value;
  const meal = document.getElementById("d_meal").value;
  const grams = document.getElementById("d_grams").value;
  await NEXUS.post("/api/pet/logs", { pet_name: currentPet(), log_type: "diet", title: `${food} (${meal})`, food_grams: grams });
  NEXUS.closeSheet("dietSheet");
  document.getElementById("d_grams").value = "";
  refreshAll();
}

async function submitHealth() {
  const weight_kg = document.getElementById("h_weight").value;
  const stool_type = document.getElementById("h_stool").value;
  const urination_count = document.getElementById("h_urination").value;
  const heart_rate = document.getElementById("h_hr").value;
  const notes = document.getElementById("h_notes").value.trim();
  if (!weight_kg && !stool_type && !urination_count && !heart_rate) { alert("Enter at least one metric."); return; }
  await NEXUS.post("/api/pet/logs", {
    pet_name: currentPet(), log_type: "health", title: "health check", value: notes,
    weight_kg, stool_type, urination_count, heart_rate,
  });
  NEXUS.closeSheet("healthSheet");
  ["h_weight","h_urination","h_hr","h_notes"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("h_stool").value = "";
  refreshAll();
}

async function submitSupplement() {
  const title = document.getElementById("s_title").value.trim();
  if (!title) { alert("Name is required."); return; }
  await NEXUS.post("/api/pet/logs", { pet_name: currentPet(), log_type: "supplement", title, value: document.getElementById("s_value").value });
  NEXUS.closeSheet("supplementSheet");
  ["s_title","s_value"].forEach(id => document.getElementById(id).value = "");
  refreshAll();
}

async function submitGrocery() {
  const title = document.getElementById("g_title").value.trim();
  const cost_rmb = document.getElementById("g_cost").value;
  if (!title || !cost_rmb) { alert("Item and cost are required."); return; }
  await NEXUS.post("/api/pet/logs", { pet_name: currentPet(), log_type: "grocery", title, cost_rmb });
  NEXUS.closeSheet("grocerySheet");
  ["g_title","g_cost"].forEach(id => document.getElementById(id).value = "");
  refreshAll();
}

async function deleteLog(id) {
  await NEXUS.del(`/api/pet/logs/${id}`);
  refreshAll();
}

NEXUS.onChange("pet", refreshAll);
refreshAll();
