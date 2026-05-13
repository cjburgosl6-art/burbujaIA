const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { fork } = require("child_process");
const http = require("http");

let bubbleWindow = null;
let panelWindow = null;
let backendProcess = null;

const STORE = path.join(app.getPath("userData"), "pos.json");

function startBackend() {
    if (!backendProcess) {
        backendProcess = fork(path.join(__dirname, "../index.js"));
    }
}

// Función para avisar al backend que limpie el chat
function limpiarChatBackend() {
    const req = http.request({
        hostname: 'localhost',
        port: 3000,
        path: '/clear',
        method: 'POST'
    });
    req.on('error', (e) => console.log("Backend offline o ya cerrado"));
    req.end();
}

function createBubble() {
    startBackend();
    let pos = { x: 100, y: 100 };
    if (fs.existsSync(STORE)) pos = JSON.parse(fs.readFileSync(STORE, "utf-8"));

    bubbleWindow = new BrowserWindow({
        width: 70, height: 70, x: pos.x, y: pos.y,
        frame: false, transparent: true, alwaysOnTop: true,
        resizable: false, skipTaskbar: true,
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    });

    bubbleWindow.loadFile(path.join(__dirname, "bubble.html"));
    bubbleWindow.on("move", () => {
        const b = bubbleWindow.getBounds();
        fs.writeFileSync(STORE, JSON.stringify({ x: b.x, y: b.y }));
        if (panelWindow) attachPanel();
    });
}

function attachPanel() {
    const b = bubbleWindow.getBounds();
    panelWindow.setPosition(b.x + b.width + 8, b.y, false);
}

function togglePanel() {
    if (panelWindow) {
        limpiarChatBackend(); // Borrar al ocultar
        panelWindow.close();
        panelWindow = null;
        return;
    }

    panelWindow = new BrowserWindow({
        width: 480, height: 620, alwaysOnTop: true, resizable: false,
        webPreferences: { 
            nodeIntegration: true, 
            contextIsolation: false,
            webSecurity: false
        }
    });

    panelWindow.loadURL("http://localhost:3000");

    panelWindow.on("closed", () => {
        panelWindow = null;
        limpiarChatBackend(); // Borrar si se cierra de otra forma
    });

    attachPanel();
}

ipcMain.on("toggle-panel", togglePanel);
app.whenReady().then(createBubble);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });