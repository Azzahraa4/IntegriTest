// =============================================================================
// js/ai-risk.js — IntegriTest AI Module (ADD-ON, murni JavaScript client-side)
//
// Engine "Rule-Based Heuristic + Lightweight Decision Rules" untuk:
//   1. Mengklasifikasi tiap pengangkatan HP (senggolan vs pengangkatan disengaja)
//   2. Menghitung Skor Risiko 0-100 per mahasiswa + level RENDAH / SEDANG / TINGGI
//   3. Mengekstrak alasan / log anomali otomatis (bahasa Indonesia)
//   4. Merangkum kondisi satu kelas (ringkasan eksekutif, statistik, timeline)
//
// File ini TIDAK memiliki dependensi (tanpa DOM, tanpa Firebase) sehingga aman,
// deterministik, dan bisa diuji di Node.js. Tidak ada satu pun file sistem lama
// yang diimpor / diubah oleh modul ini.
// =============================================================================

export const ALGO_VERSION = "1.0.0";

// ----------------------------- Konfigurasi ----------------------------------
export const CFG = {
  // Batas bawah (ms) tiap kategori durasi satu kali pengangkatan
  LIFT_MS: { PEEK: 2000, MEDIUM: 5000, LONG: 15000, EXTENDED: 30000 },

  // Batas skor untuk level risiko
  LEVEL_MIN: { SEDANG: 30, TINGGI: 60 },

  // Bobot komponen skor (total maksimum teoretis 105, lalu dibatasi 100)
  W: {
    FREQ_PER_LIFT: 7.5, FREQ_MAX: 30,     // frekuensi pengangkatan disengaja
    DUR_PER_SEC: 1.2,   DUR_MAX: 30,      // akumulasi durasi pengangkatan disengaja
    LONGEST_MAX: 20,                      // pengangkatan terpanjang (lihat LONGEST_PTS)
    PATTERN_MAX: 20,                      // pola perilaku mencurigakan
    BUMP_MAX: 5,                          // banyak getaran singkat berulang
  },
  LONGEST_PTS: { BUMP: 0, PEEK: 4, MEDIUM: 10, LONG: 16, EXTENDED: 20 },

  // Aturan pola
  PATTERN: {
    REGULAR_MIN_LIFTS: 3, REGULAR_CV: 0.35, REGULAR_PTS: 8,   // interval teratur
    BURST_MIN: 3, BURST_WINDOW_MS: 5 * 60 * 1000, BURST_PTS: 6, // beruntun
    RAPID_GAP_MS: 10 * 1000, RAPID_PTS: 4,                      // diangkat lagi < 10 dtk
    ONGOING_LONG_MS: 10 * 1000, ONGOING_PTS: 4,                 // sedang diangkat lama
    LOST_PTS: 5,                                                // koneksi putus saat diangkat
  },

  // Aturan lantai skor (override eksplisit)
  FLOOR: {
    HIGH_LIFTS: 4, HIGH_TOTAL_MS: 20000, HIGH_SCORE: 60,  // >=4x angkat & akumulasi >=20 dtk
    HIGH_LONGEST_MS: 30000,                // satu angkatan >= 30 dtk -> minimal TINGGI
    CRIT_LONGEST_MS: 60000, CRIT_SCORE: 75, // satu angkatan >= 60 dtk
  },

  // Deteksi outlier relatif terhadap kelas
  OUTLIER: { MIN_STUDENTS: 5, Z: 1.5, MIN_LIFTS: 2 },
};

export const CATEGORIES = {
  BUMP:     { label: "Senggolan / bergeser", deliberate: false },
  PEEK:     { label: "Angkat singkat",       deliberate: true },
  MEDIUM:   { label: "Angkat sedang",        deliberate: true },
  LONG:     { label: "Angkat lama",          deliberate: true },
  EXTENDED: { label: "Angkat sangat lama",   deliberate: true },
};

export const LEVELS = {
  RENDAH: { key: "RENDAH", title: "Risiko Rendah" },
  SEDANG: { key: "SEDANG", title: "Risiko Sedang" },
  TINGGI: { key: "TINGGI", title: "Risiko Tinggi" },
};

