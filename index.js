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
    const { mensaje, isSystem } = req.body;
    if (!mensaje) return res.sendStatus(400);
    if (isSystem) {
        historial.push("Sistema: " + mensaje);
        fs.writeFileSync(MEMORY_FILE, JSON.stringify(historial, null, 2));
        return res.json({ ok: true });
    }
    historial.push("Usuario: " + mensaje);
    const respuesta = await preguntarIA(mensaje);
    historial.push("Asistente: " + respuesta);
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(historial, null, 2));
    res.json({ ok: true });
});

app.post("/clear", (req, res) => {
    historial = [];
    if (fs.existsSync(MEMORY_FILE)) { try { fs.unlinkSync(MEMORY_FILE); } catch(e) {} }
    res.sendStatus(200);
});

app.post("/save", (req, res) => {
    const { nombre } = req.body;
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
    const contenido = fs.readFileSync(path.join(SAVES_DIR, nombre), "utf-8");
    historial = contenido.split("\n\n").filter(l => l.trim() !== "");
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(historial, null, 2));
    res.sendStatus(200);
});

app.post("/delete-file", (req, res) => {
    fs.unlinkSync(path.join(SAVES_DIR, req.body.nombre));
    res.sendStatus(200);
});

/* --- HTML --- */
app.get("/", (req, res) => {
    const htmlMensajes = historial
        .filter(m => !m.startsWith('Sistema:'))
        .map(m => {
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
            
            #overlay { display: none; position: fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index: 99; }
            #modal { display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #1a1a1a; padding: 20px; border: 1px solid #333; border-radius: 8px; z-index: 100; width: 80%; max-width: 400px; box-sizing: border-box; text-align: center; }
            .lang-btn { width: 100%; margin: 5px 0; padding: 12px; background: #222; border: 1px solid #444; color: white; cursor: pointer; border-radius: 4px; }
            #modalInput { width: 100%; margin: 15px 0; display: block; box-sizing: border-box; padding: 10px; background: #000; border: 1px solid #444; color: white; border-radius: 4px; }
            .item-chat { display: flex; justify-content: space-between; align-items: center; background: #222; margin-bottom: 8px; padding: 10px; border-radius: 4px; border: 1px solid #333; }
            
            /* Estilo para botón cancelar */
            .btn-cancelar { background: #444; margin-top: 10px; width: 100%; }
            .btn-cancelar:hover { background: #555; }
        </style>
    </head>
    <body>
        <div id="overlay" onclick="closeModal()"></div>
        <div id="modal">
            <h3 id="modalTitle" style="margin-top:0; color:#c1121f;"></h3>
            <div id="modalContent"></div>
            <div id="modalInputContainer" style="display:none;">
                <input id="modalInput">
                <button id="modalConfirmBtn" onclick="confirmSave()" style="width:100%;"></button>
            </div>
            <!-- Botón Cancelar universal para el modal -->
            <button id="btnCancelGlobal" class="btn-cancelar" onclick="closeModal()"></button>
        </div>

        <div id="chat">${htmlMensajes}</div>
        
        <div class="controls">
            <input id="input" onkeypress="if(event.key==='Enter') enviar()">
            <button id="btnEnviar" onclick="enviar()"></button>
            <button onclick="abrirGuardar()">💾</button>
            <button onclick="ver()">📂</button>
            <button onclick="borrar()">🗑</button>
        </div>

        <script>
            const chat = document.getElementById('chat');
            const textos = {
                'Español': { 
                    send: 'Enviar', placeholder: 'Escribe algo...', pensar: 'Pensando...', 
                    saveTitle: 'Guardar conversación', saveBtn: 'Guardar ahora', 
                    loadTitle: 'Cargar conversación', delConfirm: '¿Eliminar?', 
                    clearConfirm: '¿Borrar chat actual?', noFiles: 'No hay archivos',
                    cancel: 'Cancelar'
                },
                'Inglés': { 
                    send: 'Send', placeholder: 'Type something...', pensar: 'Thinking...', 
                    saveTitle: 'Save conversation', saveBtn: 'Save now', 
                    loadTitle: 'Load conversation', delConfirm: 'Delete?', 
                    clearConfirm: 'Clear current chat?', noFiles: 'No files',
                    cancel: 'Cancel'
                },
                'Francés': { 
                    send: 'Envoyer', placeholder: 'Écrivez quelque chose...', pensar: 'En pensant...', 
                    saveTitle: 'Enregistrer la conversation', saveBtn: 'Enregistrer', 
                    loadTitle: 'Charger la conversation', delConfirm: 'Supprimer?', 
                    clearConfirm: 'Effacer le chat?', noFiles: 'Pas de fichiers',
                    cancel: 'Annuler'
                }
            };

            let idiomaActual = localStorage.getItem('chat_lang') || 'Español';

            function aplicarIdioma(lang) {
                idiomaActual = lang;
                localStorage.setItem('chat_lang', lang);
                const t = textos[lang];
                document.getElementById('btnEnviar').innerText = t.send;
                document.getElementById('input').placeholder = t.placeholder;
                document.getElementById('modalConfirmBtn').innerText = t.saveBtn;
                document.getElementById('btnCancelGlobal').innerText = t.cancel;
            }

            window.onload = () => {
                aplicarIdioma(idiomaActual);
                if(${historial.length === 0}) pedirIdioma();
                chat.scrollTop = chat.scrollHeight;
            };

            function pedirIdioma() {
                document.getElementById('overlay').style.display = 'block';
                document.getElementById('btnCancelGlobal').style.display = 'none'; // No se puede cancelar el idioma inicial
                const modal = document.getElementById('modal');
                modal.style.display = 'block';
                document.getElementById('modalTitle').innerText = "Selecciona Idioma";
                const content = document.getElementById('modalContent');
                content.innerHTML = \`
                    <button class="lang-btn" onclick="setLanguage('Español')">🇪🇸 Español</button>
                    <button class="lang-btn" onclick="setLanguage('Inglés')">🇺🇸 English</button>
                    <button class="lang-btn" onclick="setLanguage('Francés')">🇫🇷 Français</button>
                \`;
            }

            function setLanguage(lang) {
                aplicarIdioma(lang);
                const promptMsg = "A partir de ahora, respóndeme siempre en idioma " + lang + ".";
                fetch('/', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ mensaje: promptMsg, isSystem: true })
                }).then(() => closeModal());
            }

            function closeModal() {
                document.getElementById('overlay').style.display = 'none';
                document.getElementById('modal').style.display = 'none';
                document.getElementById('modalContent').innerHTML = '';
                document.getElementById('modalInputContainer').style.display = 'none';
                document.getElementById('btnCancelGlobal').style.display = 'block'; 
            }

            function enviar() {
                const input = document.getElementById('input');
                const t = textos[idiomaActual];
                const mensaje = input.value;
                if(!mensaje) return;
                input.value = t.pensar;
                input.disabled = true;
                fetch('/', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({mensaje})
                }).then(() => location.reload());
            }

            function abrirGuardar() {
                const t = textos[idiomaActual];
                document.getElementById('overlay').style.display = 'block';
                document.getElementById('modal').style.display = 'block';
                document.getElementById('modalTitle').innerText = t.saveTitle;
                document.getElementById('modalContent').innerHTML = "";
                document.getElementById('modalInputContainer').style.display = 'block';
                document.getElementById('btnCancelGlobal').style.display = 'block';
                setTimeout(() => document.getElementById('modalInput').focus(), 50);
            }

            function ver() {
                const t = textos[idiomaActual];
                fetch('/conversations').then(r => r.json()).then(list => {
                    document.getElementById('overlay').style.display = 'block';
                    document.getElementById('modal').style.display = 'block';
                    document.getElementById('modalTitle').innerText = t.loadTitle;
                    document.getElementById('btnCancelGlobal').style.display = 'block';
                    const container = document.getElementById('modalContent');
                    container.innerHTML = "";
                    if(!list.length) { container.innerHTML = "<p style='color:#666;'>"+t.noFiles+"</p>"; return; }
                    list.forEach(file => {
                        const div = document.createElement('div');
                        div.className = 'item-chat';
                        div.innerHTML = \`
                            <span style="cursor:pointer;flex:1;text-align:left;" onclick="cargarArchivo('\${file}')">\${file}</span>
                            <button style="background:transparent;color:#666;" onclick="borrarArchivo('\${file}')">🗑</button>
                        \`;
                        container.appendChild(div);
                    });
                });
            }

            // ... funciones de carga, borrado y confirmación iguales ...
            function confirmSave() {
                const nombre = document.getElementById('modalInput').value;
                if(!nombre) return;
                fetch('/save', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({nombre})
                }).then(r => { if(r.ok) { closeModal(); location.reload(); } });
            }
            function cargarArchivo(nombre) {
                fetch('/load', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({nombre})
                }).then(() => location.reload());
            }
            function borrarArchivo(nombre) {
                const t = textos[idiomaActual];
                if(confirm(t.delConfirm + " " + nombre)) {
                    fetch('/delete-file', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({nombre})
                    }).then(() => ver());
                }
            }
            function borrar() {
                const t = textos[idiomaActual];
                if(confirm(t.clearConfirm)) {
                    fetch('/clear', {method:'POST'}).then(() => location.reload());
                }
            }
        </script>
    </body>
    </html>
    `);
});

app.listen(PORT, () => console.log("Use the toggle button to open the chat panel."));