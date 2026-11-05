// =============================================================================
// js/ai-report.js — IntegriTest AI Module (ADD-ON)
// Renderer HTML murni (string in → string out, tanpa DOM / Firebase):
//   • renderDashboard()  → isi modal interaktif di layar pengawas
//   • renderPrint()      → laporan lengkap format cetak / Simpan PDF
// =============================================================================
import { CFG, ALGO_VERSION, fmtDur, fmtTime, fmtClock, num } from "./ai-risk.js";

export const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const LV = { RENDAH: "low", SEDANG: "mid", TINGGI: "high" };
const badge = (lv) => `<span class="ai-badge ${LV[lv]}">${lv}</span>`;
const TONE_ICON = { high: "🔴", mid: "🟠", info: "🔵", ok: "🟢" };

// ------------------------------- Metodologi ---------------------------------
function methodologyItems() {
  const L = CFG.LIFT_MS, W = CFG.W, P = CFG.PATTERN, F = CFG.FLOOR, s = (ms) => ms / 1000;
  return [
    `<b>Klasifikasi durasi per pengangkatan:</b> &lt;${s(L.PEEK)} dtk = senggolan/bergeser (tidak dihitung sebagai pengangkatan disengaja); ${s(L.PEEK)}–${s(L.MEDIUM)} dtk = singkat; ${s(L.MEDIUM)}–${s(L.LONG)} dtk = sedang; ${s(L.LONG)}–${s(L.EXTENDED)} dtk = lama; ≥${s(L.EXTENDED)} dtk = sangat lama.`,
    `<b>Komponen skor (maks. 100):</b> frekuensi pengangkatan disengaja (${num(W.FREQ_PER_LIFT)} poin/angkat, maks. ${W.FREQ_MAX}); akumulasi durasi (${num(W.DUR_PER_SEC)} poin/dtk, maks. ${W.DUR_MAX}); pengangkatan terpanjang (maks. ${W.LONGEST_MAX}); pola mencurigakan (maks. ${W.PATTERN_MAX}); getaran singkat berulang (maks. ${W.BUMP_MAX}).`,
    `<b>Pola mencurigakan:</b> jeda antar-angkat teratur (+${P.REGULAR_PTS}), ≥${P.BURST_MIN}x angkat dalam ${P.BURST_WINDOW_MS / 60000} menit (+${P.BURST_PTS}), diangkat lagi &lt;${s(P.RAPID_GAP_MS)} dtk setelah diletakkan (+${P.RAPID_PTS}), sedang diangkat ≥${s(P.ONGOING_LONG_MS)} dtk (+${P.ONGOING_PTS}), koneksi putus saat diangkat (+${P.LOST_PTS}).`,
    `<b>Aturan lantai:</b> ≥${F.HIGH_LIFTS}x angkat dengan akumulasi ≥${s(F.HIGH_TOTAL_MS)} dtk, atau satu angkatan ≥${s(F.HIGH_LONGEST_MS)} dtk → minimal TINGGI (skor ${F.HIGH_SCORE}); satu angkatan ≥${s(F.CRIT_LONGEST_MS)} dtk → skor minimal ${F.CRIT_SCORE}.`,
    `<b>Level risiko:</b> 0–${CFG.LEVEL_MIN.SEDANG - 1} = RENDAH; ${CFG.LEVEL_MIN.SEDANG}–${CFG.LEVEL_MIN.TINGGI - 1} = SEDANG; ${CFG.LEVEL_MIN.TINGGI}–100 = TINGGI. Mahasiswa dengan frekuensi jauh di atas rata-rata kelas (z ≥ ${CFG.OUTLIER.Z}) diberi penanda outlier.`,
    `<b>Keterbatasan:</b> sensor hanya mengirim durasi, jumlah, dan waktu pengangkatan (bukan besaran akselerasi), sehingga "senggolan" disimpulkan dari durasi singkat dan pola waktu. Hasil adalah <b>alat bantu keputusan</b> untuk pengawas, bukan bukti kecurangan; selalu verifikasi langsung sebelum mengambil tindakan.`,
  ];
}

