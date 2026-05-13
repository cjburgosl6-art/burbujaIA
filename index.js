const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json()); 
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

const PORT = 3000;
const MEMORY_FILE = path.join(__dirname, "memory.json");
const SAVES_DIR = path.join(__dirname, "conversations");

if (!fs.existsSync(SAVES_DIR)) fs.mkdirSync(SAVES_DIR);

let historial = fs.existsSync(MEMORY_FILE) 
    ? JSON.parse(fs.readFileSync(MEMORY_FILE, "utf-8")) 
    : [];

/* --- IA --- */
async function preguntarIA(mensaje) {
    try {
        const r = await axios.post("http://localhost:11434/api/generate", {
            model: "llama3",
            prompt: historial.join("\n") + "\nUsuario: " + mensaje + "\nAsistente:",
            stream: false
        });
        return r.data.response.trim();
    } catch (e) {
        return "Error: Revisa si Ollama está encendido.";
    }
}

/* --- API --- */
app.post("/", async (req, res) => {
    const { mensaje } = req.body;
    if (!mensaje) return res.sendStatus(400);
    historial.push("Usuario: " + mensaje);
    const respuesta = await preguntarIA(mensaje);
    historial.push("Asistente: " + respuesta);
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(historial, null, 2));
    res.json({ ok: true });
});

app.post("/clear", (req, res) => {
    historial = [];
    if (fs.existsSync(MEMORY_FILE)) fs.unlinkSync(MEMORY_FILE);
    res.sendStatus(200);
});

app.post("/save", (req, res) => {
    const { nombre } = req.body;
    if (!historial.length) return res.status(400).send("No hay chat");
    const safeName = (nombre || "chat").replace(/[^a-z0-9]/gi, '_') + ".md";
    fs.writeFileSync(path.join(SAVES_DIR, safeName), historial.join("\n\n"));
    res.sendStatus(200);
});

app.get("/conversations", (req, res) => {
    const files = fs.readdirSync(SAVES_DIR).filter(f => f.endsWith(".md"));
    res.json(files);
});

app.post("/load", (req, res) => {
    const { nombre } = req.body;
    const filePath = path.join(SAVES_DIR, nombre);
    if (fs.existsSync(filePath)) {
        const contenido = fs.readFileSync(filePath, "utf-8");
        historial = contenido.split("\n\n").filter(l => l.trim() !== "");
        fs.writeFileSync(MEMORY_FILE, JSON.stringify(historial, null, 2));
        res.sendStatus(200);
    } else { res.sendStatus(404); }
});

app.post("/delete-file", (req, res) => {
    const { nombre } = req.body;
    const filePath = path.join(SAVES_DIR, nombre);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        res.sendStatus(200);
    } else { res.sendStatus(404); }
});

