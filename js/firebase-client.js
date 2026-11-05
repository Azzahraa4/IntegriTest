// Modul komunikasi cloud (Firebase Realtime Database via WebSocket)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getDatabase, ref, set, push, onValue, onChildAdded, onDisconnect, query, limitToLast }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
import { firebaseConfig, ROOT } from "./config.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
export const ready = signInAnonymously(getAuth(app));   // aktifkan "Anonymous" di Firebase Auth

let offset = 0; // selisih jam lokal vs server → semua timestamp konsisten antar HP
onValue(ref(db, ".info/serverTimeOffset"), (s) => (offset = s.val() || 0));
export const serverNow = () => Date.now() + offset;

const p = (room, path) => ref(db, `${ROOT}/${room}/${path}`);

export async function publishState(room, deviceId, payload) {
  await ready;
  return set(p(room, `students/${deviceId}`), payload);
}
export async function publishEvent(room, payload) {
  await ready;
  return push(p(room, "events"), payload);
}
export async function setupPresence(room, deviceId) {
  await ready;
  onDisconnect(p(room, `students/${deviceId}/online`)).set(false);
}
export async function listenStudents(room, cb) {
  await ready;
  onValue(p(room, "students"), (s) => cb(s.val() || {}));
}
export async function listenEvents(room, cb) {
  await ready;
  onChildAdded(query(p(room, "events"), limitToLast(100)), (s) => cb(s.key, s.val()));
}
export async function listenConnection(cb) {
  await ready;
  onValue(ref(db, ".info/connected"), (s) => cb(!!s.val()));
}
