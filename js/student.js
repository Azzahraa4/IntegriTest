import "./pwa.js";
import { LiftStateMachine, startMotion, startProximity } from "./sensor.js";
import { publishState, publishEvent, setupPresence, serverNow } from "./firebase-client.js";

const q = new URLSearchParams(location.search);
const room = q.get("room"), name = q.get("name") || "Mahasiswa";
const deviceId = localStorage.getItem("deviceId") || (() => { const i = crypto.randomUUID().slice(0, 8); localStorage.setItem("deviceId", i); return i; })();
const $ = (id) => document.getElementById(id);
$("who").textContent = `${name} • ${deviceId} • sesi ${room}`;

let proxAvailable = false;
const fmt = (ms) => { const s = Math.round(ms / 1000); return s < 60 ? `${s} dtk` : `${Math.floor(s / 60)} mnt ${s % 60} dtk`; };

const snapshot = (event = "HEARTBEAT", extra = {}) => ({
  deviceId, name, ts: serverNow(), event, status: sm.state,
  duration: extra.duration ?? sm.elapsedLift(), totalDuration: sm.totalMs, liftCount: sm.liftCount,
  liftStartedAt: sm.liftStart, proximity: sm.prox, mode: proxAvailable ? "proximity+accel" : "accel-only", online: true,
});

const sm = new LiftStateMachine(async (event, data) => {
  const payload = snapshot(event, data);
  if (data.liftStartedAt) payload.liftStartedAt = data.liftStartedAt;
  render();
  try {
    await publishState(room, deviceId, payload);
    if (event !== "ARMED") await publishEvent(room, payload);   // LIFTED & RESTORED masuk log
  } catch (e) { $("debug").textContent = "Gagal kirim: " + e.message; }
}, serverNow);

function render() {
  const card = $("card"), st = $("status");
  card.className = "card " + ({ SETUP: "setup", ON_DESK: "ok", LIFTED: "lifted" }[sm.state]);
  st.textContent = { SETUP: "LETAKKAN HP TELUNGKUP", ON_DESK: "✅ DI MEJA", LIFTED: "⚠️ DIANGKAT" }[sm.state];
  $("count").textContent = sm.liftCount;
  $("total").textContent = fmt(sm.totalMs + sm.elapsedLift());
}

$("start").onclick = async () => {
  try {
    await startMotion((x, y, z) => sm.feedAccel(x, y, z));
    proxAvailable = await startProximity((n) => sm.feedProximity(n));
    try { await navigator.wakeLock?.request("screen"); } catch {}
    document.addEventListener("visibilitychange", async () => { if (!document.hidden) try { await navigator.wakeLock?.request("screen"); } catch {} });
    await setupPresence(room, deviceId);
    await publishState(room, deviceId, snapshot("START"));
    $("start").disabled = true; $("start").textContent = "Pemantauan aktif…";
    setInterval(() => { sm.tick(); render(); }, 250);
    setInterval(() => publishState(room, deviceId, snapshot()).catch(() => {}), 5000);   // heartbeat
    setInterval(() => {
      $("debug").textContent = `mode: ${proxAvailable ? "proximity+accel" : "accel-only (proximity tidak tersedia)"}\n` +
        `x=${sm.g.x.toFixed(2)} y=${sm.g.y.toFixed(2)} z=${sm.g.z.toFixed(2)} prox=${sm.prox}\nstate=${sm.state}`;
    }, 500);
    render();
  } catch (e) { alert(e.message); }
};