/* --- HTML --- */
app.get("/", (req, res) => {
    const htmlMensajes = historial.map(m => {
        const clase = m.startsWith('Usuario') ? 'user' : '';
        return `<div class="msg ${clase}">${m}</div>`;
    }).join('');

    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body { background: #0f0f0f; color: white; font-family: sans-serif; margin: 0; display: flex; flex-direction: column; height: 100vh; }
            #chat { flex: 1; overflow-y: auto; padding: 15px; }
            .msg { margin-bottom: 10px; padding: 10px; border-radius: 5px; background: #1a1a1a; border-left: 3px solid #c1121f; }
            .user { border-left-color: #555; background: #222; }
            .controls { display: flex; gap: 5px; padding: 10px; background: #111; border-top: 1px solid #333; }
            input { flex: 1; background: #000; color: white; border: 1px solid #444; padding: 8px; border-radius: 4px; box-sizing: border-box; }
            button { background: #c1121f; color: white; border: none; padding: 8px 12px; cursor: pointer; border-radius: 4px; font-weight: bold; }
            
            /* MODAL AJUSTADO */
            #overlay { display: none; position: fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index: 99; }
            #modal { 
                display: none; 
                position: fixed; 
                top: 50%; 
                left: 50%; 
                transform: translate(-50%, -50%); 
                background: #1a1a1a; 
                padding: 20px; 
                border: 1px solid #333; 
                border-radius: 8px; 
                z-index: 100; 
                width: 80%; 
                max-width: 400px; /* Limita el ancho en pantallas grandes */
                box-sizing: border-box; 
            }
            
            /* Ajuste específico para el input del modal */
            #modalInput { 
                width: 100%; 
                margin: 15px 0; 
                display: block; 
                box-sizing: border-box; /* Esto evita que sobresalga */
                padding: 10px;
                background: #000;
                border: 1px solid #444;
                color: white;
                border-radius: 4px;
            }

            .item-chat { display: flex; justify-content: space-between; align-items: center; background: #222; margin-bottom: 8px; padding: 10px; border-radius: 4px; border: 1px solid #333; }
            .chat-name { cursor: pointer; flex: 1; color: #eee; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .btn-del { background: transparent; color: #666; font-size: 18px; padding: 0 5px; }
            .btn-del:hover { color: #ff4d4d; }
        </style>
    </head>
    <body>
        <div id="overlay" onclick="closeModal()"></div>
        <div id="modal">
            <h3 id="modalTitle" style="margin-top:0; color:#c1121f;">Conversaciones</h3>
            <div id="modalContent"></div>
            <div id="modalInputContainer" style="display:none;">
                <input id="modalInput" placeholder="Nombre del archivo...">
                <button onclick="confirmSave()" style="width:100%; padding: 10px;">Guardar ahora</button>
            </div>
        </div>

        <div id="chat">${htmlMensajes}</div>
        
        <div class="controls">
            <input id="input" placeholder="Escribe algo..." onkeypress="if(event.key==='Enter') enviar()">
            <button onclick="enviar()">Enviar</button>
            <button onclick="abrirGuardar()">💾</button>
            <button onclick="ver()">📂</button>
            <button onclick="borrar()">🗑</button>
        </div>

        <script>
            // ... (Toda la lógica de script se mantiene igual que en la respuesta anterior) ...
            const chat = document.getElementById('chat');
            chat.scrollTop = chat.scrollHeight;

            function closeModal() {
                document.getElementById('overlay').style.display = 'none';
                document.getElementById('modal').style.display = 'none';
                document.getElementById('modalContent').innerHTML = '';
                document.getElementById('modalInputContainer').style.display = 'none';
            }

            function enviar() {
                const input = document.getElementById('input');
                const mensaje = input.value;
                if(!mensaje) return;
                input.value = 'Pensando...';
                input.disabled = true;
                fetch('/', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({mensaje})
                }).then(() => location.reload());
            }

            function abrirGuardar() {
                document.getElementById('overlay').style.display = 'block';
                document.getElementById('modal').style.display = 'block';
                document.getElementById('modalTitle').innerText = "Guardar conversación";
                document.getElementById('modalContent').innerHTML = "";
                document.getElementById('modalInputContainer').style.display = 'block';
                setTimeout(() => document.getElementById('modalInput').focus(), 50);
            }

            function confirmSave() {
                const nombre = document.getElementById('modalInput').value;
                if(!nombre) return;
                fetch('/save', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({nombre})
                }).then(r => {
                    if(r.ok) { closeModal(); location.reload(); }
                });
            }

            function ver() {
                fetch('/conversations').then(r => r.json()).then(list => {
                    document.getElementById('overlay').style.display = 'block';
                    document.getElementById('modal').style.display = 'block';
                    document.getElementById('modalTitle').innerText = "Cargar conversación";
                    const container = document.getElementById('modalContent');
                    container.innerHTML = "";
                    if(!list.length) {
                        container.innerHTML = "<p style='color:#666;'>No hay archivos.</p>";
                        return;
                    }
                    list.forEach(file => {
                        const div = document.createElement('div');
                        div.className = 'item-chat';
                        div.innerHTML = \`
                            <span class="chat-name" onclick="cargarArchivo('\${file}')">\${file}</span>
                            <button class="btn-del" onclick="borrarArchivo('\${file}')">🗑</button>
                        \`;
                        container.appendChild(div);
                    });
                });
            }

            function cargarArchivo(nombre) {
                fetch('/load', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({nombre})
                }).then(() => location.reload());
            }

            function borrarArchivo(nombre) {
                if(confirm("¿Eliminar " + nombre + "?")) {
                    fetch('/delete-file', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({nombre})
                    }).then(() => ver());
                }
            }

            function borrar() {
                if(confirm("¿Borrar chat actual?")) {
                    fetch('/clear', {method:'POST'}).then(() => location.reload());
                }
            }
        </script>
    </body>
    </html>
    `);
});

app.listen(PORT, () => console.log("Use the toggle to start using the assistant"));