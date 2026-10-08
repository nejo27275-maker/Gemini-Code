package com.nitido.gpu

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent

class NitidoAccessibility : AccessibilityService() {
    override fun onServiceConnected() { instance = this; listener?.run() }
    override fun onAccessibilityEvent(e: AccessibilityEvent?) {}
    override fun onInterrupt() {}
    override fun onUnbind(intent: android.content.Intent?): Boolean { instance = null; listener?.run(); return super.onUnbind(intent) }
    override fun onDestroy() { instance = null; listener?.run(); super.onDestroy() }

    companion object {
        @Volatile var instance: NitidoAccessibility? = null
        @Volatile var listener: Runnable? = null
    }
}