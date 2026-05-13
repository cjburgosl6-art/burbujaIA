const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

console.log("✅ BACKEND ARRANCADO");

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = 3000;
const MEMORY_FILE = path.join(__dirname, "memory.json");
const SAVES_DIR = path.join(__dirname, "conversations");

let historial = fs.existsSync(MEMORY_FILE)
  ? JSON.parse(fs.readFileSync(MEMORY_FILE, "utf-8"))
  : [];

/* ================= IA ================= */
async function preguntarIA(mensaje) {
  const r = await axios.post("http://localhost:11434/api/generate", {
    model: "llama3",
    prompt:
      historial.join("\n") +
      "\n\nResponde de forma clara y útil.\n\nUsuario: " +
      mensaje +
      "\nAsistente:",
    stream: false
  });
  return r.data.response.trim();
}

/* ================= WEB ================= */
app.get("/", (_, res) => {
  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>IA Panel</title>

<style>
*{box-sizing:border-box}
body{margin:0;background:#0f0f0f;color:white;font-family:system-ui;height:100vh}
.panel{display:flex;flex-direction:column;height:100vh}
.messages{flex:1;overflow-y:auto;padding:10px}
.msg{margin-bottom:10px;padding:8px 10px;border-radius:8px;max-width:85%}
.user{background:#3a0f14;margin-left:auto}
.bot{background:#161616;border-left:4px solid #c1121f}
.thinking{font-style:italic;color:#aaa;margin-bottom:10px}

.bar{
  display:flex;
  gap:8px;
  padding:8px;
  border-top:1px solid #333;
}

textarea{
  flex:1;
  background:#111;
  color:white;
  border:1px solid #333;
  border-radius:6px;
  padding:6px;
  resize:none
}

button{
  background:#c1121f;
  color:white;
  border:none;
  border-radius:6px;
  padding:0 14px;
  font-weight:600;
  cursor:pointer
}

.save{background:#0f5132}
.clear{background:#450a0a;color:#fca5a5}
.list{background:#333}
</style>
</head>

<body>
<div class="panel">

  <div class="messages" id="mensajes">
    ${historial.map(h =>
      '<div class="msg ' + (h.startsWith("Usuario:") ? "user" : "bot") + '">' + h + '</div>'
    ).join("")}
  </div>

  <!-- ✅ BARRA CON TODOS LOS CONTROLES -->
  <div class="bar">
    <textarea id="input" placeholder="Escribe aquí…"></textarea>

    <button onclick="enviar()">Enviar</button>
    <button class="save" onclick="guardar()">💾</button>
    <button class="list" onclick="verConversaciones()">📂</button>
    <button class="clear" onclick="borrar()">🗑</button>
  </div>

</div>

<script>
const mensajes = document.getElementById("mensajes");

function scrollBottom(){
  mensajes.scrollTop = mensajes.scrollHeight;
}
scrollBottom();

/* ===== ENVIAR ===== */
function enviar(){
  const t = document.getElementById("input");
  const texto = t.value.trim();
  if(!texto) return;

  t.value = "";

  // ✅ mensaje del usuario inmediato
  const user = document.createElement("div");
  user.className = "msg user";
  user.textContent = "Usuario: " + texto;
  mensajes.appendChild(user);

  // ✅ indicador pensando
  const thinking = document.createElement("div");
  thinking.className = "thinking";
  thinking.id = "thinking";
  thinking.textContent = "La IA está pensando…";
  mensajes.appendChild(thinking);

  scrollBottom();

  fetch("/", {
    method:"POST",
    headers:{ "Content-Type":"application/x-www-form-urlencoded" },
    body:"mensaje="+encodeURIComponent(texto)
  }).then(() => {
    setTimeout(() => location.reload(), 600);
  });
}

/* ===== GUARDAR ===== */
function guardar(){
  const nombre = prompt("Nombre de la conversación:");
  if(nombre === null) return;

  fetch("/save",{
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ nombre })
  }).then(r=>{
    if(r.status===200) alert("✅ Conversación guardada");
    else alert("⚠️ No hay conversación que guardar");
  });
}

/* ===== VER CONVERSACIONES ===== */
function verConversaciones(){
  fetch("/conversations")
    .then(r=>r.json())
    .then(list=>{
      if(!list.length){
        alert("No hay conversaciones guardadas");
      } else {
        alert("Conversaciones guardadas:\\n\\n"+list.join("\\n"));
      }
    });
}

/* ===== BORRAR ACTUAL ===== */
function borrar(){
  if(!confirm("¿Borrar la conversación actual?")) return;
  fetch("/clear",{method:"POST"}).then(()=>location.reload());
}
</script>
</body>
</html>`);
});

/* ================= API ================= */
app.post("/", async (req,res)=>{
  if(!req.body.mensaje) return res.sendStatus(400);

  historial.push("Usuario: " + req.body.mensaje);
  historial.push("Asistente: " + await preguntarIA(req.body.mensaje));
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(historial, null, 2));

  res.sendStatus(200);
});

app.post("/clear",(_,res)=>{
  historial = [];
  if(fs.existsSync(MEMORY_FILE)) fs.unlinkSync(MEMORY_FILE);
  res.sendStatus(200);
});

app.post("/save",(req,res)=>{
  if(!historial.length) return res.sendStatus(204);
  if(!fs.existsSync(SAVES_DIR)) fs.mkdirSync(SAVES_DIR);

  const nombre = (req.body.nombre || "Conversacion")
    .replace(/\\s+/g,"_")
    .replace(/[\\/:*?"<>|]/g,"");

  fs.writeFileSync(
    path.join(SAVES_DIR, nombre + ".md"),
    historial.join("\\n\\n"),
    "utf-8"
  );

  res.sendStatus(200);
});

app.get("/conversations",(_,res)=>{
  if(!fs.existsSync(SAVES_DIR)) return res.json([]);
  res.json(fs.readdirSync(SAVES_DIR));
});

/* ================= START ================= */
app.listen(PORT, ()=>{
  console.log("Active AI, use the toggle");
});
