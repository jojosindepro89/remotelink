const { contextBridge, ipcRenderer } = require('electron')

/**
 * Secure IPC bridge — exposes only specific APIs to the renderer process.
 * No direct Node.js/Electron access from the renderer.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // ── Screen Capture ──────────────────────────────────────
  getSources: (opts) => ipcRenderer.invoke('desktop:getSources', opts),

  // ── Clipboard ───────────────────────────────────────────
  clipboardRead: () => ipcRenderer.invoke('clipboard:read'),
  clipboardWrite: (text) => ipcRenderer.invoke('clipboard:write', text),

  // ── Window Controls ─────────────────────────────────────
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),

  // ── File System ─────────────────────────────────────────
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  saveFileDialog: (name) => ipcRenderer.invoke('dialog:saveFile', name),

  // ── Shell ───────────────────────────────────────────────
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // ── App Info ────────────────────────────────────────────
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getPlatform: () => ipcRenderer.invoke('app:getPlatform'),
  getDeviceId: () => ipcRenderer.invoke('app:getDeviceId'),
  quit: () => ipcRenderer.invoke('app:quit'),

  // ── Events from main ────────────────────────────────────
  onTrayStartSession: (callback) => {
    ipcRenderer.on('tray:start-session', () => callback())
    return () => ipcRenderer.removeAllListeners('tray:start-session')
  },

  // ── Is Electron ─────────────────────────────────────────
  isElectron: true,

  // ── Remote Control (HOST side) ──────────────────────────
  // Called when a viewer sends mouse/keyboard control events.
  // Relayed to main.js → robotjs/nut-js for OS-level injection.
  executeControl: (event) => ipcRenderer.invoke('control:execute', event),

  // Cursor position stream (for sharing cursor position with viewer)
  onCursorUpdate: (callback) => {
    ipcRenderer.on('control:cursor', (_, pos) => callback(pos))
    return () => ipcRenderer.removeAllListeners('control:cursor')
  },
})
