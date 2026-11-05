// Modul sensor + State Machine deteksi angkat/letak.
// Konvensi sumbu (Android): HP telentang di meja → z ≈ +9.8; TELUNGKUP → z ≈ -9.8.

export const T = {
  ENTER_Z: -8.0, ENTER_TILT: 2.5,   // ambang masuk ke posisi "di meja" (ketat)
  STAY_Z: -6.5,  STAY_TILT: 4.5,    // ambang bertahan (longgar = histeresis)
  ARM_HOLD_MS: 1000,                // harus stabil 1 dtk agar dianggap diletakkan
  LIFT_HOLD_MS: 250,                // keluar dari posisi >250 ms = LIFTED
  RESTORE_HOLD_MS: 1000,            // stabil 1 dtk = RESTORED
  ALPHA: 0.2,                       // low-pass filter akselerometer
};

export class LiftStateMachine {
  /** emit(eventName, data) — eventName: ARMED | LIFTED | RESTORED */
  constructor(emit, clock = Date.now) {
    Object.assign(this, { emit, clock, state: "SETUP", liftCount: 0, liftStart: null, totalMs: 0,
      prox: null, g: { x: 0, y: 0, z: 0 }, _init: false, _flag: null, _since: 0 });
  }
  feedAccel(x, y, z) {
    if (!this._init) { this.g = { x, y, z }; this._init = true; }
    else { const a = T.ALPHA; this.g.x += a * (x - this.g.x); this.g.y += a * (y - this.g.y); this.g.z += a * (z - this.g.z); }
    this.tick();
  }
  feedProximity(near) { this.prox = near; this.tick(); }   // null = sensor tidak tersedia
  _isDesk(strict) {
    const { x, y, z } = this.g, tilt = Math.hypot(x, y);
    const geo = strict ? z < T.ENTER_Z && tilt < T.ENTER_TILT : z < T.STAY_Z && tilt < T.STAY_TILT;
    return geo && (this.prox === null || this.prox === true);   // Proximity=Near jika tersedia
  }
  tick() {
    if (!this._init) return;
    const now = this.clock(), desk = this._isDesk(this.state !== "ON_DESK");
    if (desk !== this._flag) { this._flag = desk; this._since = now; }
    const held = now - this._since;
    if (this.state === "SETUP" && desk && held >= T.ARM_HOLD_MS) {
      this.state = "ON_DESK"; this.emit("ARMED", {});
    } else if (this.state === "ON_DESK" && !desk && held >= T.LIFT_HOLD_MS) {
      this.state = "LIFTED"; this.liftStart = this._since; this.liftCount++;   // stopwatch mulai
      this.emit("LIFTED", { duration: 0 });
    } else if (this.state === "LIFTED" && desk && held >= T.RESTORE_HOLD_MS) {
      const duration = this._since - this.liftStart, startedAt = this.liftStart;
      this.totalMs += duration; this.state = "ON_DESK"; this.liftStart = null;
      this.emit("RESTORED", { duration, liftStartedAt: startedAt });
    }
  }
  elapsedLift() { return this.state === "LIFTED" ? this.clock() - this.liftStart : 0; }
}

export async function startMotion(cb) {
  if (typeof DeviceMotionEvent === "undefined") throw new Error("Accelerometer (DeviceMotion) tidak didukung browser ini.");
  if (typeof DeviceMotionEvent.requestPermission === "function") {          // iOS 13+
    if ((await DeviceMotionEvent.requestPermission()) !== "granted") throw new Error("Izin sensor gerak ditolak.");
  }
  const sign = /iP(hone|ad|od)/.test(navigator.userAgent) ? -1 : 1;        // iOS membalik tanda
  window.addEventListener("devicemotion", (e) => {
    const a = e.accelerationIncludingGravity;
    if (a && a.x != null) cb(sign * a.x, sign * a.y, sign * a.z);
  });
}

/** Proximity: banyak browser (Chrome Android) sudah TIDAK menyediakannya → fallback accel-only. */
export async function startProximity(cb) {
  try {
    if ("ProximitySensor" in window) {
      const s = new window.ProximitySensor({ frequency: 5 });
      s.addEventListener("reading", () => cb(s.near === true || (s.distance != null && s.distance < 3)));
      s.addEventListener("error", () => cb(null));
      s.start(); return true;
    }
  } catch (e) { console.warn("Proximity tak tersedia:", e); }
  return false;
}
