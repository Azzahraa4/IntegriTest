import "./pwa.js";
import { listenStudents, listenEvents, listenConnection, serverNow } from "./firebase-client.js";
import { addLog, allLogs, clearLogs } from "./storage.js";
import { STALE_MS } from "./config.js";

const room = new URLSearchParams(location.search).get("room");
const $ = (id) => document.getElementById(id);
const fmtDur = (ms) => { const s = Math.round(ms / 1000); return s < 60 ? `${s} dtk` : `${Math.floor(s / 60)} mnt ${s % 60} dtk`; };
const fmtTime = (t) => new Date(t).toLocaleString("id-ID", { hour12: false });
let students = {}, audio = null, bannerTimer;

// ---------- Alarm & notifikasi ----------
$("enable").onclick = async () => {
  audio = audio || new (window.AudioContext || window.webkitAudioContext)();
  if ("Notification" in window) await Notification.requestPermission();
  $("enable").textContent = "🔔 Alarm aktif"; beep();
};
function beep(n = 3) {
  if (!audio) return;
  for (let i = 0; i < n; i++) {
    const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + i * 0.35;
    o.type = "square"; o.frequency.value = 880; g.gain.value = 0.2;
    o.connect(g).connect(audio.destination); o.start(t); o.stop(t + 0.22);
  }
}
async function notify(title, body) {
  navigator.vibrate?.([300, 150, 300]); beep();
  $("banner").textContent = `🚨 ${title} — ${body}`; $("banner").classList.remove("hidden");
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => $("banner").classList.add("hidden"), 8000);
  if ("Notification" in window && Notification.permission === "granted") {
    const reg = await navigator.serviceWorker?.getRegistration();
    reg ? reg.showNotification(title, { body, tag: "lift", renotify: true, vibrate: [300, 150, 300] }) : new Notification(title, { body });
  }
}

// ---------- Render ----------
function renderCards() {
  const now = serverNow(); let grand = 0;
  $("cards").innerHTML = Object.values(students).map((s) => {
    const stale = !s.online || now - s.ts > STALE_MS;
    grand += s.liftCount || 0;
    const lifted = s.status === "LIFTED" && !stale;
    const cls = stale ? "off" : lifted ? "lifted" : s.status === "ON_DESK" ? "ok" : "setup";
    const label = stale ? "OFFLINE" : lifted ? "⚠️ SEDANG DIANGKAT" : s.status === "ON_DESK" ? "✅ HP DI MEJA" : "⏳ BELUM DILETAKKAN";
    const live = (s.totalDuration || 0) + (lifted && s.liftStartedAt ? now - s.liftStartedAt : 0);
    return `<div class="card ${cls}"><div class="big">${esc(s.name)}</div><div class="sub">${label}${lifted && s.liftStartedAt ? " • " + fmtDur(now - s.liftStartedAt) : ""}</div>
      <div class="stats"><div><b>${s.liftCount || 0}</b><span>Pengangkatan</span></div><div><b>${fmtDur(live)}</b><span>Total durasi</span></div></div>
      <div class="sub" style="font-size:.75rem">${s.deviceId} • ${s.mode || ""}</div></div>`;
  }).join("") || `<p class="hint">Menunggu HP 1 bergabung di sesi <b>${esc(room)}</b>…</p>`;
  $("grand").textContent = grand;
}
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
async function renderLog() {
  const logs = await allLogs();
  $("log").innerHTML = logs.map((l) => `<li><span><b>${esc(l.name)}</b> mengangkat HP<br><small>${fmtTime(l.liftStartedAt || l.ts)}</small></span><b>${fmtDur(l.duration)}</b></li>`).join("")
    || `<li><small>Belum ada riwayat.</small></li>`;
}

// ---------- Listener realtime ----------
const seenLift = new Set();
listenConnection((ok) => { $("conn").textContent = ok ? "terhubung" : "terputus"; $("conn").className = "badge " + (ok ? "on" : "off"); });
listenStudents(room, (v) => { students = v; renderCards(); });
listenEvents(room, async (key, e) => {
  if (e.event === "RESTORED") {                      // simpan ke IndexedDB (dedupe by key)
    if (await addLog({ key, ts: e.ts, name: e.name, deviceId: e.deviceId, duration: e.duration, liftStartedAt: e.liftStartedAt })) renderLog();
  } else if (e.event === "LIFTED" && !seenLift.has(key)) {
    seenLift.add(key);
    if (serverNow() - e.ts < 15000) notify("HP DIANGKAT!", `${e.name} mengangkat ponselnya`);   // abaikan event lama saat replay
  }
});
setInterval(renderCards, 1000);   // stopwatch live & deteksi offline
$("clear").onclick = async () => { if (confirm("Hapus semua log lokal?")) { await clearLogs(); renderLog(); } };
renderLog();
