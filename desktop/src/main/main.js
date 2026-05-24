const {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  clipboard,
  Tray,
  Menu,
  nativeImage,
  Notification,
  shell,
  dialog,
} = require('electron')
const path = require('path')
const fs = require('fs')

// Native OS control via @nut-tree/nut-js
let nutMouse, nutKeyboard, Key, Button
try {
  const nut = require('@nut-tree-fork/nut-js')
  nutMouse    = nut.mouse
  nutKeyboard = nut.keyboard
  Key         = nut.Key
  Button      = nut.Button
  console.log('[RemoteLink] nut-js loaded — OS remote control ready')
} catch {
  console.warn('[RemoteLink] nut-js not installed — using fallback. Run: cd desktop && npm install @nut-tree/nut-js')
}

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
let mainWindow = null
let tray = null

// ── Single Instance Lock ────────────────────────────────────
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

// ── Create Window ────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d0d14',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
    show: false,
    icon: path.join(__dirname, '../../assets/icon.png'),
  })

  // Load renderer
  if (isDev) {
    mainWindow.loadURL('http://localhost:5174')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/renderer/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    mainWindow.focus()
  })

  mainWindow.on('close', (event) => {
    // Minimize to tray instead of closing
    event.preventDefault()
    mainWindow.hide()
    if (process.platform !== 'darwin') {
      showTrayNotification('RemoteLink is still running', 'Click the tray icon to reopen')
    }
  })
}

// ── System Tray ──────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, '../../assets/tray-icon.png')
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty()

  tray = new Tray(icon)
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open RemoteLink', click: () => { mainWindow.show(); mainWindow.focus() } },
    { type: 'separator' },
    { label: 'Start Session', click: () => { mainWindow.show(); mainWindow.webContents.send('tray:start-session') } },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.exit(0) } },
  ])
  tray.setToolTip('RemoteLink')
  tray.setContextMenu(contextMenu)
  tray.on('click', () => { mainWindow.show(); mainWindow.focus() })
}

function showTrayNotification(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body, silent: true }).show()
  }
}

// ── IPC Handlers ─────────────────────────────────────────────

// Screen sources for host capture
ipcMain.handle('desktop:getSources', async (_, opts = {}) => {
  const sources = await desktopCapturer.getSources({
    types: opts.types || ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true,
  })
  return sources.map(s => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail.toDataURL(),
    appIcon: s.appIcon?.toDataURL() || null,
  }))
})

// Clipboard
ipcMain.handle('clipboard:read', () => clipboard.readText())
ipcMain.handle('clipboard:write', (_, text) => { clipboard.writeText(text); return true })

// Window controls
ipcMain.handle('window:minimize', () => mainWindow.minimize())
ipcMain.handle('window:maximize', () => {
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
  return mainWindow.isMaximized()
})
ipcMain.handle('window:close', () => mainWindow.hide())
ipcMain.handle('window:isMaximized', () => mainWindow.isMaximized())

// File dialog
ipcMain.handle('dialog:openFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
  })
  return result.canceled ? [] : result.filePaths
})

ipcMain.handle('dialog:saveFile', async (_, defaultName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
  })
  return result.canceled ? null : result.filePath
})

// Open external link
ipcMain.handle('shell:openExternal', (_, url) => shell.openExternal(url))

// App info
ipcMain.handle('app:getVersion', () => app.getVersion())
ipcMain.handle('app:getPlatform', () => process.platform)
ipcMain.handle('app:getDeviceId', () => {
  const { machineId } = require('node:os')
  return `desktop-${process.platform}-${require('crypto').createHash('md5').update(require('os').hostname()).digest('hex').slice(0, 12)}`
})

// Quit
ipcMain.handle('app:quit', () => app.exit(0))



// ── Remote Control IPC (OS-level execution) ──────────────────
ipcMain.handle('control:execute', async (_, event) => {
  try {
    if (!nutMouse || !nutKeyboard) {
      // Fallback: use Electron's built-in robot API (macOS/Windows partial)
      return { error: 'nut-js not available' }
    }

    const display   = require('electron').screen.getPrimaryDisplay()
    const { width, height } = display.size

    const absX = Math.round((event.x || 0) * width)
    const absY = Math.round((event.y || 0) * height)

    switch (event.type) {
      case 'mousemove':
        await nutMouse.setPosition({ x: absX, y: absY })
        break

      case 'mousedown':
      case 'click':
        await nutMouse.setPosition({ x: absX, y: absY })
        await nutMouse.pressButton(event.button === 2 ? Button.RIGHT : Button.LEFT)
        if (event.type === 'click') await nutMouse.releaseButton(event.button === 2 ? Button.RIGHT : Button.LEFT)
        break

      case 'mouseup':
        await nutMouse.releaseButton(event.button === 2 ? Button.RIGHT : Button.LEFT)
        break

      case 'dblclick':
        await nutMouse.setPosition({ x: absX, y: absY })
        await nutMouse.doubleClick(Button.LEFT)
        break

      case 'scroll':
        // Scroll: positive deltaY = scroll down
        await nutMouse.scrollDown(Math.abs(Math.round(event.deltaY / 120)) || 1)
        if (event.deltaY < 0) await nutMouse.scrollUp(Math.abs(Math.round(event.deltaY / 120)) || 1)
        break

      case 'keydown': {
        const modifiers = []
        if (event.ctrl)  modifiers.push(Key.LeftControl)
        if (event.alt)   modifiers.push(Key.LeftAlt)
        if (event.shift) modifiers.push(Key.LeftShift)
        if (event.meta)  modifiers.push(Key.LeftSuper)

        const key = mapKeyToNut(event.key)
        if (key) {
          modifiers.length
            ? await nutKeyboard.pressKey(...modifiers, key)
            : await nutKeyboard.pressKey(key)
        } else if (event.key?.length === 1) {
          await nutKeyboard.type(event.key)
        }
        break
      }

      case 'keyup': {
        const key = mapKeyToNut(event.key)
        if (key) await nutKeyboard.releaseKey(key)
        break
      }
    }
    return { success: true }
  } catch (err) {
    console.error('[Control] Execute error:', err.message)
    return { error: err.message }
  }
})

function mapKeyToNut(keyName) {
  if (!Key) return null
  const map = {
    'Backspace': Key.Backspace, 'Tab': Key.Tab, 'Enter': Key.Return,
    'Escape': Key.Escape, 'Delete': Key.Delete, 'Home': Key.Home, 'End': Key.End,
    'ArrowLeft': Key.Left, 'ArrowRight': Key.Right, 'ArrowUp': Key.Up, 'ArrowDown': Key.Down,
    'PageUp': Key.PageUp, 'PageDown': Key.PageDown,
    'F1': Key.F1, 'F2': Key.F2, 'F3': Key.F3, 'F4': Key.F4, 'F5': Key.F5,
    'F6': Key.F6, 'F7': Key.F7, 'F8': Key.F8, 'F9': Key.F9, 'F10': Key.F10,
    'F11': Key.F11, 'F12': Key.F12,
    ' ': Key.Space, 'Control': Key.LeftControl, 'Alt': Key.LeftAlt,
    'Shift': Key.LeftShift, 'Meta': Key.LeftSuper, 'CapsLock': Key.CapsLock,
  }
  return map[keyName] || null
}

// ── App Lifecycle ─────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow()
  createTray()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else mainWindow.show()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  mainWindow.removeAllListeners('close')
})
