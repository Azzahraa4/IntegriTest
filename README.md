# IntegriTest (PWA + Firebase Realtime Database)

## Struktur
- `js/sensor.js` – Accelerometer, Proximity (jika ada), State Machine (SETUP → ON_DESK ⇄ LIFTED)
- `js/student.js` – HP 1: sensor → payload → Firebase
- `js/firebase-client.js` – koneksi cloud (WebSocket) + anonymous auth + sinkron jam server
- `js/supervisor.js` – HP 2: listener realtime, kartu status, alarm, notifikasi
- `js/storage.js` – IndexedDB untuk riwayat lokal
- **`js/ai-risk.js`** – (AI add-on) engine Rule-Based Heuristic: klasifikasi gerakan, skor risiko 0–100, alasan otomatis
- **`js/ai-report.js`** – (AI add-on) renderer HTML dashboard modal & laporan cetak
- **`js/ai-dashboard.js`** – (AI add-on) pengambilan data (read-only), modal interaktif, cetak/PDF
- **`css/ai.css`** – (AI add-on) gaya modal & format cetak A4

## Setup
1. https://console.firebase.google.com → buat project → **Build → Realtime Database** (Create database).
2. **Build → Authentication → Sign-in method → Anonymous → Enable**.
3. **Project settings → Your apps → Web (</>)** → salin config ke `js/config.js`.
4. Terapkan rules: `database.rules.json` (tempel di tab Rules, atau `firebase deploy --only database`).
5. Deploy HTTPS (WAJIB agar sensor & service worker jalan):
   ```
   npm i -g firebase-tools && firebase login && firebase init hosting   # public dir = .
   firebase deploy
   ```
   Uji lokal: `npx serve .` lalu `chrome://inspect/#devices` → port forwarding (localhost dianggap secure context).
6. Buka URL di kedua HP (Chrome Android) → "Add to Home screen" (opsional).

## Alur pakai
- HP 2: pilih **Pengawas**, kode sesi, tekan **Aktifkan Notifikasi & Alarm** (wajib gestur user).
- HP 1: pilih **Mahasiswa**, nama + kode sesi sama, tekan **Mulai**, lalu taruh telungkup.
- Payload: `{deviceId, name, ts, event, status, duration, totalDuration, liftCount, liftStartedAt, proximity, mode}`

## Izin & batasan penting
- Sensor gerak butuh **HTTPS**. iOS 13+ memunculkan dialog izin; Android Chrome tanpa dialog.
- **Proximity**: Chrome Android tidak lagi membuka sensor ini ke web. Aplikasi otomatis memakai
  mode `accel-only` (Z ≈ −9.8 & HP datar). Untuk proximity asli gunakan Flutter (`proximity_sensor`) / React Native.
- Layar HP 1 harus menyala & tab di foreground (Wake Lock dipakai); browser menghentikan sensor saat tab di-background.
- Notifikasi/alarm HP 2 saat layar mati tidak andal pada PWA (tanpa FCM push); biarkan layar & tab aktif.
- Tidak perlu satu Wi-Fi/subnet karena lewat cloud. Untuk LAN-only gunakan Mosquitto (WebSocket) + `mqtt.js`.
- Ambang kalibrasi ada di `T` pada `js/sensor.js`.

## Modul AI: Anomaly Detection & Risk Scoring (add-on, sisi pengawas)
Modul ini **tidak mengubah** `sensor.js`, `student.js`, `supervisor.js`, maupun `firebase-client.js`. Ia hanya *membaca* data yang sudah ada
(`students/` dan `events/` di Firebase + log IndexedDB) lewat listener tambahan, lalu menganalisisnya di browser (tanpa server / API key).

**Cara pakai:** di HP 2 (Pengawas) tekan **🤖 Analisis Risiko AI & Laporan** → lihat ringkasan eksekutif, kartu risiko, timeline, dan tabel per mahasiswa
(ketuk baris untuk melihat alasan & rincian). Tekan **🖨️ Cetak / Simpan PDF** lalu pilih *Save as PDF* pada dialog cetak browser.

**Algoritma (ringkas):**
- Tiap pengangkatan diklasifikasi dari durasi: `<2 dtk` senggolan (tidak dihitung) · `2–5` singkat · `5–15` sedang · `15–30` lama · `≥30` sangat lama.
- Skor 0–100 = frekuensi (maks 30) + akumulasi durasi (maks 30) + pengangkatan terpanjang (maks 20) + pola mencurigakan (maks 20) + getaran berulang (maks 5).
- Aturan lantai: ≥4x angkat dengan akumulasi ≥20 dtk, atau satu angkatan ≥30 dtk → minimal TINGGI.
- Level: `0–29` RENDAH · `30–59` SEDANG · `60–100` TINGGI. Semua ambang ada di objek `CFG` pada `js/ai-risk.js`.

**Catatan:**
- Payload sensor hanya berisi durasi/jumlah/waktu (bukan besaran akselerasi), jadi "senggolan" disimpulkan dari durasi singkat dan pola waktu.
- Listener events Firebase hanya memuat 100 event terakhir; riwayat lebih panjang dilengkapi dari log IndexedDB milik HP pengawas (biarkan HP 2 tetap terbuka selama ujian).
- Gunakan **Mulai periode baru** saat ujian baru dimulai bila kode sesi dipakai ulang; data lama tidak dihapus, hanya diabaikan oleh analisis.
- Skor adalah alat bantu keputusan, bukan bukti kecurangan.
