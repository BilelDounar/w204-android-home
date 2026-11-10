// W204 Home (Mercedes C-Class W204 Android head unit) — Vehicle data source selection (FYT/SYU decoder, probe/logging mode, demo, idle).
package fr.w204.home

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONObject

/**
 * Where vehicle signals come from. ONLY the CAN decoder box + the unit's MCU (wired inputs) — never OBD.
 * Implementations push raw JSON matching web/app/src/signals.js, e.g. {"acc":true,"speed":42,"doors":{"FL":true}}.
 *
 * The real implementation depends on the unit and is chosen after `adb/discover.sh` + `adb/can_capture.sh`
 * (docs/donnees-decodeur.md, from cleanest to most fragile):
 *   1. system service IPC of the platform (FYT: com.syu.ms "toolkit")      -> SyuSource (to write)
 *   2. broadcasts / content provider of the CAN app                        -> BroadcastSource (to write)
 *   3. CAN app logs (READ_LOGS granted once via adb)                       -> LogcatSource (to write)
 *   4. decoder serial port (root)                                          -> last resort
 */
interface VehicleSource {
    fun start()
    fun stop()
    /** media control from the page (prev | toggle | next); returns false if this source cannot handle it */
    fun media(action: String): Boolean = false

    companion object {
        fun create(ctx: Context, emit: (String) -> Unit, emitMedia: (String) -> Unit = {}): VehicleSource {
            val pref = ctx.getSharedPreferences("w204", Context.MODE_PRIVATE).getString("source", "syu")
            return when (pref) {
                "demo" -> DemoSource(emit)
                "idle" -> IdleSource(emit)
                "probe" -> SyuSource(ctx, emit, probe = true, emitMedia = emitMedia)
                else -> SyuSource(ctx, emit, probe = false, emitMedia = emitMedia)     // FYT platform service (decoder box), default
            }
        }
    }
}

/** Default until the real source exists: the unit is on, so the contact is on (the unit only wakes with ACC). */
class IdleSource(private val emit: (String) -> Unit) : VehicleSource {
    override fun start() = emit(JSONObject().put("acc", true).toString())
    override fun stop() {}
}

/** Replays a short drive, to check the whole chain native -> JS on the unit.
 *  Enable: adb shell am start -n fr.w204.home/.MainActivity --es source demo   (back: --es source idle) */
class DemoSource(private val emit: (String) -> Unit) : VehicleSource {
    private val h = Handler(Looper.getMainLooper())
    private val steps = listOf(
        500L to """{"acc":true}""",
        5500L to """{"engine":true}""",
        9500L to """{"speed":50,"lowbeam":true}""",
        14000L to """{"signal_R":true}""", 17000L to """{"signal_R":false}""",
        19000L to """{"speed":0}""",
        21000L to """{"doors":{"FL":true}}""", 24000L to """{"doors":{"FL":false}}""",
    )
    override fun start() { steps.forEach { (t, j) -> h.postDelayed({ emit(j) }, t) } }
    override fun stop() { h.removeCallbacksAndMessages(null) }
}
