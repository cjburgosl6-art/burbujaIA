const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { encode } = require("gpt-3-encoder");

const app = express();
app.use(express.json()); 

const PORT = 3000;
const MEMORY_FILE = path.join(__dirname, "memory.json");
const SAVES_DIR = path.join(__dirname, "conversations");
const AUTO_DIR = path.join(__dirname, "autosaves");

[SAVES_DIR, AUTO_DIR].forEach(dir => { if (!fs.existsSync(dir)) fs.mkdirSync(dir); });

let historial = fs.existsSync(MEMORY_FILE) ? JSON.parse(fs.readFileSync(MEMORY_FILE, "utf-8")) : [];

// SANEADO: Unificamos y aclaramos el comportamiento del prompt del sistema para evitar confusiones en Llama3
let systemPrompt = "Eres un asistente de IA útil, natural y conciso. Responde siempre en Español. IMPORTANTE: Habla de forma totalmente natural, directa y fluida. SOLO si el usuario te pide explícitamente un código fuente, script o comando, utiliza los bloques de código estándar de Markdown (```). No uses comillas inversas ni formatos extraños en conversaciones normales.";

function calcularTokensTotalesHistorial() {
    if (historial.length === 0) return 0;
    const textoCompleto = historial.join("\n");
    return encode(textoCompleto).length;
}

