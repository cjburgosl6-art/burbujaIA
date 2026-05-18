const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json()); 

const PORT = 3000;
const MEMORY_FILE = path.join(__dirname, "memory.json");
const SAVES_DIR = path.join(__dirname, "conversations");
const AUTO_DIR = path.join(__dirname, "autosaves");

[SAVES_DIR, AUTO_DIR].forEach(dir => { if (!fs.existsSync(dir)) fs.mkdirSync(dir); });

let historial = fs.existsSync(MEMORY_FILE) ? JSON.parse(fs.readFileSync(MEMORY_FILE, "utf-8")) : [];

/* --- API --- */
app.post("/", async (req, res) => {
    const { mensaje, isSystem } = req.body;
    if (isSystem) {
        historial.push("Sistema: " + mensaje);
    } else {
        historial.push("Usuario: " + mensaje);
        try {
            const r = await axios.post("http://localhost:11434/api/generate", {
                model: "llama3",
                prompt: historial.join("\n") + "\nAsistente:",
                stream: false
            });
            historial.push("Asistente: " + r.data.response.trim());
            const fecha = new Date().toISOString().slice(0, 10);
            fs.writeFileSync(path.join(AUTO_DIR, `auto_${fecha}.md`), historial.join("\n\n"));
        } catch (e) { historial.push("Asistente: Error al conectar con Ollama."); }
    }
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(historial, null, 2));
    res.json({ ok: true });
});

app.get("/files", (req, res) => {
    const manual = fs.readdirSync(SAVES_DIR).filter(f => f.endsWith('.md')).map(f => ({ name: f, type: 'manual' }));
    const auto = fs.readdirSync(AUTO_DIR).filter(f => f.endsWith('.md')).map(f => ({ name: f, type: 'auto' }));
    res.json([...manual, ...auto]);
});

app.post("/save-manual", (req, res) => {
    const { nombre } = req.body;
    const safeName = nombre.replace(/[^a-z0-9]/gi, '_') + ".md";
    fs.writeFileSync(path.join(SAVES_DIR, safeName), historial.join("\n\n"));
    res.sendStatus(200);
});

app.post("/load", (req, res) => {
    const { name, type } = req.body;
    const dir = type === 'auto' ? AUTO_DIR : SAVES_DIR;
    const contenido = fs.readFileSync(path.join(dir, name), "utf-8");
    historial = contenido.split("\n\n").filter(l => l.trim() !== "");
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(historial, null, 2));
    res.sendStatus(200);
});

app.post("/delete", (req, res) => {
    const { name, type } = req.body;
    const dir = type === 'auto' ? AUTO_DIR : SAVES_DIR;
    fs.unlinkSync(path.join(dir, name));
    res.sendStatus(200);
});

app.post("/clear", (req, res) => {
    historial = [];
    if (fs.existsSync(MEMORY_FILE)) fs.unlinkSync(MEMORY_FILE);
    res.sendStatus(200);
});

