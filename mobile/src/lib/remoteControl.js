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
 */
export async function executeIncomingEvent(event, screenWidth, screenHeight) {
  if (!isAvailable) return
  if (!event || typeof event !== 'object') return
  const px = (event.x ?? 0) * screenWidth
  const py = (event.y ?? 0) * screenHeight

  switch (event.type) {
    case 'mouseclick':
    case 'tap':
      return tap(px, py)
    case 'longpress':
    case 'rightclick':
      return longPress(px, py)
    case 'swipe':
      return swipe(
        (event.x1 ?? event.x ?? 0) * screenWidth,
        (event.y1 ?? event.y ?? 0) * screenHeight,
        (event.x2 ?? event.x ?? 0) * screenWidth,
        (event.y2 ?? event.y ?? 0) * screenHeight,
        event.durationMs || 300
      )
    case 'home':    return pressHome()
    case 'back':    return pressBack()
    case 'recents': return pressRecents()
    // We don't act on mousemove on Android — there's no cursor concept; we
    // only act on discrete events like clicks/swipes.
    case 'mousemove':
    default:
      return
  }
}

export const remoteControlAvailable = isAvailable