// -------------------------- Komponen dashboard ------------------------------
function statCard(label, value, sub = "", cls = "") {
  return `<div class="ai-stat ${cls}"><span>${esc(label)}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
}

function namesOf(ranked, lv, max = 5) {
  const list = ranked.filter((a) => a.level === lv).map((a) => esc(a.name));
  if (!list.length) return "—";
  return list.slice(0, max).join(", ") + (list.length > max ? ` +${list.length - max} lainnya` : "");
}

function riskCard(lv, a) {
  const c = a.overview.counts[lv], n = a.overview.students;
  const pct = n ? Math.round((c / n) * 100) : 0;
  return `<div class="ai-risk ${LV[lv]}"><div class="ai-risk-h">${lv}</div><b>${c}</b><small>${pct}% dari kelas</small><p>${namesOf(a.ranked, lv)}</p></div>`;
}

function distBar(a) {
  const n = a.overview.students; if (!n) return "";
  const seg = (lv) => (a.overview.counts[lv] ? `<i class="${LV[lv]}" style="width:${(a.overview.counts[lv] / n) * 100}%" title="${lv}: ${a.overview.counts[lv]}"></i>` : "");
  return `<div class="ai-dist">${seg("TINGGI")}${seg("SEDANG")}${seg("RENDAH")}</div>`;
}

function timelineChart(tl) {
  if (!tl.buckets.length) return `<p class="ai-muted">Belum ada kejadian angkat untuk ditampilkan.</p>`;
  const step = tl.buckets.length > 12 ? 2 : 1;
  const bars = tl.buckets.map((b, i) => {
    const h = tl.max ? Math.max(b.count ? 6 : 0, (b.count / tl.max) * 100) : 0;
    const dh = tl.max ? (b.deliberate / tl.max) * 100 : 0;
    return `<div class="ai-bar" title="${fmtClock(b.start)}–${fmtClock(b.end)}: ${b.count} kejadian (${b.deliberate} disengaja)">
      <em>${b.count || ""}</em><div class="ai-bar-col"><i class="all" style="height:${h}%"></i><i class="del" style="height:${dh}%"></i></div>
      <span>${i % step === 0 ? fmtClock(b.start) : ""}</span></div>`;
  }).join("");
  return `<div class="ai-tl">${bars}</div>
    <div class="ai-legend"><span><i class="all"></i> Semua kejadian angkat</span><span><i class="del"></i> Pengangkatan disengaja (≥${CFG.LIFT_MS.PEEK / 1000} dtk)</span><span>Interval ${fmtDur(tl.bucketMs)}</span></div>`;
}

function reasonsList(a) {
  return `<ul class="ai-reasons">${a.reasons.map((r) => `<li class="${r.tone}"><span>${TONE_ICON[r.tone]}</span><span>${esc(r.text)}</span></li>`).join("")}</ul>`;
}

function breakdownLine(a) {
  const b = a.breakdown, p = (k) => `${num(b[k].pts)}/${b[k].max}`;
  return `<div class="ai-bd"><span>Frekuensi <b>${p("frequency")}</b></span><span>Durasi <b>${p("duration")}</b></span><span>Terpanjang <b>${p("longest")}</b></span><span>Pola <b>${p("pattern")}</b></span><span>Getaran <b>${p("bumps")}</b></span><span class="tot">Skor akhir <b>${a.score}</b>${a.floorApplied ? " (aturan lantai)" : ""}</span></div>`;
}

function liftRows(a) {
  if (!a.lifts.length) return `<p class="ai-muted">Tidak ada kejadian angkat.</p>`;
  return `<div class="ai-scroll"><table class="ai-mini"><thead><tr><th>#</th><th>Waktu mulai</th><th>Durasi</th><th>Kategori</th></tr></thead><tbody>${
    a.lifts.map((l, i) => `<tr class="${l.deliberate ? "" : "faint"}"><td>${i + 1}</td><td>${l.start != null ? fmtTime(l.start) : "—"}</td><td>${fmtDur(l.duration)}${l.ongoing ? " (berlangsung)" : ""}</td><td>${esc(l.label)}${l.deliberate ? "" : " — tidak dihitung"}</td></tr>`).join("")
  }</tbody></table></div>`;
}

function studentTable(a, expanded) {
  if (!a.ranked.length) return `<p class="ai-muted">Belum ada data mahasiswa.</p>`;
  const rows = a.ranked.map((s, i) => {
    const open = expanded.has(s.deviceId);
    return `<tr class="ai-row ${open ? "open" : ""}" data-act="toggle" data-id="${esc(s.deviceId)}" tabindex="0" aria-expanded="${open}">
      <td>${i + 1}</td>
      <td><b>${esc(s.name)}</b>${s.outlier ? ` <span class="ai-tag">outlier</span>` : ""}${s.offline ? ` <span class="ai-tag off">offline</span>` : ""}<br><small>${esc(s.deviceId)}</small></td>
      <td class="n">${s.counts.deliberate}</td><td class="n">${s.counts.bumps}</td><td class="n">${fmtDur(s.totalMs)}</td><td class="n">${s.longestMs ? fmtDur(s.longestMs) : "—"}</td>
      <td><div class="ai-meter ${LV[s.level]}"><i style="width:${s.score}%"></i></div><b class="ai-score">${s.score}</b></td>
      <td>${badge(s.level)}</td><td class="ai-why">${esc(s.summary)}</td></tr>
      ${open ? `<tr class="ai-detail"><td colspan="9"><div class="ai-detail-in">${breakdownLine(s)}<div class="ai-two"><div><h4>Alasan / log anomali</h4>${reasonsList(s)}</div><div><h4>Rincian kejadian angkat</h4>${liftRows(s)}</div></div></div></td></tr>` : ""}`;
  }).join("");
  return `<div class="ai-scroll"><table class="ai-table"><thead><tr><th>#</th><th>Mahasiswa</th><th>Angkat</th><th>Senggol</th><th>Total durasi</th><th>Terpanjang</th><th>Skor</th><th>Risiko</th><th>Ringkasan alasan</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="ai-muted">Ketuk baris mahasiswa untuk melihat alasan dan rincian kejadian.</p>`;
}