/* --- HTML --- */
app.get("/", (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
        <style>
            :root { 
                --primary: #c1121f; --bg: #0f0f0f; --panel: #1a1a1a; --text: #eee; 
                --input-bg: #000; --msg-user: #222; --topbar: #111; --border: #333;
            }

            body.light-mode {
                --primary: #0077b6 !important; --bg: #f0f9ff !important; --panel: #ffffff !important; --text: #023e8a !important; 
                --input-bg: #fff !important; --msg-user: #e0f2fe !important; --topbar: #caf0f8 !important; --border: #ade8f4 !important;
            }

            body { background: var(--bg); color: var(--text); font-family: 'Segoe UI', sans-serif; margin: 0; display: flex; height: 100vh; overflow: hidden; transition: 0.3s; }
            
            #sidebar { width: 300px; background: var(--panel); border-right: 1px solid var(--border); display: flex; flex-direction: column; transition: 0.3s; position: absolute; left: -300px; height: 100%; z-index: 1000; }
            #sidebar.open { left: 0; }
            .sidebar-header { padding: 20px; border-bottom: 1px solid var(--border); font-weight: bold; display: flex; justify-content: space-between; }
            
            .file-list { flex: 1; overflow-y: auto; padding: 10px; }
            .file-item { display: flex; align-items: center; padding: 10px; border-radius: 5px; margin-bottom: 5px; font-size: 14px; border: 1px solid transparent; }
            .file-item:hover { background: rgba(0,0,0,0.1); }
            
            #main { flex: 1; display: flex; flex-direction: column; width: 100%; position: relative; }
            #chat { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 15px; }
            
            .msg { padding: 15px; border-radius: 8px; background: var(--panel); border-left: 4px solid var(--primary); max-width: 85%; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
            .user { border-left: none; border-right: 4px solid #555; background: var(--msg-user); margin-left: auto; }
            
            .thinking { font-style: italic; opacity: 0.7; animation: blink 1s infinite; }
            @keyframes blink { 50% { opacity: 0.3; } }

            .top-bar { padding: 10px 20px; background: var(--topbar); display: flex; align-items: center; gap: 15px; border-bottom: 1px solid var(--border); min-height: 50px; }
            .controls { display: flex; gap: 10px; padding: 20px; background: var(--topbar); border-top: 1px solid var(--border); }
            
            input { flex: 1; background: var(--input-bg); color: var(--text); border: 1px solid var(--border); padding: 12px; border-radius: 8px; }
            button { background: var(--primary); color: white; border: none; padding: 10px 20px; cursor: pointer; border-radius: 8px; font-weight: bold; transition: 0.2s; }
            button:disabled { opacity: 0.5; cursor: not-allowed; }

            #overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 2000; }
            .modal { display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: var(--panel); padding: 30px; border-radius: 12px; z-index: 2001; width: 320px; text-align: center; border: 1px solid var(--border); color: var(--text); }
        </style>
    </head>
    <body>
        <div id="overlay" onclick="closeAll()"></div>

        <div id="sidebar">
            <div class="sidebar-header">
                <span id="txtHistorialTitle">HISTORIAL</span>
                <span style="cursor:pointer" onclick="toggleMenu()">✕</span>
            </div>
            <div id="fileList" class="file-list"></div>
        </div>

        <div id="main">
            <div class="top-bar">
                <div style="cursor:pointer; font-size:24px;" onclick="toggleMenu()">☰</div>
                <div style="flex:1; font-weight:bold; color:var(--primary)">Llama3 AI</div>
                <button onclick="toggleTheme()" id="themeBtn">☀️</button>
                <button onclick="abrirGuardarManual()">💾</button>
                <button onclick="borrarActual()" style="background:#333">🗑</button>
            </div>
            <div id="chat"></div>
            <div class="controls">
                <input id="input" onkeypress="if(event.key==='Enter') enviar()">
                <button id="btnEnviar" onclick="enviar()"></button>
            </div>
        </div>

        <div id="modalIdioma" class="modal">
            <h2 style="color:var(--primary)">Language / Idioma</h2>
            <button style="width:100%; margin: 5px 0;" onclick="setLang('Español')">🇪🇸 Español</button>
            <button style="width:100%; margin: 5px 0;" onclick="setLang('Inglés')">🇺🇸 English</button>
            <button style="width:100%; margin: 5px 0;" onclick="setLang('Francés')">🇫🇷 Français</button>
        </div>

        <div id="modalGuardar" class="modal">
            <h3 id="txtSaveTitle">Guardar</h3>
            <input id="nombreArchivo" style="width:100%; margin-bottom:15px; box-sizing:border-box;">
            <button id="btnConfirmSave" onclick="confirmarGuardadoManual()" style="width:100%"></button>
            <button id="btnCancelSave" onclick="closeAll()" style="width:100%; margin-top:10px; background:#444; color:white;"></button>
        </div>

        <script>
            let rawHistorial = ${JSON.stringify(historial)};
            const textos = {
                'Español': { send: 'Enviar', placeholder: 'Escribe algo...', pensando: 'Pensando...', historial: 'HISTORIAL', saveTitle: 'Guardar conversación', savePlaceholder: 'Nombre del archivo', confirmSave: 'Guardar ahora', cancel: 'Cancelar', deleteConfirm: '¿Borrar archivo?' },
                'Inglés': { send: 'Send', placeholder: 'Type something...', pensando: 'Thinking...', historial: 'HISTORY', saveTitle: 'Save conversation', savePlaceholder: 'File name', confirmSave: 'Save now', cancel: 'Cancel', deleteConfirm: 'Delete file?' },
                'Francés': { send: 'Envoyer', placeholder: 'Écrivez...', pensando: 'Pensée...', historial: 'HISTORIQUE', saveTitle: 'Enregistrer le chat', savePlaceholder: 'Nom du fichier', confirmSave: 'Enregistrer', cancel: 'Annuler', deleteConfirm: 'Supprimer?' }
            };

            function toggleTheme() {
                const body = document.body;
                body.classList.toggle('light-mode');
                const isLight = body.classList.contains('light-mode');
                localStorage.setItem('theme', isLight ? 'light' : 'dark');
                document.getElementById('themeBtn').innerText = isLight ? '🌙' : '☀️';
            }

            function aplicarTraducciones() {
                const lang = localStorage.getItem('idioma') || 'Español';
                const t = textos[lang];
                document.getElementById('btnEnviar').innerText = t.send;
                document.getElementById('input').placeholder = t.placeholder;
                document.getElementById('txtHistorialTitle').innerText = t.historial;
                document.getElementById('txtSaveTitle').innerText = t.saveTitle;
                document.getElementById('nombreArchivo').placeholder = t.savePlaceholder;
                document.getElementById('btnConfirmSave').innerText = t.confirmSave;
                document.getElementById('btnCancelSave').innerText = t.cancel;
            }

            function renderChat() {
                const chatDiv = document.getElementById('chat');
                chatDiv.innerHTML = rawHistorial
                    .filter(m => !m.startsWith('Sistema:'))
                    .map(m => {
                        const isUser = m.startsWith('Usuario:');
                        const content = m.split(': ').slice(1).join(': ');
                        return \`<div class="msg \${isUser ? 'user' : ''}">\${marked.parse(content)}</div>\`;
                    }).join('');
                chatDiv.scrollTop = chatDiv.scrollHeight;
            }

            async function enviar() {
                const input = document.getElementById('input');
                const chatDiv = document.getElementById('chat');
                const lang = localStorage.getItem('idioma') || 'Español';
                
                if(!input.value || input.disabled) return;
                const msg = input.value;
                
                // 1. Mostrar usuario inmediatamente
                rawHistorial.push("Usuario: " + msg);
                renderChat();
                
                // 2. Estado pensando
                input.value = "";
                input.disabled = true;
                const tempMsg = document.createElement('div');
                tempMsg.className = 'msg thinking';
                tempMsg.innerText = textos[lang].pensando;
                chatDiv.appendChild(tempMsg);
                chatDiv.scrollTop = chatDiv.scrollHeight;

                await fetch('/', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ mensaje: msg }) });
                location.reload();
            }

            function setLang(lang) {
                localStorage.setItem('idioma', lang);
                fetch('/', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ mensaje: "Responde siempre en " + lang, isSystem: true }) })
                .then(() => location.reload());
            }

            function toggleMenu() { document.getElementById('sidebar').classList.toggle('open'); if(document.getElementById('sidebar').classList.contains('open')) cargarArchivos(); }
            function abrirGuardarManual() { document.getElementById('overlay').style.display = 'block'; document.getElementById('modalGuardar').style.display = 'block'; }
            function closeAll() { document.getElementById('overlay').style.display = 'none'; document.querySelectorAll('.modal').forEach(m => m.style.display = 'none'); }
            function borrarActual() { if(confirm("Clear chat?")) fetch('/clear', {method:'POST'}).then(() => { localStorage.removeItem('idioma'); location.reload(); }); }

            async function cargarArchivos() {
                const res = await fetch('/files');
                const files = await res.json();
                const list = document.getElementById('fileList');
                list.innerHTML = files.reverse().map(f => \`
                    <div class="file-item">
                        <span class="tag \${f.type === 'manual' ? 'tag-manual' : ''}">\${f.type}</span>
                        <span style="flex:1; cursor:pointer" onclick="cargarFile('\${f.name}', '\${f.type}')">\${f.name}</span>
                        <span style="cursor:pointer" onclick="borrarFile('\${f.name}', '\${f.type}')">🗑</span>
                    </div>\`).join('');
            }

            async function cargarFile(n, t) { await fetch('/load', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name:n, type:t}) }); location.reload(); }
            async function borrarFile(n, t) { if(confirm("Delete?")) { await fetch('/delete', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name:n, type:t}) }); cargarArchivos(); } }
            async function confirmarGuardadoManual() {
                const n = document.getElementById('nombreArchivo').value;
                if(!n) return;
                await fetch('/save-manual', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({nombre:n}) });
                closeAll();
            }

            window.onload = () => {
                if(localStorage.getItem('theme') === 'light') document.body.classList.add('light-mode');
                document.getElementById('themeBtn').innerText = document.body.classList.contains('light-mode') ? '🌙' : '☀️';
                aplicarTraducciones();
                renderChat();
                if(rawHistorial.length === 0 || !localStorage.getItem('idioma')) {
                    document.getElementById('overlay').style.display = 'block';
                    document.getElementById('modalIdioma').style.display = 'block';
                }
            };
        </script>
    </body>
    </html>
    `);
});

app.listen(PORT, () => console.log("Use the toggle button to open the chat panel."));

// Fin del código.