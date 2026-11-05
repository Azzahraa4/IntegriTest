import "./pwa.js";
const $ = (id) => document.getElementById(id);
$("room").value = localStorage.getItem("room") || "";
$("name").value = localStorage.getItem("name") || "";
function go(page, needName) {
  const room = $("room").value.trim().toUpperCase(), name = $("name").value.trim();
  if (!room || (needName && !name)) return alert("Isi kode sesi" + (needName ? " dan nama." : "."));
  localStorage.setItem("room", room); localStorage.setItem("name", name);
  location.href = `${page}?room=${encodeURIComponent(room)}&name=${encodeURIComponent(name)}`;
}
$("btnStudent").onclick = () => go("student.html", true);
$("btnSup").onclick = () => go("supervisor.html", false);
