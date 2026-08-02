document.getElementById("fabBtn").addEventListener("click", () => {
  const choice = prompt("Add what?\n1 = Transaction\n2 = Wishlist item", "1");
  if (choice === "2") NEXUS.openSheet("wishSheet");
  else NEXUS.openSheet("txSheet");
});

async function refreshAll() {
  const s = await NEXUS.get("/api/budget/summary");

  document.getElementById("capLabel").textContent = `Spent ${NEXUS.fmtMoney(s.totalExpense)} of ${NEXUS.fmtMoney(s.monthCap)}`;
  document.getElementById("capVal").textContent = s.overBudget ? "OVER BUDGET" : NEXUS.fmtMoney(s.remainingMonthBudget) + " left";
  const pct = Math.min(100, (s.totalExpense / s.monthCap) * 100);
  const capProgress = document.getElementById("capProgress");
  capProgress.className = "progress" + (s.overBudget ? " over" : "");
  capProgress.querySelector("div").style.width = pct + "%";

  const catEl = document.getElementById("categoryCaps");
  catEl.innerHTML = Object.entries(s.caps).map(([cat, cap]) => {
    const spent = s.byCategory[cat] || 0;
    const p = Math.min(100, (spent / cap) * 100);
    const over = spent > cap;
    return `
      <div style="margin-bottom:10px;">
        <div class="row"><span class="label">${cat}</span><span class="val">${NEXUS.fmtMoney(spent)} / ${NEXUS.fmtMoney(cap)}</span></div>
        <div class="progress ${over ? 'over' : ''}"><div style="width:${p}%"></div></div>
      </div>
    `;
  }).join("");

  document.getElementById("goalPct").textContent = s.goalProgressPct.toFixed(2) + "%";
  document.getElementById("goalBar").style.width = Math.min(100, s.goalProgressPct) + "%";
  document.getElementById("runway").textContent = s.runwayMonths ? s.runwayMonths.toFixed(1) + " months" : "no draws logged yet";

  const txs = await NEXUS.get("/api/budget/transactions");
  const txEl = document.getElementById("txList");
  if (!txs.length) { txEl.innerHTML = '<div class="empty">No transactions yet</div>'; }
  else {
    txEl.innerHTML = txs.slice(0, 30).map(t => `
      <div class="list-item">
        <div>
          <div><strong>${t.category}</strong> <span class="tag ${t.kind}">${t.kind}</span></div>
          <div class="meta">${t.note || t.source} · ${NEXUS.fmtDate(t.created_at)}</div>
        </div>
        <div style="text-align:right;">
          <div class="val">${NEXUS.fmtMoney(t.amount_rmb)}</div>
          <button class="small secondary" style="margin-top:4px;" onclick="deleteTx(${t.id})">✕</button>
        </div>
      </div>
    `).join("");
  }

  const wl = await NEXUS.get("/api/budget/wishlist");
  const wlEl = document.getElementById("wishlist");
  if (!wl.length) { wlEl.innerHTML = '<div class="empty">Nothing on the wishlist yet</div>'; }
  else {
    wlEl.innerHTML = wl.map(w => {
      const p = Math.min(100, (w.saved_rmb / w.price_rmb) * 100);
      return `
        <div class="card">
          <div class="row"><span class="label"><strong>${w.item}</strong></span><span class="val">${NEXUS.fmtMoney(w.saved_rmb)} / ${NEXUS.fmtMoney(w.price_rmb)}</span></div>
          <div class="progress"><div style="width:${p}%"></div></div>
          <div class="grid2" style="margin-top:8px;">
            <button class="small secondary" onclick="addSaving(${w.id})">+ ¥50 saved</button>
            <button class="small danger" onclick="deleteWish(${w.id})">Remove</button>
          </div>
        </div>
      `;
    }).join("");
  }
}

async function submitTx() {
  const kind = document.getElementById("tx_kind").value;
  const category = document.getElementById("tx_category").value;
  const amount_rmb = document.getElementById("tx_amount").value;
  const note = document.getElementById("tx_note").value;
  if (!amount_rmb) { alert("Amount is required."); return; }
  await NEXUS.post("/api/budget/transactions", { kind, category, amount_rmb, note });
  NEXUS.closeSheet("txSheet");
  document.getElementById("tx_amount").value = "";
  document.getElementById("tx_note").value = "";
  refreshAll();
}

async function deleteTx(id) {
  await NEXUS.del(`/api/budget/transactions/${id}`);
  refreshAll();
}

async function submitWish() {
  const item = document.getElementById("w_item").value.trim();
  const price_rmb = document.getElementById("w_price").value;
  const priority = document.getElementById("w_priority").value || 0;
  if (!item || !price_rmb) { alert("Item and price are required."); return; }
  await NEXUS.post("/api/budget/wishlist", { item, price_rmb, priority });
  NEXUS.closeSheet("wishSheet");
  document.getElementById("w_item").value = "";
  document.getElementById("w_price").value = "";
  refreshAll();
}

async function addSaving(id) {
  await NEXUS.put(`/api/budget/wishlist/${id}/save`, { amount: 50 });
  refreshAll();
}
async function deleteWish(id) {
  await NEXUS.del(`/api/budget/wishlist/${id}`);
  refreshAll();
}

NEXUS.onChange("budget", refreshAll);
refreshAll();
