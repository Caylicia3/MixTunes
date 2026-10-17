'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('audioBridge', {
  onCommand(fn) { ipcRenderer.on('audio:command', (_event, command) => fn(command)); },
  event(event) { ipcRenderer.send('audio:event', event); }
});
