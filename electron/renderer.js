const { ipcRenderer } = require("electron");

document.getElementById("btn").addEventListener("click", () => {
  ipcRenderer.send("toggle-panel");
});
