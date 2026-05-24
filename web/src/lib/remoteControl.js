/**
 * RemoteControlExecutor
 *
 * Executes incoming control events from the viewer on the HOST machine.
 *
 * Two execution modes:
 *   1. Electron (desktop app) — uses window.electronAPI to call native robotjs/nut-js
 *      via IPC to inject real OS-level mouse & keyboard events
 *   2. Web browser (same-origin page sharing) — uses experimental Pointer Lock +
 *      InputEvent injection, plus falls back to a visual simulation overlay
 *
 * The event schema:
 *   { type, x?, y?, button?, key?, code?, ctrl?, alt?, shift?, meta?, deltaX?, deltaY? }
 *   x, y are 0-1 normalised fractions of the screen/video dimensions
 */

export default class RemoteControlExecutor {
  constructor() {
    this.isElectron = typeof window !== 'undefined' && !!window.electronAPI?.executeControl
    this.screenW    = window.screen?.width  || 1920
    this.screenH    = window.screen?.height || 1080
  }

  /**
   * Execute a single control event.
   * @param {object} event  - The control event from the viewer
   * @param {DOMRect} videoRect - Bounding rect of the video element on the host screen
   */
  execute(event, videoRect) {
    if (this.isElectron) {
      // Desktop app: delegate to Electron IPC → robotjs/nut-js
      this._executeViaElectron(event)
    } else {
      // Web browser host: inject into the page itself
      this._executeInBrowser(event, videoRect)
    }
  }

  // ── Electron / Desktop path ────────────────────────────────────

  _executeViaElectron(event) {
    // window.electronAPI.executeControl is exposed by preload.js
    // It calls ipcMain → robotjs to inject real OS events
    try {
      window.electronAPI.executeControl(event)
    } catch (err) {
      console.warn('[Control] Electron IPC error:', err.message)
    }
  }

  // ── Browser (web) path ────────────────────────────────────────
  // When the host is running the web app and sharing their browser tab,
  // we can inject events into the document. This works for browser-to-browser
  // remote control of a web page.

  _executeInBrowser(event, videoRect) {
    const { type, x = 0, y = 0 } = event

    // Convert normalised 0-1 coords to page pixel coords
    const px = videoRect ? videoRect.left + x * videoRect.width  : x * window.innerWidth
    const py = videoRect ? videoRect.top  + y * videoRect.height : y * window.innerHeight

    // Find the element at the target position
    const target = document.elementFromPoint(px, py) || document.body

    switch (type) {
      case 'mousemove':
        this._dispatchMouse(target, 'mousemove', px, py, event)
        break

      case 'mousedown':
        this._dispatchMouse(target, 'mousedown', px, py, event)
        break

      case 'mouseup':
        this._dispatchMouse(target, 'mouseup', px, py, event)
        break

      case 'click':
        this._dispatchMouse(target, 'click', px, py, event)
        // Focus the clicked element (e.g., inputs)
        if (typeof target.focus === 'function') target.focus()
        break

      case 'dblclick':
        this._dispatchMouse(target, 'dblclick', px, py, event)
        break

      case 'rightclick':
        this._dispatchMouse(target, 'contextmenu', px, py, { ...event, button: 2 })
        break

      case 'scroll':
        this._dispatchWheel(target, event.deltaX || 0, event.deltaY || 0)
        break

      case 'keydown':
        this._dispatchKey(document.activeElement || document.body, 'keydown', event)
        // For printable characters, also fire 'input' on editable elements
        if (event.key?.length === 1 && !event.ctrl && !event.alt && !event.meta) {
          this._injectText(document.activeElement, event.key)
        }
        break

      case 'keyup':
        this._dispatchKey(document.activeElement || document.body, 'keyup', event)
        break

      default:
        console.debug('[Control] Unknown event type:', type)
    }
  }

  _dispatchMouse(target, eventType, clientX, clientY, event = {}) {
    const e = new MouseEvent(eventType, {
      bubbles:    true,
      cancelable: true,
      view:       window,
      clientX,
      clientY,
      screenX:    clientX,
      screenY:    clientY,
      button:     event.button  || 0,
      buttons:    event.buttons || 1,
      ctrlKey:    !!event.ctrl,
      altKey:     !!event.alt,
      shiftKey:   !!event.shift,
      metaKey:    !!event.meta,
    })
    target.dispatchEvent(e)
  }

  _dispatchWheel(target, deltaX, deltaY) {
    const e = new WheelEvent('wheel', {
      bubbles:    true,
      cancelable: true,
      view:       window,
      deltaX,
      deltaY,
      deltaMode:  WheelEvent.DOM_DELTA_PIXEL,
    })
    target.dispatchEvent(e)
  }

  _dispatchKey(target, eventType, event = {}) {
    const e = new KeyboardEvent(eventType, {
      bubbles:    true,
      cancelable: true,
      key:        event.key   || '',
      code:       event.code  || '',
      ctrlKey:    !!event.ctrl,
      altKey:     !!event.alt,
      shiftKey:   !!event.shift,
      metaKey:    !!event.meta,
    })
    target.dispatchEvent(e)
  }

  _injectText(target, char) {
    if (!target) return
    const tag = target.tagName?.toLowerCase()
    if (tag === 'input' || tag === 'textarea' || target.isContentEditable) {
      // Directly insert character into focused input
      const start = target.selectionStart ?? target.value?.length ?? 0
      const end   = target.selectionEnd   ?? start
      if (typeof target.value === 'string') {
        target.value = target.value.slice(0, start) + char + target.value.slice(end)
        target.selectionStart = target.selectionEnd = start + 1
      } else if (target.isContentEditable) {
        document.execCommand('insertText', false, char)
      }
      target.dispatchEvent(new Event('input', { bubbles: true }))
      target.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }
}

// ── Key mapping helpers ────────────────────────────────────────

/**
 * Map viewer key names to robotjs key names (for Electron IPC)
 * Used by preload.js / main.js on the desktop side.
 */
export const ROBOTJS_KEY_MAP = {
  Backspace: 'backspace', Tab: 'tab', Enter: 'enter', Escape: 'escape',
  Delete: 'delete', Home: 'home', End: 'end',
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  PageUp: 'pageup', PageDown: 'pagedown',
  F1:'f1', F2:'f2', F3:'f3', F4:'f4', F5:'f5', F6:'f6',
  F7:'f7', F8:'f8', F9:'f9', F10:'f10', F11:'f11', F12:'f12',
  Insert: 'insert', PrintScreen: 'printscreen', ScrollLock: 'scrolllock',
  ' ': 'space', Control: 'control', Alt: 'alt', Shift: 'shift', Meta: 'command',
  CapsLock: 'capslock', NumLock: 'numlock',
}
