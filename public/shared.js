// Shared helper: REST calls + Socket.IO realtime sync, used identically by all 4 apps.
// Every device that opens the app connects to this SAME server/database, so
// any change made on one phone is pushed live to every other connected phone.

const NEXUS = (() => {
  const socket = io();
  const dot = () => document.getElementById("syncDot");

  socket.on("connect", () => { if (dot()) dot().classList.remove("off"); });
  socket.on("disconnect", () => { if (dot()) dot().classList.add("off"); });

  const listeners = {};
  socket.on("data:change", (payload) => {
    (listeners[payload.module] || []).forEach((fn) => fn(payload));
    (listeners["*"] || []).forEach((fn) => fn(payload));
  });

  function onChange(module, fn) {
    listeners[module] = listeners[module] || [];
    listeners[module].push(fn);
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`API ${method} ${url} failed: ${res.status}`);
    return res.json();
  }

  const get = (url) => api("GET", url);
  const post = (url, body) => api("POST", url, body);
  const put = (url, body) => api("PUT", url, body);
  const del = (url) => api("DELETE", url);

  function fmtMoney(n, currency = "RMB") {
    const v = Number(n || 0);
    if (currency === "IDR") return "Rp " + v.toLocaleString("id-ID", { maximumFractionDigits: 0 });
    return "¥" + v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }

  function fmtDate(s) {
    const d = new Date(s.replace(" ", "T") + "Z");
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function openSheet(id) { document.getElementById(id).classList.add("open"); }
  function closeSheet(id) { document.getElementById(id).classList.remove("open"); }

  // simple inline SVG line chart — used for weight trends, health charts, etc.
  // series: [{label, points: [{x, y}], color}], goalLine (optional): {y, label, color}
  function lineChart({ points, goalY, goalLabel, width = 320, height = 140, color = "#0F6E6E", unit = "" }) {
    if (!points || points.length === 0) return '<div class="empty">No data yet</div>';
    const pad = 24;
    const xs = points.map((p, i) => i);
    const ys = points.map((p) => p.y);
    if (goalY !== undefined) ys.push(goalY);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const range = maxY - minY || 1;
    const w = width - pad * 2, h = height - pad * 2;

    const sx = (i) => pad + (points.length > 1 ? (i / (points.length - 1)) * w : w / 2);
    const sy = (v) => pad + h - ((v - minY) / range) * h;

    const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
    const dots = points.map((p, i) => `<circle cx="${sx(i).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="3" fill="${color}" />`).join("");
    const goalLine = goalY !== undefined
      ? `<line x1="${pad}" y1="${sy(goalY).toFixed(1)}" x2="${width - pad}" y2="${sy(goalY).toFixed(1)}" stroke="#F87171" stroke-width="1.5" stroke-dasharray="4,3" />
         <text x="${width - pad}" y="${sy(goalY) - 4}" font-size="10" fill="#F87171" text-anchor="end">${goalLabel || 'goal'} ${goalY}${unit}</text>`
      : "";
    const lastLabel = points.length ? `<text x="${sx(points.length-1)}" y="${sy(points[points.length-1].y) - 8}" font-size="10" fill="${color}" text-anchor="end">${points[points.length-1].y}${unit}</text>` : "";

    return `
      <svg viewBox="0 0 ${width} ${height}" style="width:100%;height:auto;">
        ${goalLine}
        <path d="${pathD}" fill="none" stroke="${color}" stroke-width="2.5" />
        ${dots}
        ${lastLabel}
      </svg>
    `;
  }

  return { socket, onChange, get, post, put, del, fmtMoney, fmtDate, openSheet, closeSheet, lineChart };
})();
