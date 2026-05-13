const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json()); 
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
    // Generamos el HTML de los mensajes antes de enviar el string
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
            input { flex: 1; background: #000; color: white; border: 1px solid #444; padding: 8px; border-radius: 4px; }
            button { background: #c1121f; color: white; border: none; padding: 8px 12px; cursor: pointer; border-radius: 4px; font-weight: bold; }
            #modal { display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); 
                     background: #1a1a1a; padding: 20px; border: 1px solid #c1121f; border-radius: 8px; z-index: 100; width: 80%; }
            #overlay { display: none; position: fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index: 99; }
        </style>
    </head>
    <body>
        <div id="overlay"></div>
        <div id="modal">
            <p id="modalText"></p>
            <input id="modalInput" style="width:100%; margin-bottom:10px;">
            <div style="display:flex; gap:5px; justify-content:flex-end;">
                <button onclick="closeModal()">Cancelar</button>
                <button id="modalConfirm">Aceptar</button>
            </div>
        </div>

        <div id="chat">${htmlMensajes}</div>
        
        <div class="controls">
            <input id="input" placeholder="Escribe algo..." onkeypress="if(event.key==='Enter') enviar()">
            <button onclick="enviar()">Enviar</button>
            <button onclick="pedirNombre()">💾</button>
            <button onclick="ver()">📂</button>
            <button onclick="borrar()">🗑</button>
        </div>

        <script>
            const chat = document.getElementById('chat');
            chat.scrollTop = chat.scrollHeight;

            function showPrompt(text, callback) {
                document.getElementById('overlay').style.display = 'block';
                document.getElementById('modal').style.display = 'block';
                document.getElementById('modalText').innerText = text;
                document.getElementById('modalInput').value = '';
                document.getElementById('modalInput').focus();
                document.getElementById('modalConfirm').onclick = () => {
                    callback(document.getElementById('modalInput').value);
                    closeModal();
                };
            }

            function closeModal() {
                document.getElementById('overlay').style.display = 'none';
                document.getElementById('modal').style.display = 'none';
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
                    body: JSON.stringify({mensaje: mensaje})
                }).then(() => location.reload());
            }

            function pedirNombre() {
                showPrompt("Nombre del archivo:", (nombre) => {
                    if(!nombre) return;
                    fetch('/save', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({nombre: nombre})
                    }).then(r => r.ok ? alert("Guardado con éxito") : alert("Error"));
                });
            }

            function ver() {
                fetch('/conversations').then(r => r.json()).then(list => {
                    if(!list.length) return alert("No hay archivos");
                    let listaStr = "Escribe el número para cargar o 'del número' para borrar:\\n";
                    list.forEach((f, i) => listaStr += (i+1) + ". " + f + "\\n");
                    
                    showPrompt(listaStr, (res) => {
                        if(!res) return;
                        const isDel = res.toLowerCase().startsWith("del ");
                        const partes = res.split(" ");
                        const numTxt = isDel ? partes[1] : partes[0];
                        const num = parseInt(numTxt) - 1;
                        const file = list[num];
                        
                        if(!file) return alert("Número no válido");

                        fetch(isDel ? "/delete-file" : "/load", {
                            method: "POST",
                            headers: {"Content-Type": "application/json"},
                            body: JSON.stringify({nombre: file})
                        }).then(() => location.reload());
                    });
                });
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

app.listen(PORT, () => console.log("Servidor en puerto " + PORT));