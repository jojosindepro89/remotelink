package com.remotelink.mobile

import android.content.Intent
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class RemoteControlModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "RemoteControl"

  @ReactMethod
  fun isEnabled(promise: Promise) {
    promise.resolve(RemoteControlService.instance != null)
  }

  @ReactMethod
  fun openAccessibilitySettings(promise: Promise) {
    try {
      val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK
      }
      reactApplicationContext.startActivity(intent)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("E_OPEN_SETTINGS", e.message, e)
    }
  }

  @ReactMethod
  fun tap(x: Double, y: Double, promise: Promise) {
    val svc = RemoteControlService.instance
      ?: return promise.reject("E_NOT_ENABLED", "Accessibility service not enabled")
    promise.resolve(svc.dispatchTap(x.toFloat(), y.toFloat()))
  }

  @ReactMethod
  fun longPress(x: Double, y: Double, promise: Promise) {
    val svc = RemoteControlService.instance
      ?: return promise.reject("E_NOT_ENABLED", "Accessibility service not enabled")
    promise.resolve(svc.dispatchLongPress(x.toFloat(), y.toFloat()))
  }

  @ReactMethod
  fun swipe(x1: Double, y1: Double, x2: Double, y2: Double, durationMs: Int, promise: Promise) {
    val svc = RemoteControlService.instance
      ?: return promise.reject("E_NOT_ENABLED", "Accessibility service not enabled")
    promise.resolve(svc.dispatchSwipe(x1.toFloat(), y1.toFloat(), x2.toFloat(), y2.toFloat(), durationMs.toLong()))
  }

  @ReactMethod
  fun pressHome(promise: Promise) {
    val svc = RemoteControlService.instance
      ?: return promise.reject("E_NOT_ENABLED", "Accessibility service not enabled")
    promise.resolve(svc.pressHome())
  }

  @ReactMethod
  fun pressBack(promise: Promise) {
    val svc = RemoteControlService.instance
      ?: return promise.reject("E_NOT_ENABLED", "Accessibility service not enabled")
    promise.resolve(svc.pressBack())
  }

  @ReactMethod
  fun pressRecents(promise: Promise) {
    val svc = RemoteControlService.instance
      ?: return promise.reject("E_NOT_ENABLED", "Accessibility service not enabled")
    promise.resolve(svc.pressRecents())
  }
}