// ------------------------------ Dashboard -----------------------------------
/** ui = { expanded:Set, cutoff:number, now:number, room:string, sources:{events,logs} } */
export function renderDashboard(a, ui) {
  const o = a.overview;
  return `
  <div class="ai-note">
    <span>Periode: <b>${ui.cutoff ? "sejak " + fmtTime(ui.cutoff) : "seluruh data sesi"}</b> · Sumber: ${ui.sources.events} event cloud + ${ui.sources.logs} log lokal · Diperbarui ${fmtClock(ui.now)}</span>
    <span class="ai-note-btns"><button class="ai-ghost sm" data-act="cutoff-new">Mulai periode baru (abaikan data lama)</button>${ui.cutoff ? `<button class="ai-ghost sm" data-act="cutoff-reset">Pakai semua data</button>` : ""}</span>
  </div>

  <section class="ai-card"><h3>Ringkasan Eksekutif</h3>${a.narrative.map((t) => `<p>${esc(t)}</p>`).join("")}</section>

  <section class="ai-grid4">
    ${statCard("Mahasiswa dipantau", o.students, `${o.students - o.offline} online · ${o.offline} offline`)}
    ${statCard("Pengangkatan disengaja", o.totalDeliberate, `+ ${o.totalBumps} senggolan singkat`)}
    ${statCard("Akumulasi durasi", fmtDur(o.totalMs), "pengangkatan disengaja")}
    ${statCard("Skor rata-rata kelas", `${o.avgScore}<small>/100</small>`, o.top ? `tertinggi: ${esc(o.top.name)} (${o.top.score})` : "belum ada skor")}
  </section>

  <section class="ai-grid3">${riskCard("TINGGI", a)}${riskCard("SEDANG", a)}${riskCard("RENDAH", a)}</section>
  ${distBar(a)}

  <section class="ai-card"><h3>Timeline Aktivitas Pengangkatan</h3>${timelineChart(a.timeline)}</section>

  <section class="ai-card"><h3>Tabel Analisis per Mahasiswa</h3>${studentTable(a, ui.expanded)}</section>

  <details class="ai-card ai-method"><summary>Metodologi & batasan algoritma (v${ALGO_VERSION})</summary><ul>${methodologyItems().map((t) => `<li>${t}</li>`).join("")}</ul></details>`;
}

