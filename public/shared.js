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

  return { socket, onChange, get, post, put, del, fmtMoney, fmtDate, openSheet, closeSheet };
})();