// ----------------------------- Utilitas -------------------------------------
const sum = (a, f = (x) => x) => a.reduce((s, x) => s + f(x), 0);
const mean = (a) => (a.length ? sum(a) / a.length : 0);
const std = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
};
const r1 = (x) => Math.round(x * 10) / 10;
export const num = (x, d = 1) => String(Number(x.toFixed(d))).replace(".", ",");

export function fmtDur(ms) {
  ms = Math.max(0, Number(ms) || 0);
  if (ms === 0) return "0 dtk";
  if (ms < 10000) return `${num(ms / 1000)} dtk`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} dtk`;
  if (s < 3600) return s % 60 === 0 ? `${s / 60} mnt` : `${Math.floor(s / 60)} mnt ${s % 60} dtk`;
  return `${Math.floor(s / 3600)} j ${Math.floor((s % 3600) / 60)} mnt`;
}
export const fmtTime = (t) => new Date(t).toLocaleString("id-ID", { hour12: false });
export const fmtClock = (t) => new Date(t).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", hour12: false });

export function classifyDuration(ms) {
  const L = CFG.LIFT_MS;
  if (ms < L.PEEK) return "BUMP";
  if (ms < L.MEDIUM) return "PEEK";
  if (ms < L.LONG) return "MEDIUM";
  if (ms < L.EXTENDED) return "LONG";
  return "EXTENDED";
}

export function levelOf(score) {
  if (score >= CFG.LEVEL_MIN.TINGGI) return "TINGGI";
  if (score >= CFG.LEVEL_MIN.SEDANG) return "SEDANG";
  return "RENDAH";
}

// --------------------- Analisis satu mahasiswa ------------------------------
/**
 * input = {
 *   deviceId, name,
 *   lifts:   [{ key, start, duration }]      // pengangkatan selesai (RESTORED), ms
 *   ongoing: { key, start, duration } | null // pengangkatan yang masih berlangsung
 *   lostWhileLifted: boolean                 // koneksi putus ketika HP sedang diangkat
 *   reportedCount: number | null             // liftCount dari status terkini (untuk cek kelengkapan log)
 *   offline: boolean, lastSeen: number|null
 * }
 */
export function analyzeStudent(input) {
  const W = CFG.W, P = CFG.PATTERN, F = CFG.FLOOR;

  // 1) Siapkan & klasifikasi semua pengangkatan
  const lifts = (input.lifts || []).map((l) => ({ ...l, duration: Math.max(0, Number(l.duration) || 0) }));
  if (input.ongoing) {
    lifts.push({ ...input.ongoing, duration: Math.max(0, Number(input.ongoing.duration) || 0), ongoing: true });
  }
  lifts.sort((a, b) => a.start - b.start);
  for (const l of lifts) {
    l.category = classifyDuration(l.duration);
    l.label = CATEGORIES[l.category].label;
    l.deliberate = CATEGORIES[l.category].deliberate;
  }
  const del = lifts.filter((l) => l.deliberate);
  const bumps = lifts.filter((l) => !l.deliberate);
  const n = del.length;
  const totalMs = sum(del, (l) => l.duration);
  const longest = n ? Math.max(...del.map((l) => l.duration)) : 0;
  const longestCat = n ? classifyDuration(longest) : "BUMP";

  // 2) Fitur pola waktu
  const gaps = [];
  for (let i = 1; i < del.length; i++) gaps.push(Math.max(0, del[i].start - (del[i - 1].start + del[i - 1].duration)));
  const minGap = gaps.length ? Math.min(...gaps) : null;
  const regular = n >= P.REGULAR_MIN_LIFTS && mean(gaps) > 0 && std(gaps) / mean(gaps) < P.REGULAR_CV;
  let burst = false;
  for (let i = 0; i + P.BURST_MIN - 1 < del.length; i++) {
    if (del[i + P.BURST_MIN - 1].start - del[i].start <= P.BURST_WINDOW_MS) { burst = true; break; }
  }
  const rapid = minGap !== null && minGap < P.RAPID_GAP_MS;
  const ongoingLong = !!input.ongoing && !input.lostWhileLifted && input.ongoing.duration >= P.ONGOING_LONG_MS;
  const lost = !!input.lostWhileLifted && !!input.ongoing;

  // 3) Skor per komponen
  const freq = Math.min(W.FREQ_MAX, n * W.FREQ_PER_LIFT);
  const dur = Math.min(W.DUR_MAX, (totalMs / 1000) * W.DUR_PER_SEC);
  const longestPts = Math.min(W.LONGEST_MAX, CFG.LONGEST_PTS[longestCat]);
  let pattern = 0;
  if (regular) pattern += P.REGULAR_PTS;
  if (burst) pattern += P.BURST_PTS;
  if (rapid) pattern += P.RAPID_PTS;
  if (ongoingLong) pattern += P.ONGOING_PTS;
  if (lost) pattern += P.LOST_PTS;
  pattern = Math.min(W.PATTERN_MAX, pattern);
  const bumpNoise = bumps.length >= 3 ? Math.min(W.BUMP_MAX, bumps.length) : 0;

  const raw = Math.min(100, freq + dur + longestPts + pattern + bumpNoise);

  // 4) Aturan lantai (override eksplisit)
  let floor = 0;
  const floorReasons = [];
  if (n >= F.HIGH_LIFTS && totalMs >= F.HIGH_TOTAL_MS) {
    floor = Math.max(floor, F.HIGH_SCORE);
    floorReasons.push(`Aturan eksplisit: ≥${F.HIGH_LIFTS}x pengangkatan dengan akumulasi ≥${F.HIGH_TOTAL_MS / 1000} dtk otomatis berstatus TINGGI.`);
  }
  if (longest >= F.HIGH_LONGEST_MS) {
    floor = Math.max(floor, F.HIGH_SCORE);
    floorReasons.push(`Aturan eksplisit: satu kali pengangkatan ≥${F.HIGH_LONGEST_MS / 1000} dtk otomatis berstatus TINGGI.`);
  }
  if (longest >= F.CRIT_LONGEST_MS) {
    floor = Math.max(floor, F.CRIT_SCORE);
    floorReasons.push(`Aturan eksplisit: satu kali pengangkatan ≥${F.CRIT_LONGEST_MS / 1000} dtk (skor minimal ${F.CRIT_SCORE}).`);
  }
  const score = Math.round(Math.max(raw, floor));
  const level = levelOf(score);

  // 5) Alasan / log anomali otomatis
  const reasons = [];
  const tone = { high: "high", mid: "mid", info: "info", ok: "ok" };
  if (n > 0) {
    reasons.push({ tone: n >= 4 ? tone.high : n >= 2 ? tone.mid : tone.info,
      text: `${n}x pengangkatan disengaja (≥${CFG.LIFT_MS.PEEK / 1000} dtk) dengan akumulasi durasi ${fmtDur(totalMs)}.` });
    reasons.push({ tone: longestCat === "EXTENDED" || longestCat === "LONG" ? tone.high : longestCat === "MEDIUM" ? tone.mid : tone.info,
      text: `Pengangkatan terpanjang ${fmtDur(longest)} (${CATEGORIES[longestCat].label.toLowerCase()}).` });
  }
  if (bumps.length) {
    reasons.push({ tone: tone.ok, text: n
      ? `${bumps.length} kejadian singkat (<${CFG.LIFT_MS.PEEK / 1000} dtk) dianggap senggolan/bergeser dan tidak dihitung sebagai pengangkatan.`
      : `${bumps.length} getaran/senggolan singkat (<${CFG.LIFT_MS.PEEK / 1000} dtk) — kemungkinan tidak sengaja.` });
  }
  if (bumpNoise) reasons.push({ tone: tone.info, text: `Banyak getaran singkat (${bumps.length}x) — meja mungkin tidak stabil atau HP sering tersentuh.` });
  const notes = [];
  if (regular) {
    notes.push("pola berulang teratur");
    reasons.push({ tone: tone.high, text: `Pola berulang teratur: jeda antar-pengangkatan hampir konstan (rata-rata ${fmtDur(mean(gaps))}).` });
  }
  if (burst) {
    notes.push("beruntun dalam waktu singkat");
    reasons.push({ tone: tone.mid, text: `Beruntun: ≥${P.BURST_MIN}x pengangkatan dalam ${P.BURST_WINDOW_MS / 60000} menit.` });
  }
  if (rapid) {
    notes.push("diangkat kembali <10 dtk");
    reasons.push({ tone: tone.mid, text: `HP diangkat kembali hanya ${fmtDur(minGap)} setelah diletakkan (indikasi cek berulang).` });
  }
  if (ongoingLong) {
    notes.push("sedang diangkat saat ini");
    reasons.push({ tone: tone.high, text: `HP sedang diangkat saat ini selama ${fmtDur(input.ongoing.duration)}.` });
  }
  if (lost) {
    notes.push("koneksi terputus saat diangkat");
    reasons.push({ tone: tone.high, text: "Koneksi perangkat terputus ketika HP sedang dalam kondisi diangkat (tab ditutup / jaringan mati)." });
  }
  for (const t of floorReasons) reasons.push({ tone: tone.high, text: t });
  const coverageGap = input.reportedCount != null ? Math.max(0, input.reportedCount - lifts.length) : 0;
  if (coverageGap > 0) {
    reasons.push({ tone: tone.info, text: `Log belum lengkap: ${coverageGap} pengangkatan hanya tercatat pada counter perangkat (di luar jendela 100 event Firebase). Skor bisa lebih rendah dari kondisi sebenarnya.` });
  }
  if (input.offline && !input.ongoing) {
    reasons.push({ tone: tone.info, text: "Perangkat saat ini OFFLINE — pemantauan terputus." });
  }
  if (!lifts.length) reasons.push({ tone: tone.ok, text: "Tidak ada pengangkatan terdeteksi." });

  // 6) Ringkasan satu kalimat
  const title = LEVELS[level].title;
  let summary;
  if (n > 0) {
    summary = `${title}: Terdeteksi ${n}x pengangkatan dengan akumulasi durasi ${fmtDur(totalMs)}, terpanjang ${fmtDur(longest)}` +
      (notes.length ? `; ${notes.join("; ")}` : "") + ".";
  } else if (lost) {
    summary = `${title}: Koneksi terputus ketika HP sedang diangkat.`;
  } else if (bumps.length) {
    summary = `${title}: Hanya ${bumps.length} getaran/senggolan singkat (<${CFG.LIFT_MS.PEEK / 1000} dtk), kemungkinan tidak sengaja.`;
  } else {
    summary = `${title}: Tidak ada pengangkatan terdeteksi.`;
  }

  return {
    deviceId: input.deviceId, name: input.name || input.deviceId,
    offline: !!input.offline, lastSeen: input.lastSeen ?? null,
    lifts, counts: { all: lifts.length, deliberate: n, bumps: bumps.length },
    totalMs, allMs: sum(lifts, (l) => l.duration), longestMs: longest, minGapMs: minGap,
    breakdown: {
      frequency: { pts: r1(freq), max: W.FREQ_MAX }, duration: { pts: r1(dur), max: W.DUR_MAX },
      longest: { pts: longestPts, max: W.LONGEST_MAX }, pattern: { pts: pattern, max: W.PATTERN_MAX },
      bumps: { pts: bumpNoise, max: W.BUMP_MAX },
    },
    rawScore: r1(raw), floorApplied: floor > raw, score, level, summary, reasons, coverageGap,
    flags: { regular, burst, rapid, ongoingLong, lost },
  };
}

// ------------------------- Timeline aktivitas -------------------------------
export function buildTimeline(lifts) {
  const pts = lifts.filter((l) => Number.isFinite(l.start));
  if (!pts.length) return { bucketMs: 0, buckets: [], max: 0 };
  const min = Math.min(...pts.map((l) => l.start)), max = Math.max(...pts.map((l) => l.start));
  const options = [60e3, 120e3, 300e3, 600e3, 900e3, 1800e3, 3600e3];
  const bucketMs = options.find((b) => (max - min) / b + 1 <= 24) || options[options.length - 1];
  const first = Math.floor(min / bucketMs) * bucketMs;
  const count = Math.floor((max - first) / bucketMs) + 1;
  const buckets = Array.from({ length: count }, (_, i) => ({ start: first + i * bucketMs, end: first + (i + 1) * bucketMs, count: 0, deliberate: 0 }));
  for (const l of pts) {
    const b = buckets[Math.floor((l.start - first) / bucketMs)];
    b.count++; if (l.deliberate) b.deliberate++;
  }
  return { bucketMs, buckets, max: Math.max(...buckets.map((b) => b.count)) };
}

// ------------------------ Analisis satu kelas -------------------------------
export function analyzeClass(analyses) {
  const ranked = [...analyses].sort((a, b) => b.score - a.score || b.totalMs - a.totalMs || String(a.name).localeCompare(String(b.name)));
  const counts = { RENDAH: 0, SEDANG: 0, TINGGI: 0 };
  ranked.forEach((a) => counts[a.level]++);

  // Outlier relatif kelas (z-score frekuensi) — hanya sebagai penanda, tidak mengubah skor
  const O = CFG.OUTLIER;
  if (ranked.length >= O.MIN_STUDENTS) {
    const ns = ranked.map((a) => a.counts.deliberate), m = mean(ns), s = std(ns);
    if (s > 0) {
      for (const a of ranked) {
        const z = (a.counts.deliberate - m) / s;
        if (a.counts.deliberate >= O.MIN_LIFTS && z >= O.Z) {
          a.outlier = true;
          a.reasons.push({ tone: "mid", text: `Outlier kelas: ${a.counts.deliberate}x pengangkatan jauh di atas rata-rata kelas (${num(m)}x, z = ${num(z)}).` });
        }
      }
    }
  }

  const allLifts = ranked.flatMap((a) => a.lifts);
  const timeline = buildTimeline(allLifts);
  const totalDeliberate = sum(ranked, (a) => a.counts.deliberate);
  const totalBumps = sum(ranked, (a) => a.counts.bumps);
  const totalMs = sum(ranked, (a) => a.totalMs);
  const avgScore = ranked.length ? Math.round(mean(ranked.map((a) => a.score))) : 0;
  const top = ranked[0] && ranked[0].score > 0 ? ranked[0] : null;
  const overview = {
    students: ranked.length, offline: ranked.filter((a) => a.offline).length, counts,
    totalLifts: totalDeliberate + totalBumps, totalDeliberate, totalBumps, totalMs, avgScore,
    maxScore: top ? top.score : 0, top,
  };

  // Narasi ringkasan eksekutif
  const narrative = [];
  if (!ranked.length) {
    narrative.push("Belum ada mahasiswa yang bergabung pada sesi ini, sehingga belum ada data untuk dianalisis.");
  } else {
    narrative.push(`Dari ${ranked.length} mahasiswa yang dipantau, ${counts.TINGGI} berisiko TINGGI, ${counts.SEDANG} SEDANG, dan ${counts.RENDAH} RENDAH.`);
    narrative.push(overview.totalLifts
      ? `Terekam ${overview.totalLifts} kejadian angkat (${totalDeliberate} pengangkatan disengaja dan ${totalBumps} senggolan singkat) dengan akumulasi durasi pengangkatan disengaja ${fmtDur(totalMs)}.`
      : "Tidak ada pengangkatan HP yang terekam pada periode ini.");
    if (top) narrative.push(`Skor rata-rata kelas ${avgScore}/100. Skor tertinggi: ${top.name} (${top.score}/100, ${LEVELS[top.level].title.toLowerCase()}).`);
    if (timeline.max > 0) {
      const pk = timeline.buckets.reduce((x, b) => (b.count > x.count ? b : x), timeline.buckets[0]);
      narrative.push(`Aktivitas terpadat pada pukul ${fmtClock(pk.start)}–${fmtClock(pk.end)} (${pk.count} kejadian angkat).`);
    }
    const names = (lv) => ranked.filter((a) => a.level === lv).map((a) => a.name).join(", ");
    if (counts.TINGGI) narrative.push(`Rekomendasi: lakukan verifikasi manual segera terhadap ${names("TINGGI")}.`);
    else if (counts.SEDANG) narrative.push(`Rekomendasi: tingkatkan pengawasan langsung terhadap ${names("SEDANG")}.`);
    else narrative.push("Rekomendasi: tidak ada indikasi kuat pelanggaran; lanjutkan pengawasan seperti biasa.");
  }
  return { ranked, overview, timeline, narrative };
}