// ------------------------------ Laporan cetak -------------------------------
/** meta = { room, now, cutoff, sources } */
export function renderPrint(a, meta) {
  const o = a.overview;
  const rows = a.ranked.map((s, i) => `<tr>
      <td>${i + 1}</td><td><b>${esc(s.name)}</b><br><small>${esc(s.deviceId)}</small></td>
      <td class="n">${s.counts.deliberate}</td><td class="n">${s.counts.bumps}</td><td class="n">${fmtDur(s.totalMs)}</td><td class="n">${s.longestMs ? fmtDur(s.longestMs) : "—"}</td>
      <td class="n"><b>${s.score}</b></td><td>${badge(s.level)}</td>
      <td>${esc(s.summary)}<ul class="p-r">${s.reasons.filter((r) => r.tone !== "ok").map((r) => `<li>${esc(r.text)}</li>`).join("")}</ul></td></tr>`).join("");

  const withLifts = a.ranked.filter((s) => s.lifts.length);
  const without = a.ranked.filter((s) => !s.lifts.length);
  const appendix = withLifts.map((s) => `<div class="p-block"><h4>${esc(s.name)} <small>(${esc(s.deviceId)})</small> ${badge(s.level)} <span class="p-sc">Skor ${s.score}/100</span></h4>
      <table class="p-mini"><thead><tr><th>#</th><th>Waktu mulai</th><th>Durasi</th><th>Kategori</th></tr></thead><tbody>${
        s.lifts.map((l, i) => `<tr><td>${i + 1}</td><td>${l.start != null ? fmtTime(l.start) : "—"}</td><td>${fmtDur(l.duration)}${l.ongoing ? " (berlangsung)" : ""}</td><td>${esc(l.label)}${l.deliberate ? "" : " (tidak dihitung)"}</td></tr>`).join("")
      }</tbody></table></div>`).join("");

  const tl = a.timeline.buckets.length
    ? `<table class="p-mini"><thead><tr><th>Rentang waktu</th><th>Kejadian angkat</th><th>Disengaja</th></tr></thead><tbody>${
        a.timeline.buckets.filter((b) => b.count).map((b) => `<tr><td>${fmtClock(b.start)}–${fmtClock(b.end)}</td><td>${b.count}</td><td>${b.deliberate}</td></tr>`).join("")
      }</tbody></table>` : `<p>Tidak ada kejadian angkat.</p>`;

  return `
  <div class="p-head">
    <div><div class="p-brand">IntegriTest</div><h1>Laporan Analisis Risiko Pengawasan Ujian</h1></div>
    <div class="p-meta">
      <div><span>Kode sesi</span><b>${esc(meta.room || "-")}</b></div>
      <div><span>Dicetak</span><b>${fmtTime(meta.now)}</b></div>
      <div><span>Periode data</span><b>${meta.cutoff ? "sejak " + fmtTime(meta.cutoff) : "seluruh data sesi"}</b></div>
      <div><span>Algoritma</span><b>Rule-Based Heuristic v${ALGO_VERSION}</b></div>
    </div>
  </div>

  <h2>1. Ringkasan Eksekutif</h2>
  ${a.narrative.map((t) => `<p>${esc(t)}</p>`).join("")}

  <h2>2. Statistik Kelas</h2>
  <table class="p-stats"><tbody>
    <tr><th>Mahasiswa dipantau</th><td>${o.students} (${o.students - o.offline} online, ${o.offline} offline)</td><th>Risiko TINGGI</th><td>${o.counts.TINGGI}</td></tr>
    <tr><th>Pengangkatan disengaja</th><td>${o.totalDeliberate}</td><th>Risiko SEDANG</th><td>${o.counts.SEDANG}</td></tr>
    <tr><th>Senggolan singkat</th><td>${o.totalBumps}</td><th>Risiko RENDAH</th><td>${o.counts.RENDAH}</td></tr>
    <tr><th>Akumulasi durasi</th><td>${fmtDur(o.totalMs)}</td><th>Skor rata-rata / tertinggi</th><td>${o.avgScore} / ${o.maxScore}</td></tr>
  </tbody></table>

  <h2>3. Analisis per Mahasiswa</h2>
  ${a.ranked.length ? `<table class="p-table"><thead><tr><th>#</th><th>Mahasiswa</th><th>Angkat</th><th>Senggol</th><th>Total durasi</th><th>Terpanjang</th><th>Skor</th><th>Risiko</th><th>Alasan / log anomali</th></tr></thead><tbody>${rows}</tbody></table>` : "<p>Belum ada data mahasiswa.</p>"}

  <h2>4. Timeline Aktivitas</h2>
  ${tl}

  <h2>5. Lampiran A — Log Aktivitas HP Seluruh Mahasiswa</h2>
  ${appendix || "<p>Tidak ada kejadian angkat yang tercatat.</p>"}
  ${without.length ? `<p class="p-none"><b>Tanpa kejadian angkat:</b> ${without.map((s) => esc(s.name)).join(", ")}.</p>` : ""}

  <h2>6. Lampiran B — Metodologi & Batasan</h2>
  <ul class="p-method">${methodologyItems().map((t) => `<li>${t}</li>`).join("")}</ul>

  <div class="p-sign"><div><p>Pengawas ujian,</p><div class="line"></div><small>Nama &amp; tanda tangan</small></div><div><p>Mengetahui,</p><div class="line"></div><small>Koordinator / dosen pengampu</small></div></div>
  <p class="p-foot">Dihasilkan otomatis oleh modul AI IntegriTest. Skor risiko merupakan alat bantu keputusan dan bukan bukti kecurangan.</p>`;
}
