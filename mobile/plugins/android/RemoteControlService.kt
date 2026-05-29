package com.remotelink.mobile

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Path
import android.os.Build
import android.util.Log
import android.view.accessibility.AccessibilityEvent

/**
 * RemoteControl Accessibility Service
 *
 * Receives gesture commands from the JS side (via RemoteControlModule) and
 * dispatches them at the OS level using Android's AccessibilityService API.
 * This is the same mechanism screen-readers and switch-control apps use.
 *
 * The user must manually enable this in:
 *   Settings → Accessibility → RemoteLink → toggle on
 */
class RemoteControlService : AccessibilityService() {

  override fun onServiceConnected() {
    super.onServiceConnected()
    instance = this
    Log.i(TAG, "RemoteControlService connected — remote control active")
  }

  override fun onUnbind(intent: Intent?): Boolean {
    instance = null
    Log.i(TAG, "RemoteControlService unbound")
    return super.onUnbind(intent)
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    // We don't observe events — we only inject them.
  }

  override fun onInterrupt() {
    // No-op
  }

  // ── Public injection API (called from RemoteControlModule via static instance) ──

  fun dispatchTap(x: Float, y: Float, durationMs: Long = 50L): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false
    val path = Path().apply { moveTo(x, y) }
    val stroke = GestureDescription.StrokeDescription(path, 0, durationMs)
    val gesture = GestureDescription.Builder().addStroke(stroke).build()
    return dispatchGesture(gesture, null, null)
  }

  fun dispatchLongPress(x: Float, y: Float): Boolean =
    dispatchTap(x, y, 800L)

  fun dispatchSwipe(x1: Float, y1: Float, x2: Float, y2: Float, durationMs: Long = 300L): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false
    val path = Path().apply {
      moveTo(x1, y1)
      lineTo(x2, y2)
    }
    val stroke = GestureDescription.StrokeDescription(path, 0, durationMs)
    val gesture = GestureDescription.Builder().addStroke(stroke).build()
    return dispatchGesture(gesture, null, null)
  }

  fun pressHome(): Boolean = performGlobalAction(GLOBAL_ACTION_HOME)
  fun pressBack(): Boolean = performGlobalAction(GLOBAL_ACTION_BACK)
  fun pressRecents(): Boolean = performGlobalAction(GLOBAL_ACTION_RECENTS)
  fun showNotifications(): Boolean = performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS)

  companion object {
    private const val TAG = "RemoteControlService"
    @Volatile
    var instance: RemoteControlService? = null
      private set
  }
}
