// =============================================================================
// js/ai-dashboard.js — IntegriTest AI Module (ADD-ON) — "glue" di sisi pengawas
//
// Tugas:
//   • Memasang listener Firebase TAMBAHAN (read-only) ke data yang sudah ada
//     (students/ & events/) — tidak menulis apa pun ke cloud.
//   • Menggabungkan data cloud + log IndexedDB milik supervisor.js (hanya dibaca).
//   • Menjalankan engine AI (ai-risk.js) dan menampilkan modal interaktif.
//   • Cetak laporan / Simpan PDF lewat window.print() bawaan browser.
//
// Modul ini terisolasi: jika terjadi error di sini, supervisor.js (sistem lama)
// tetap berjalan normal karena dimuat sebagai <script type="module"> terpisah.
// =============================================================================
import { listenStudents, listenEvents, serverNow } from "./firebase-client.js";
import { allLogs } from "./storage.js";
import { STALE_MS } from "./config.js";
import { analyzeStudent, analyzeClass } from "./ai-risk.js";
import { renderDashboard, renderPrint, esc } from "./ai-report.js";

const room = new URLSearchParams(location.search).get("room") || "";
const $ = (id) => document.getElementById(id);
const CUTOFF_KEY = `ai.cutoff.${room}`;

const state = {
  students: {},               // snapshot node students/ (status terkini tiap HP)
  events: new Map(),          // key → event dari node events/ (maks. 100 terakhir saat connect + semua yang baru)
  idb: [],                    // log RESTORED yang disimpan supervisor.js di IndexedDB
  expanded: new Set(),        // baris mahasiswa yang sedang dibuka
  cutoff: Number(localStorage.getItem(CUTOFF_KEY)) || 0,
  open: false,
};
let renderTimer = null, tickTimer = null, idbTimer = null, originalTitle = document.title;

// ------------------------------ Pengumpulan data ----------------------------
function buildInputs(now) {
  const cutoff = state.cutoff;
  const roomDevices = new Set(Object.keys(state.students));
  state.events.forEach((e) => e.deviceId && roomDevices.add(e.deviceId));

  const per = {};   // deviceId → { name, lifts: Map(key → lift) }
  const slot = (id, name) => (per[id] ||= { name: name || id, lifts: new Map() });
  Object.entries(state.students).forEach(([id, s]) => slot(id, s.name));

  const add = (key, id, name, start, duration) => {
    if (!id || !Number.isFinite(start) || start < cutoff) return;
    const p = slot(id, name);
    if (name) p.name = name;
    if (!p.lifts.has(key)) p.lifts.set(key, { key, start, duration: Math.max(0, Number(duration) || 0) });
  };
  const startOf = (e) => (e.liftStartedAt != null ? e.liftStartedAt : e.ts - (Number(e.duration) || 0) - 1000);

  state.events.forEach((e, key) => { if (e.event === "RESTORED") add(key, e.deviceId, e.name, startOf(e), e.duration); });
  // Log lokal tidak menyimpan kode sesi → hanya ambil milik perangkat yang ada di sesi ini
  state.idb.forEach((l) => { if (roomDevices.has(l.deviceId)) add(l.key, l.deviceId, l.name, startOf(l), l.duration); });

  return Object.entries(per).map(([id, p]) => {
    const s = state.students[id];
    const stale = s ? !s.online || now - s.ts > STALE_MS : true;
    let ongoing = null, lost = false;
    if (s && s.status === "LIFTED" && s.liftStartedAt && s.liftStartedAt >= cutoff) {
      lost = stale;
      ongoing = { key: `ongoing-${id}`, start: s.liftStartedAt, duration: Math.max(0, (stale ? s.ts || now : now) - s.liftStartedAt) };
    }
    return {
      deviceId: id, name: (s && s.name) || p.name, lifts: [...p.lifts.values()], ongoing, lostWhileLifted: lost,
      // counter perangkat hanya relevan jika tidak ada pemotongan periode
      reportedCount: !cutoff && s && Number.isFinite(s.liftCount) ? s.liftCount : null,
      offline: stale, lastSeen: s ? s.ts : null,
    };
  });
}

function analyze(now = serverNow()) {
  return analyzeClass(buildInputs(now).map(analyzeStudent));
}
const sources = () => ({ events: state.events.size, logs: state.idb.length });