/* --- API --- */
app.post("/", async (req, res) => {
    const { mensaje, isSystem, newSystemPrompt, accion } = req.body;
    
    if (newSystemPrompt) {
        systemPrompt = newSystemPrompt;
    }

    if (isSystem) {
        const idiomaExtraido = mensaje.replace("Responde siempre en ", "");
        systemPrompt = `Eres un asistente de IA útil, natural y conciso. Responde siempre en ${idiomaExtraido}. IMPORTANTE: Habla de forma totalmente natural, directa y fluida. SOLO si el usuario te pide explícitamente un código fuente, script o comando, utiliza los bloques de código estándar de Markdown (\`\`\`). No uses comillas inversas ni formatos extraños en conversaciones normales.`;
        return res.json({ ok: true });
    }

    let mensajeFinal = mensaje;
    if (accion === 'resumir') mensajeFinal = "Haz un resumen muy breve de nuestra conversación hasta ahora.";
    if (accion === 'corregir') mensajeFinal = "Analiza mi último mensaje o código, corrige errores y dime cómo mejorarlo.";

    historial.push("Usuario: " + mensajeFinal);
    
    const ahora = new Date();
    const fechaTxt = ahora.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const horaTxt = ahora.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const instruccionesConFecha = `${systemPrompt}\n[Información del sistema: Hoy es ${fechaTxt} y la hora actual es ${horaTxt}. Usa estos datos únicamente si el usuario te pregunta explícitamente por el tiempo o la fecha actual]`;

    const textoCompletoHistorial = instruccionesConFecha + "\n\n" + historial.join("\n") + "\nAsistente:";
    const tokensTotalesAntes = encode(textoCompletoHistorial).length;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('X-Tokens-Total-Antes', tokensTotalesAntes);

    try {
        const response = await axios({
            method: 'post',
            url: "http://localhost:11434/api/generate",
            data: {
                model: "llama3",
                prompt: textoCompletoHistorial,
                stream: true
            },
            responseType: 'stream'
        });

        let respuestaCompleta = "";
        
        req.on('close', () => {
            if (response.data && typeof response.data.destroy === 'function') {
                response.data.destroy(); 
            }
        });

        response.data.on('data', (chunk) => {
            const lines = chunk.toString().split('\n');
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const json = JSON.parse(line);
                    if (json.response) {
                        // FILTRO ROBUSTO: Limpia residuos extraños que Llama3 genere por obsesión al formato
                        let fragmentoLimpio = json.response
                            .replace(/\{\d+\}/g, '')
                            .replace(/\{\s*'\s*\}\}/g, '')
                            .replace(/\{\s*"\s*\}\}/g, '');
                        
                        respuestaCompleta += fragmentoLimpio;
                        res.write(fragmentoLimpio); 
                    }
                } catch (err) { /* Ignorar fragmentos */ }
            }
        });

        response.data.on('end', () => {
            historial.push("Asistente: " + respuestaCompleta.trim());
            fs.writeFileSync(MEMORY_FILE, JSON.stringify(historial, null, 2));
            
            const año = ahora.getFullYear();
            const mes = String(ahora.getMonth() + 1).padStart(2, '0');
            const dia = String(ahora.getDate()).padStart(2, '0');
            const horas = String(ahora.getHours()).padStart(2, '0');
            const minutos = String(ahora.getMinutes()).padStart(2, '0');
            const segundos = String(ahora.getSeconds()).padStart(2, '0');
            
            const nombreArchivoCronologico = `auto_${año}-${mes}-${dia}_${horas}-${minutos}-${segundos}.md`;
            fs.writeFileSync(path.join(AUTO_DIR, nombreArchivoCronologico), historial.join("\n\n"));

            // LIMITADOR ROTATIVO DE AUTOSAVES
            const archivosAuto = fs.readdirSync(AUTO_DIR)
                .filter(f => f.endsWith('.md'))
                .map(f => ({
                    nombre: f,
                    ruta: path.join(AUTO_DIR, f),
                    mtime: fs.statSync(path.join(AUTO_DIR, f)).mtime
                }));

            archivosAuto.sort((a, b) => a.mtime - b.mtime);

            const LIMITE_AUTOSAVES = 30;
            if (archivosAuto.length > LIMITE_AUTOSAVES) {
                const cuantosBorrar = archivosAuto.length - LIMITE_AUTOSAVES;
                for (let i = 0; i < cuantosBorrar; i++) {
                    fs.unlinkSync(archivosAuto[i].ruta);
                }
            }

            res.end();
        });

    } catch (e) {
        res.status(500).write("Error al conectar con Ollama.");
        res.end();
    }
});

app.get("/current-tokens", (req, res) => { res.json({ totalAcumulado: calcularTokensTotalesHistorial() }); });
app.get("/get-historial", (req, res) => { res.json(historial); });

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

/* --- FRONTEND INTEGRADO --- */
app.get("/", (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
        <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
        <style>
            :root { 
                --primary: #c1121f; --bg: #0f0f0f; --panel: #1a1a1a; --text: #eee; 
                --input-bg: #000; --msg-user: #222; --topbar: #111; --border: #333;
                --btn-copy-bg: #2a2a2a; --btn-copy-color: #aaa;
            }
            body.light-mode {
                --primary: #0077b6 !important; --bg: #f0f9ff !important; --panel: #ffffff !important; --text: #023e8a !important; 
                --input-bg: #fff !important; --msg-user: #e0f2fe !important; --topbar: #caf0f8 !important; --border: #ade8f4 !important;
                --btn-copy-bg: #e2e8f0 !important; --btn-copy-color: #475569 !important;
            }
            body { background: var(--bg); color: var(--text); font-family: 'Segoe UI', sans-serif; margin: 0; display: flex; height: 100vh; overflow: hidden; transition: 0.3s; }
            #sidebar { width: 300px; background: var(--panel); border-right: 1px solid var(--border); display: flex; flex-direction: column; transition: 0.3s; position: absolute; left: -300px; height: 100%; z-index: 1000; }
            #sidebar.open { left: 0; }
            .sidebar-header { padding: 20px 20px 10px 20px; font-weight: bold; display: flex; justify-content: space-between; align-items: center; }
            
            .tabs-container { display: flex; padding: 0 15px 10px 15px; border-bottom: 1px solid var(--border); gap: 5px; }
            .tab-btn { flex: 1; padding: 8px 5px; font-size: 11px; font-weight: bold; text-transform: uppercase; border: 1px solid var(--border); background: rgba(0,0,0,0.2); color: var(--text); border-radius: 6px; cursor: pointer; transition: 0.2s; opacity: 0.6; }
            .tab-btn:hover { opacity: 1; background: rgba(255,255,255,0.03); }
            .tab-btn.active { opacity: 1; background: var(--primary); color: white; border-color: var(--primary); }

            .file-list { flex: 1; overflow-y: auto; padding: 10px; }
            .file-item { display: flex; align-items: center; padding: 10px; border-radius: 5px; margin-bottom: 5px; font-size: 13px; border: 1px solid transparent; background: rgba(0,0,0,0.1); }
            .file-item:hover { background: rgba(255,255,255,0.05); }
            .tag { font-size: 9px; padding: 2px 5px; border-radius: 3px; background: #444; margin-right: 10px; color: white; text-transform: uppercase; font-weight: bold; }
            .tag-manual { background: var(--primary) !important; }
            #main { flex: 1; display: flex; flex-direction: column; width: 100%; position: relative; }
            #chat { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 15px; }
            .msg { padding: 15px 15px 12px 15px; border-radius: 8px; background: var(--panel); border-left: 4px solid var(--primary); max-width: 85%; box-shadow: 0 2px 5px rgba(0,0,0,0.1); word-wrap: break-word; position: relative; }
            .user { border-left: none; border-right: 4px solid #555; background: var(--msg-user); margin-left: auto; }
            .code-block-wrapper { position: relative; margin: 14px 0; border-radius: 6px; overflow: hidden; border: 1px solid var(--border); }
            .code-block-header { display: flex; justify-content: space-between; align-items: center; background: #111; padding: 5px 12px; font-size: 11px; font-family: monospace; color: #888; border-bottom: 1px solid var(--border); user-select: none; }
            .btn-copiar-codigo { background: none; border: none; color: #888; cursor: pointer; font-size: 11px; font-weight: bold; padding: 2px 6px; border-radius: 4px; transition: 0.2s; }
            .btn-copiar-codigo:hover { color: #fff; background: rgba(255,255,255,0.1); }
            pre { background: #151515 !important; padding: 12px; margin: 0 !important; overflow-x: auto; }
            code { font-family: 'Consolas', 'Courier New', monospace; font-size: 13px; }
            .btn-copiar { display: inline-flex; align-items: center; justify-content: center; margin-top: 12px; background: var(--btn-copy-bg); color: var(--btn-copy-color); border: 1px solid var(--border); padding: 5px 10px; font-size: 11px; border-radius: 6px; cursor: pointer; transition: 0.2s; font-weight: bold; letter-spacing: 0.5px; text-transform: uppercase; }
            .btn-copiar:hover { background: var(--primary) !important; color: #fff !important; border-color: var(--primary); }
            .top-bar { padding: 10px 15px; background: var(--topbar); display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--border); min-height: 50px; }
            .quick-actions { display: flex; gap: 8px; padding: 10px 20px 0 20px; }
            .action-btn { font-size: 11px; padding: 6px 12px; background: var(--panel); border: 1px solid var(--border); color: var(--text); border-radius: 15px; cursor: pointer; opacity: 0.8; transition: 0.2s; }
            .action-btn:hover { background: var(--primary); color: white; border-color: var(--primary); opacity: 1; }
            .action-btn:disabled { opacity: 0.3; cursor: not-allowed; }
            .controls { display: flex; gap: 10px; padding: 20px; background: var(--topbar); border-top: 1px solid var(--border); }
            input { flex: 1; background: var(--input-bg); color: var(--text); border: 1px solid var(--border); padding: 12px; border-radius: 8px; }
            button { background: var(--primary); color: white; border: none; padding: 10px 20px; cursor: pointer; border-radius: 8px; font-weight: bold; transition: 0.2s; }
            button.btn-stop { background: #333 !important; }
            button.btn-stop:hover { background: #555 !important; }
            #overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 2000; }
            .modal { display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: var(--panel); padding: 30px; border-radius: 12px; z-index: 2001; width: 320px; text-align: center; border: 1px solid var(--border); color: var(--text); }
            .token-box { display: flex; align-items: center; gap: 6px; background: rgba(0,0,0,0.2); padding: 4px 8px; border-radius: 12px; border: 1px solid var(--border); font-size: 11px; font-variant-numeric: tabular-nums; }
            .info-btn { background: none; border: none; color: var(--text); opacity: 0.5; cursor: pointer; padding: 0 2px; font-size: 12px; transition: 0.2s; display: inline-flex; align-items: center; }
            .info-btn:hover { opacity: 1; color: var(--primary); }
            .typing-container { display: flex; align-items: center; gap: 5px; font-style: italic; opacity: 0.8; font-weight: 500; animation: blink-effect 1.4s infinite alternate ease-in-out; }
            .typing-dots::after { content: ''; display: inline-block; width: 15px; text-align: left; animation: dots-cycle 2s infinite steps(1); }
            @keyframes blink-effect { 0% { opacity: 0.5; } 100% { opacity: 1; } }
            @keyframes dots-cycle { 0% { content: ''; } 16% { content: '.'; } 33% { content: '..'; } 50% { content: '...'; } 66% { content: '..'; } 83% { content: '.'; } 100% { content: ''; } }
        </style>
    </head>
    <body>
        <div id="overlay" onclick="closeAll()"></div>
        <div id="sidebar">
            <div class="sidebar-header">
                <span id="txtHistorialTitle">HISTORIAL</span>
                <span style="cursor:pointer" onclick="toggleMenu()">✕</span>
            </div>
            
            <div class="tabs-container">
                <button id="tabManual" class="tab-btn active" onclick="cambiarPestañaArchivos('manual')">Manuales</button>
                <button id="tabAuto" class="tab-btn" onclick="cambiarPestañaArchivos('auto')">Autosaves</button>
            </div>

            <div id="fileList" class="file-list"></div>
        </div>
        <div id="main">
            <div class="top-bar">
                <div style="cursor:pointer; font-size:20px; padding: 0 4px;" onclick="toggleMenu()">☰</div>
                <div style="flex:1; font-weight:bold; color:var(--primary); font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Llama3 AI</div>
                <div class="token-box">
                    <span id="tokenCounter">🔥 0 | 🧠 8192</span>
                    <button class="info-btn" onclick="abrirInfoTokens()">ⓘ</button>
                </div>
                <button onclick="toggleTheme()" id="themeBtn">🌙</button>
                <button onclick="abrirGuardarManual()">💾</button>
                <button onclick="borrarActual()" style="background:#333">🗑</button>
            </div>
            <div id="chat"></div>
            <div class="quick-actions">
                <button id="btnActionResumir" class="action-btn" onclick="enviarAccion('resumir')">📝 Resumir</button>
                <button id="btnActionCorregir" class="action-btn" onclick="enviarAccion('corregir')">🛠 Corregir</button>
            </div>
            <div class="controls">
                <input id="input" onkeypress="if(event.key==='Enter' && !isGenerating) enviar()">
                <button id="btnEnviar" onclick="manejadorBotonPrincipal()"></button>
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
        <div id="modalInfo" class="modal">
            <h3 id="txtInfoTitle" style="color:var(--primary); margin-top: 0;"></h3>
            <div id="txtInfoBody" style="font-size: 13px; text-align: left; line-height: 1.5; margin-bottom: 20px;"></div>
            <button onclick="closeAll()" style="width:100%">Ok</button>
        </div>
        <script>
            let rawHistorial = [];
            let isGenerating = false; 
            let abortController = null; 
            let pestañaActiva = 'manual';
            
            const renderer = new marked.Renderer();
            
            renderer.code = function(tokenOrCode, lang) {
                let code = (tokenOrCode && typeof tokenOrCode === 'object') ? tokenOrCode.text : tokenOrCode;
                let lenguaje = (tokenOrCode && typeof tokenOrCode === 'object') ? (tokenOrCode.lang || lang) : lang;
                if (!code) code = "";
                
                if (!lenguaje || lenguaje === 'plaintext') lenguaje = 'javascript';
                
                let validLang = hljs.getLanguage(lenguaje) ? lenguaje : 'javascript';
                let highlighted = "";
                try { highlighted = hljs.highlight(code, { language: validLang }).value; } catch(e) { highlighted = code; }
                let escapedCode = "";
                try { escapedCode = btoa(unescape(encodeURIComponent(code))); } catch(e) { escapedCode = ""; }
                
                return '<div class="code-block-wrapper"><div class="code-block-header"><span>' + validLang.toUpperCase() + '</span><button class="btn-copiar-codigo" onclick="copiarBloqueCodigo(this, \\'' + escapedCode + '\\')">Copiar Código</button></div><pre><code class="hljs lang-' + validLang + '">' + highlighted + '</code></pre></div>';
            };
            marked.use({ renderer });

            function copiarBloqueCodigo(btn, base64Code) {
                if(!base64Code) return;
                const textoOriginal = btn.innerText;
                try {
                    const code = decodeURIComponent(escape(atob(base64Code)));
                    navigator.clipboard.writeText(code).then(() => {
                        btn.innerText = "¡Copiado!";
                        setTimeout(() => { btn.innerText = textoOriginal; }, 2000);
                    });
                } catch(e) {}
            }

            const textos = {
                'Español': { 
                    send: 'Enviar', stop: '⏹ Detener', placeholder: 'Escribe algo...', pensando: 'Escribiendo', 
                    historial: 'HISTORIAL', saveTitle: 'Guardar conversación', savePlaceholder: 'Nombre del archivo', 
                    confirmSave: 'Guardar ahora', cancel: 'Cancelar', deleteConfirm: '¿Borrar archivo?', 
                    copy: 'Copiar Mensaje', copied: '¡Copiado!', infoTitle: 'Contador de Tokens', 
                    infoBody: '🔥 **Tokens Consumidos:** Es el total de tokens acumulados en la sesión actual. 🧠 **Límite de Contexto (8192):** Es la memoria máxima que el modelo Llama3 puede recordar. Al llegar al límite, las funciones de \"Resumir\" te ayudarán a compactar el chat para no perder el hilo.', 
                    btnResumir: '📝 Resumir', btnCorregir: '🛠 Corregir' 
                },
                'Inglés': { 
                    send: 'Send', stop: '⏹ Stop', placeholder: 'Type something...', pensando: 'Typing', 
                    historial: 'HISTORY', saveTitle: 'Save conversation', savePlaceholder: 'File name', 
                    confirmSave: 'Save now', cancel: 'Cancel', deleteConfirm: 'Delete file?', 
                    copy: 'Copy Message', copied: 'Copied!', infoTitle: 'Token Counter', 
                    infoBody: '🔥 **Tokens Used:** The total number of tokens accumulated in this current session. 🧠 **Context Limit (8192):** The maximum memory capacity Llama3 can handle. If you approach this limit, use the \"Summarize\" actions to compress your chat history.', 
                    btnResumir: '📝 Summarize', btnCorregir: '🛠 Fix Error' 
                },
                'Francés': { 
                    send: 'Envoyer', stop: '⏹ Arrêter', placeholder: 'Écrivez...', pensando: 'Écrit', 
                    historial: 'HISTORIQUE', saveTitle: 'Enregistrer le chat', savePlaceholder: 'Nom', 
                    confirmSave: 'Enregistrer', cancel: 'Annuler', deleteConfirm: 'Supprimer?', 
                    copy: 'Copier', copied: 'Copié!', infoTitle: 'Tokens', 
                    infoBody: '🔥 **Tokens Utilisés:** Le total des tokens accumulés dans la session. 🧠 **Limite de Contexte (8192):** La mémoire maximale que Llama3 peut retenir. Utilisez \"Résumer\" pour compacter l\\'historique si nécessaire.', 
                    btnResumir: '📝 Résumer', btnCorregir: '🛠 Couriger' 
                }
            };

            function toggleTheme() {
                const body = document.body;
                const btn = document.getElementById('themeBtn');
                body.classList.toggle('light-mode');
                const isLight = body.classList.contains('light-mode');
                localStorage.setItem('theme', isLight ? 'light' : 'dark');
                btn.innerText = isLight ? '☀️' : '🌙';
            }

            function aplicarTraducciones() {
                const lang = sessionStorage.getItem('idioma') || 'Español';
                const t = textos[lang];
                document.getElementById('btnEnviar').innerText = isGenerating ? t.stop : t.send;
                document.getElementById('input').placeholder = t.placeholder;
                document.getElementById('txtHistorialTitle').innerText = t.historial;
                document.getElementById('txtSaveTitle').innerText = t.saveTitle;
                document.getElementById('nombreArchivo').placeholder = t.savePlaceholder;
                document.getElementById('btnConfirmSave').innerText = t.confirmSave;
                document.getElementById('btnCancelSave').innerText = t.cancel;
                document.getElementById('txtInfoTitle').innerText = t.infoTitle;
                document.getElementById('btnActionResumir').innerText = t.btnResumir;
                document.getElementById('btnActionCorregir').innerText = t.btnCorregir;
            }

            function manejadorBotonPrincipal() { if(isGenerating) { cancelarRespuesta(); } else { enviar(); } }
            function cancelarRespuesta() { if(abortController) abortController.abort(); }

            function cambiarEstadoControles(generando) {
                isGenerating = generando;
                const input = document.getElementById('input');
                const btn = document.getElementById('btnEnviar');
                const lang = sessionStorage.getItem('idioma') || 'Español';
                document.getElementById('btnActionResumir').disabled = generando;
                document.getElementById('btnActionCorregir').disabled = generando;
                if(generando) { input.disabled = true; btn.innerText = textos[lang].stop; btn.classList.add('btn-stop'); } 
                else { input.disabled = false; btn.innerText = textos[lang].send; btn.classList.remove('btn-stop'); input.focus(); }
            }

            function abrirInfoTokens() { 
                const lang = sessionStorage.getItem('idioma') || 'Español';
                let textoProcesado = marked.parse(textos[lang].infoBody);
                textoProcesado = textoProcesado.replace('🧠', '<br>🧠');
                
                document.getElementById('txtInfoBody').innerHTML = textoProcesado;
                document.getElementById('overlay').style.display = 'block'; 
                document.getElementById('modalInfo').style.display = 'block'; 
            }

            function copiarTextoElemento(btn, textoRaw) {
                const lang = sessionStorage.getItem('idioma') || 'Español';
                navigator.clipboard.writeText(textoRaw).then(() => {
                    btn.innerText = textos[lang].copied;
                    setTimeout(() => { btn.innerText = textos[lang].copy; }, 2000);
                });
            }

            function renderChat() {
                const chatDiv = document.getElementById('chat');
                const lang = sessionStorage.getItem('idioma') || 'Español';
                chatDiv.innerHTML = "";
                rawHistorial.filter(m => !m.startsWith('Sistema:')).map(m => {
                    const isUser = m.startsWith('Usuario:');
                    let content = m.split(': ').slice(1).join(': ');
                    
                    if(!isUser) {
                        content = content.trim();
                        // CORRECCIÓN: Si el modelo devuelve residuos por fallos de contexto, los limpiamos antes de renderizar
                        content = content
                            .replace(/\{\d+\}/g, '')
                            .replace(/\{\s*'\s*\}\}/g, '')
                            .replace(/\{\s*"\s*\}\}/g, '');
                    }
                    
                    return content.trim() ? { isUser, content } : null;
                }).filter(i => i !== null).forEach(item => {
                    if (item.content === '{"ok":true}') return;
                    const msgBox = document.createElement('div');
                    msgBox.className = item.isUser ? 'msg user' : 'msg';
                    const contentDiv = document.createElement('div');
                    contentDiv.innerHTML = marked.parse(item.content);
                    msgBox.appendChild(contentDiv);
                    if(!item.isUser) {
                        const btnCopiar = document.createElement('button');
                        btnCopiar.className = 'btn-copiar';
                        btnCopiar.innerText = textos[lang].copy;
                        btnCopiar.onclick = () => copiarTextoElemento(btnCopiar, item.content);
                        msgBox.appendChild(btnCopiar);
                    }
                    chatDiv.appendChild(msgBox);
                });
                chatDiv.scrollTop = chatDiv.scrollHeight;
            }

            async function actualizarContadorTokensDesdeServidor() {
                try {
                    const res = await fetch('/current-tokens');
                    const data = await res.json();
                    document.getElementById('tokenCounter').innerText = "🔥 " + data.totalAcumulado + " | 🧠 8192";
                } catch(e) { document.getElementById('tokenCounter').innerText = '🔥 0 | 🧠 8192'; }
            }

            async function enviarAccion(tipo) { if(!isGenerating) enviar(null, tipo); }

            async function enviar(e, accion = null) {
                const input = document.getElementById('input');
                const chatDiv = document.getElementById('chat');
                const msg = input.value;
                const lang = sessionStorage.getItem('idioma') || 'Español';
                if(!accion && !msg) return;
                cambiarEstadoControles(true); 
                abortController = new AbortController(); 
                if(!accion) { rawHistorial.push("Usuario: " + msg); input.value = ""; } 
                else { rawHistorial.push("Usuario: " + (accion === 'resumir' ? '📝 Resumir...' : '🛠 Corregir...')); }
                renderChat();

                const msgDiv = document.createElement('div');
                msgDiv.className = 'msg';
                msgDiv.innerHTML = '<div class="typing-container"><span>' + textos[lang].pensando + '</span><span class="typing-dots"></span></div>';
                chatDiv.appendChild(msgDiv);
                chatDiv.scrollTop = chatDiv.scrollHeight;
                let primerChunk = true;

                try {
                    const response = await fetch('/', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        // CORRECCIÓN: Quitamos la orden agresiva del systemPrompt dinámico para que no fuerce comillas inversas en texto plano
                        body: JSON.stringify({ mensaje: msg, accion: accion, newSystemPrompt: "Responde en " + lang + ". Habla de forma natural y fluida." }),
                        signal: abortController.signal
                    });
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let assistantMsg = "";
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        let chunkTxt = decoder.decode(value, { stream: true });
                        
                        // Limpieza en tiempo real durante el streaming
                        chunkTxt = chunkTxt.replace(/\{\d+\}/g, '').replace(/\{\s*'\s*\}\}/g, '').replace(/\{\s*"\s*\}\}/g, '');
                        
                        assistantMsg += chunkTxt;
                        if(primerChunk) { msgDiv.innerHTML = ""; primerChunk = false; }
                        msgDiv.innerHTML = marked.parse(assistantMsg);
                        chatDiv.scrollTop = chatDiv.scrollHeight;
                    }
                    rawHistorial.push("Asistente: " + assistantMsg);
                    renderChat();
                    await actualizarContadorTokensDesdeServidor();
                } catch (err) {
                    if (err.name === 'AbortError') {
                        msgDiv.innerHTML += ' <i>(Cortado)</i>';
                    } else { msgDiv.innerText = "Error."; }
                }
                cambiarEstadoControles(false); abortController = null;
            }

            function cambiarPestañaArchivos(tipo) {
                pestañaActiva = tipo;
                document.getElementById('tabManual').classList.toggle('active', tipo === 'manual');
                document.getElementById('tabAuto').classList.toggle('active', tipo === 'auto');
                cargarArchivos();
            }

            async function cargarArchivos() {
                const res = await fetch('/files');
                const allFiles = await res.json();
                const list = document.getElementById('fileList');
                list.innerHTML = ""; 
                
                const archivosFiltrados = allFiles.filter(f => f.type === pestañaActiva);
                
                archivosFiltrados.reverse().forEach(archivo => {
                    const item = document.createElement('div');
                    item.className = 'file-item';
                    const tagClass = archivo.type === 'manual' ? 'tag tag-manual' : 'tag';
                    item.innerHTML = '<span class="' + tagClass + '">' + archivo.type + '</span><span class="file-link-name" style="flex:1; cursor:pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"></span><span class="btn-delete-file" style="cursor:pointer; padding-left:10px;">🗑</span>';
                    const linkSpan = item.querySelector('.file-link-name');
                    linkSpan.innerText = archivo.name;
                    linkSpan.onclick = () => !isGenerating && cargarFile(archivo.name, archivo.type);
                    item.querySelector('.btn-delete-file').onclick = () => !isGenerating && borrarFile(archivo.name, archivo.type);
                    list.appendChild(item);
                });
            }

            function setLang(lang) {
                sessionStorage.setItem('idioma', lang);
                fetch('/', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ mensaje: "Responde siempre en " + lang, isSystem: true }) }).then(() => location.reload());
            }
            function toggleMenu() { document.getElementById('sidebar').classList.toggle('open'); if(document.getElementById('sidebar').classList.contains('open')) cargarArchivos(); }
            function abrirGuardarManual() { if(!isGenerating) { document.getElementById('overlay').style.display = 'block'; document.getElementById('modalGuardar').style.display = 'block'; } }
            function closeAll() { document.getElementById('overlay').style.display = 'none'; document.querySelectorAll('.modal').forEach(m => m.style.display = 'none'); }
            function borrarActual() { if(!isGenerating && confirm("Clear?")) fetch('/clear', {method:'POST'}).then(() => location.reload()); }
            async function cargarFile(n, t) { await fetch('/load', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name:n, type:t}) }); location.reload(); }
            async function borrarFile(n, t) { if(confirm("Delete?")) { await fetch('/delete', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name:n, type:t}) }); cargarArchivos(); } }
            async function confirmarGuardadoManual() {
                const n = document.getElementById('nombreArchivo').value;
                if(!n) return;
                await fetch('/save-manual', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({nombre:n}) });
                closeAll();
            }

            window.onload = async () => {
                const savedTheme = localStorage.getItem('theme');
                if(savedTheme === 'light') document.body.classList.add('light-mode');
                try { const res = await fetch('/get-historial'); rawHistorial = await res.json(); } catch(e) { rawHistorial = []; }
                cambiarEstadoControles(false); actualizarContadorTokensDesdeServidor(); aplicarTraducciones(); renderChat();
                if(!sessionStorage.getItem('idioma')) { document.getElementById('overlay').style.display = 'block'; document.getElementById('modalIdioma').style.display = 'block'; }
            };
        </script>
    </body>
    </html>
    `);
});

app.listen(PORT, () => console.log("Use the toggle button to open the chat panel."));