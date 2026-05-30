import { NativeModules, Platform } from 'react-native'

const { RemoteControl } = NativeModules

/**
 * Wrapper for the native RemoteControl module (Android AccessibilityService).
 *
 * iOS is unsupported — Apple does not permit cross-app input injection.
 * If the user hasn't enabled the Accessibility Service, `isEnabled()`
 * returns false. Use `openAccessibilitySettings()` to send them there.
 */

const isAndroid = Platform.OS === 'android'
const isAvailable = isAndroid && !!RemoteControl

export async function isEnabled() {
  if (!isAvailable) return false
  try { return await RemoteControl.isEnabled() } catch { return false }
}

export async function openAccessibilitySettings() {
  if (!isAvailable) throw new Error('Remote control is only supported on Android')
  return RemoteControl.openAccessibilitySettings()
}

/** Single tap at the given screen coordinates (in pixels). */
export async function tap(x, y) {
  if (!isAvailable) throw new Error('Remote control not available')
  return RemoteControl.tap(x, y)
}

export async function longPress(x, y) {
  if (!isAvailable) throw new Error('Remote control not available')
  return RemoteControl.longPress(x, y)
}

export async function swipe(x1, y1, x2, y2, durationMs = 300) {
  if (!isAvailable) throw new Error('Remote control not available')
  return RemoteControl.swipe(x1, y1, x2, y2, durationMs)
}

export async function pressHome()    { return isAvailable ? RemoteControl.pressHome()    : null }
export async function pressBack()    { return isAvailable ? RemoteControl.pressBack()    : null }
export async function pressRecents() { return isAvailable ? RemoteControl.pressRecents() : null }

/**
 * Translate an incoming control event (sent over the WebRTC data channel
 * from the viewer) into a native gesture call.
 *
 * The event's x/y are normalized to [0..1] of the host's screen.
 * We multiply by `screenWidth`/`screenHeight` to get actual pixels.
 *
 * Event vocabulary the desktop produces (web/src/pages/Session.jsx):
 *   mousemove, mousedown, mouseup, click, dblclick, scroll, keydown, keyup
 * Plus virtual events from the future mobile-driven viewer:
 *   tap, longpress, swipe, home, back, recents
 */

// Track pointer state so we can synthesize swipes from mousedown→mousemove→mouseup
let pointerDown = null  // { x, y, t }
const DRAG_THRESHOLD_PX = 12  // movement to consider it a drag vs. click

export async function executeIncomingEvent(event, screenWidth, screenHeight) {
  if (!isAvailable) return
  if (!event || typeof event !== 'object') return
  const px = (event.x ?? 0) * screenWidth
  const py = (event.y ?? 0) * screenHeight

  switch (event.type) {
    // ── Desktop-style mouse events ─────────────────────────────
    case 'mousedown':
      pointerDown = { x: px, y: py, t: Date.now() }
      return
    case 'mouseup': {
      if (!pointerDown) return tap(px, py)
      const dx = px - pointerDown.x
      const dy = py - pointerDown.y
      const dist = Math.hypot(dx, dy)
      const dt = Date.now() - pointerDown.t
      const start = pointerDown
      pointerDown = null
      if (dist > DRAG_THRESHOLD_PX) {
        // Real drag — synthesize a swipe
        return swipe(start.x, start.y, px, py, Math.max(120, Math.min(dt, 1200)))
      }
      if (dt > 600) return longPress(start.x, start.y)
      return tap(start.x, start.y)
    }
    case 'click':       return tap(px, py)
    case 'dblclick':    { await tap(px, py); return tap(px, py) }
    case 'rightclick':
    case 'longpress':   return longPress(px, py)

    // ── Native tap/swipe (for future use from mobile viewers) ──
    case 'tap':         return tap(px, py)
    case 'swipe':
      return swipe(
        (event.x1 ?? event.x ?? 0) * screenWidth,
        (event.y1 ?? event.y ?? 0) * screenHeight,
        (event.x2 ?? event.x ?? 0) * screenWidth,
        (event.y2 ?? event.y ?? 0) * screenHeight,
        event.durationMs || 300
      )

    // ── Hardware buttons ───────────────────────────────────────
    case 'home':    return pressHome()
    case 'back':    return pressBack()
    case 'recents': return pressRecents()

    // ── Intentionally ignored ──────────────────────────────────
    // mousemove fires too often to inject; Android has no cursor concept anyway.
    // scroll could become a swipe but desktop sends it without coordinates.
    // keydown/keyup require focused-node querying — not implemented yet.
    case 'mousemove':
    case 'scroll':
    case 'keydown':
    case 'keyup':
    default:
      return
  }
}

export const remoteControlAvailable = isAvailable