// --------------------------------- Modal ------------------------------------
function ensureDom() {
  if ($("aiModal")) return;
  const modal = document.createElement("div");
  modal.id = "aiModal"; modal.className = "ai-modal";
  modal.innerHTML = `
    <div class="ai-backdrop" data-act="close"></div>
    <div class="ai-panel" role="dialog" aria-modal="true" aria-labelledby="aiTitle">
      <header class="ai-head">
        <div><div id="aiTitle" class="ai-title">🤖 Analisis Risiko AI</div><small>Sesi ${esc(room) || "-"} · anomaly detection &amp; risk scoring</small></div>
        <div class="ai-head-btns"><button id="aiPrintBtn" data-act="print">🖨️ Cetak / Simpan PDF</button><button class="ai-ghost" data-act="close" id="aiCloseBtn">✕ Tutup</button></div>
      </header>
      <div class="ai-body" id="aiBody"></div>
    </div>`;
  document.body.appendChild(modal);
  const printRoot = document.createElement("div");
  printRoot.id = "aiPrint";
  document.body.appendChild(printRoot);

  modal.addEventListener("click", onAction);
  modal.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.closest?.("[data-act=toggle]")) { e.preventDefault(); onAction(e); }
  });
}

function onAction(e) {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  if (act === "close") closeModal();
  else if (act === "print") printReport();
  else if (act === "toggle") {
    const id = el.dataset.id;
    state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);
    render();
  } else if (act === "cutoff-new") {
    if (confirm("Mulai periode analisis baru dari sekarang?\n\nData lama TIDAK dihapus; hanya diabaikan oleh analisis AI. Gunakan ini saat ujian baru dimulai.")) setCutoff(true);
  } else if (act === "cutoff-reset") setCutoff(0);
}

function setCutoff(on) {
  // gunakan jam server agar konsisten dengan timestamp event
  state.cutoff = on ? serverNow() : 0;
  try { state.cutoff ? localStorage.setItem(CUTOFF_KEY, String(state.cutoff)) : localStorage.removeItem(CUTOFF_KEY); } catch {}
  render();
}

async function refreshIdb() {
  try { state.idb = await allLogs(); } catch (e) { console.warn("[AI] gagal baca log lokal:", e); }
}

function render() {
  if (!state.open) return;
  const now = serverNow(), a = analyze(now);
  $("aiBody").innerHTML = renderDashboard(a, { expanded: state.expanded, cutoff: state.cutoff, now, room, sources: sources() });
}
function scheduleRender() {
  if (!state.open) return;
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 250);
}

async function openModal() {
  ensureDom();
  state.open = true;
  $("aiModal").classList.add("ai-show");
  document.body.classList.add("ai-open");
  originalTitle = document.title;
  document.title = `Laporan IntegriTest ${room}`.trim();
  await refreshIdb();
  render();
  tickTimer = setInterval(render, 2000);          // stopwatch pengangkatan yang sedang berlangsung
  idbTimer = setInterval(async () => { await refreshIdb(); }, 10000);
  $("aiCloseBtn").focus();
}

function closeModal() {
  state.open = false;
  clearInterval(tickTimer); clearInterval(idbTimer); clearTimeout(renderTimer);
  $("aiModal").classList.remove("ai-show");
  document.body.classList.remove("ai-open");
  document.title = originalTitle;
}

// ------------------------------- Cetak / PDF --------------------------------
function buildPrint() {
  const now = serverNow();
  $("aiPrint").innerHTML = renderPrint(analyze(now), { room, now, cutoff: state.cutoff, sources: sources() });
}
async function printReport() {
  await refreshIdb();
  buildPrint();
  setTimeout(() => window.print(), 50);   // pilih "Simpan sebagai PDF" pada dialog cetak
}
// Ctrl+P saat modal terbuka juga mencetak laporan terbaru
window.addEventListener("beforeprint", () => { if (state.open) buildPrint(); });

// ---------------------------------- Init ------------------------------------
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && state.open) closeModal(); });

(async function init() {
  const btn = $("aiOpen");
  if (!btn) return;
  btn.addEventListener("click", openModal);
  if (!room) return;
  try {
    await refreshIdb();
    const warn = (e) => console.warn("[AI] listener gagal:", e);   // sistem lama tidak terpengaruh
    listenStudents(room, (v) => { state.students = v || {}; scheduleRender(); }).catch(warn);
    listenEvents(room, (key, e) => { state.events.set(key, e); scheduleRender(); }).catch(warn);
  } catch (e) {
    console.warn("[AI] listener tidak dapat dipasang:", e);   // sistem lama tidak terpengaruh
  }
})();
