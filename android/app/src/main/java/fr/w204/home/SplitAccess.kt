// W204 Home (Mercedes C-Class W204 Android head unit) — Accessibility helper: toggles Android split screen (home screen + Waze). Reads no screen content.
package fr.w204.home

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.util.Log
import android.view.accessibility.AccessibilityEvent

/**
 * Split view helper. Android does not let a normal app put itself in split screen; an accessibility service can:
 * GLOBAL_ACTION_TOGGLE_SPLIT_SCREEN (same as the system Recents shortcut) + a drag gesture on the divider (1/3 snap).
 * Enabled once over adb (see docs/adb-playbook.md). It reads no screen content.
 */
class SplitAccess : AccessibilityService() {
    override fun onServiceConnected() { instance = this; Log.i(TAG, "split helper ready") }
    override fun onDestroy() { if (instance === this) instance = null; super.onDestroy() }
    override fun onAccessibilityEvent(e: AccessibilityEvent?) {}
    override fun onInterrupt() {}

    fun toggleSplit() = performGlobalAction(GLOBAL_ACTION_TOGGLE_SPLIT_SCREEN)

    /** drag the split divider horizontally (screen px) */
    fun drag(fromX: Float, toX: Float, y: Float) {
        val p = Path().apply { moveTo(fromX, y); lineTo(toX, y) }
        dispatchGesture(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(p, 0, 450)).build(), null, null)
    }

    companion object { const val TAG = "W204Split"; @Volatile var instance: SplitAccess? = null }
}
