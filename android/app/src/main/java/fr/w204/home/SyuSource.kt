// W204 Home (Mercedes C-Class W204 Android head unit) — Vehicle data from FYT/SYU head units (UIS7862 etc.): CAN decoder box -> MCU -> com.syu.ms IPC. No OBD.
package fr.w204.home

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Binder
import android.os.IBinder
import android.os.Parcel
import android.util.Log
import org.json.JSONObject

/**
 * Vehicle data from the FYT/SYU platform service (decoder box -> MCU -> com.syu.ms), no OBD.
 * Interface reverse-read from the unit's own apps (com.syu.canbus):
 *   IRemoteToolkit (service "com.syu.ms.toolkit"): 1 = getRemoteModule(int) -> IRemoteModule
 *   IRemoteModule: 1 cmd, 2 get, 3 register(IModuleCallback, int code, int update), 4 unregister
 *   IModuleCallback: 1 update(int code, int[] ints, float[] flts, String[] strs)
 *   modules: 0 MAIN, 4 SOUND, 7 CANBUS
 * Canbus door codes (FinalCanbus): 0 hood(ENGINE), 1 FL, 2 FR, 3 RL, 4 RR, 5 trunk(BACK). Value ints[0] != 0 = open.
 *
 * probe = true : subscribes to every code of MAIN (0..399) and CANBUS (0..1199) and logs each update
 *                (tag W204SYU) — used to discover lights / speed / engine codes on this car.
 */
class SyuSource(private val ctx: Context, private val emit: (String) -> Unit, private val probe: Boolean,
                private val emitMedia: (String) -> Unit = {}) : VehicleSource {

    private var conn: ServiceConnection? = null
    private val modules = mutableMapOf<Int, IBinder>()
    private val doors = JSONObject()

    // the callback does not tell which module it comes from: one callback object per module
    private val callbacks = mutableMapOf<Int, Binder>()

    private fun callbackFor(module: Int): Binder = callbacks.getOrPut(module) {
        object : Binder() {
            override fun onTransact(code: Int, data: Parcel, reply: Parcel?, flags: Int): Boolean {
                if (code == INTERFACE_TRANSACTION) { reply?.writeString(CB_DESC); return true }
                if (code != 1) return super.onTransact(code, data, reply, flags)
                data.enforceInterface(CB_DESC)
                val c = data.readInt(); val ints = data.createIntArray(); val flts = data.createFloatArray(); val strs = data.createStringArray()
                onUpdate(module, c, ints, flts, strs)
                reply?.writeNoException()
                return true
            }
        }
    }

    private var gps: GpsSpeed? = null

    override fun start() {
        gps = GpsSpeed(ctx) { kmh -> if (android.os.SystemClock.elapsedRealtime() - canSpeedAt > 3000) emit("""{"speed":$kmh}""") }.also { it.start() }   // GPS unless the decoder streams speed
        emit("""{"acc":true}""")                       // the unit only runs with ACC on
        val i = Intent("com.syu.ms.toolkit").setPackage("com.syu.ms")
        conn = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName?, service: IBinder) {
                Log.i(TAG, "toolkit connected")
                for (m in listOf(MAIN, CANBUS, BT)) {
                    val mod = getModule(service, m) ?: continue
                    modules[m] = mod
                    val codes = if (probe) (if (m == CANBUS) 0 until 1200 else 0 until 400) else KNOWN[m] ?: emptyList()
                    for (c in codes) register(mod, callbackFor(m), c)
                    Log.i(TAG, "module $m: ${codes.count()} codes registered")
                }
                // ask the decoder to stream vehicle info (speed, rpm…) like the stock "Meter" page does: cmd(4, 1, 0).
                // Every 3 s (was 20 s: up to 20 s before the engine start was seen).
                modules[CANBUS]?.let { mod -> requestInfo(mod); keepAlive = Runnable { requestInfo(mod); staleRpm(); handler.postDelayed(keepAlive!!, 3_000) }.also { handler.postDelayed(it, 3_000) } }
            }
            override fun onServiceDisconnected(name: ComponentName?) { modules.clear(); Log.w(TAG, "toolkit disconnected") }
        }
        val ok = ctx.bindService(i, conn!!, Context.BIND_AUTO_CREATE)
        Log.i(TAG, "bind toolkit: $ok (probe=$probe)")
    }

    override fun stop() {
        gps?.stop()
        keepAlive?.let { handler.removeCallbacks(it) }
        modules.forEach { (m, mod) -> (if (probe) (0 until 1200) else KNOWN[m] ?: emptyList()).forEach { unregister(mod, callbackFor(m), it) } }
        conn?.let { try { ctx.unbindService(it) } catch (_: Exception) {} }
    }

    private val state = JSONObject()
    private var pos = false; private var low = false
    @Volatile private var canSpeedAt = 0L   // last non-zero decoder speed; GPS is used when it is older than 3 s

    private fun onUpdate(module: Int, code: Int, ints: IntArray?, flts: FloatArray?, strs: Array<String>?) {
        if (probe) Log.i(TAG, "upd m=$module c=$code ints=${ints?.joinToString(",")} flts=${flts?.joinToString(",")} strs=${strs?.joinToString("|")}")
        if (module == BT) { onBt(code, ints, strs); return }
        val v = ints?.firstOrNull() ?: return
        val out = JSONObject()
        when (module) {
            CANBUS -> when (code) {
                // captured on this car 2026-11-10 (docs/donnees-decodeur.md)
                in 0..5 -> { doors.put(arrayOf("hood", "FL", "FR", "RL", "RR", "trunk")[code], v != 0); out.put("doors", doors) }
                7 -> { pos = v != 0; lights(out) }                 // frame 0x12 bit 0x40: position lights
                8 -> { low = v != 0; lights(out) }                 // frame 0x12 bit 0x20: headlights
                9 -> out.put("signal_L", v != 0)                   // bit 0x04
                10 -> out.put("signal_R", v != 0)                  // bit 0x02
                13 -> out.put("handbrake", v != 0)                 // byte 5 bit 0x01
                18 -> { reverseNow = v != 0; out.put("reverse", v != 0) }   // byte 5 bit 0x40
                17 -> if (v > 0) out.put("odometer", v)            // total km (as shown by the stock Meter page)
                11 -> out.put("seatbelt", v != 0)                  // driver seatbelt (Meter page warning)
                16 -> if (v in 0..9000) { out.put("rpm", v); lastRpm = v; rpmAt = android.os.SystemClock.elapsedRealtime() }   // frame 0x18 bytes 6-7 (streamed after cmd(4,1,0))
                14 -> if (v in 1..300) { canSpeedAt = android.os.SystemClock.elapsedRealtime(); out.put("speed", v) }   // decoder speed when it streams (Meter: DATA[14])
            }
            MAIN -> when (code) {
                0 -> appId = ints?.firstOrNull() ?: appId          // U_APP_ID: current audio source (3 = BT music)
                4 -> {}                                            // dash illumination: on with position lights too -> not used for the theme
            }
        }
        if (out.length() > 0) emit(out.toString())
    }

    /* ---- Bluetooth music (FYT BT module 2, FinalBt): iPhone over A2DP/AVRCP ---- */
    private val media = JSONObject()
    private fun onBt(code: Int, ints: IntArray?, strs: Array<String>?): Unit = synchronized(media) {
        when (code) {
            0 -> media.put("title", strs?.firstOrNull() ?: "")        // U_BTAV_ID3_TITLE
            1 -> media.put("artist", strs?.firstOrNull() ?: "")       // U_BTAV_ID3_ARTIST
            26 -> media.put("album", strs?.firstOrNull() ?: "")       // U_BTAV_ID3_ALBUM
            13 -> { val on = (ints?.firstOrNull() ?: 0) == 1; media.put("playing", on); if (on) ensureBtAudio() } // U_BTAV_PLAY_STATE
            2 -> media.put("duration", ints?.firstOrNull() ?: 0)      // U_BTAV_TOTAL_TIME (ms)
            28 -> media.put("position", ints?.firstOrNull() ?: 0)     // U_BTAV_PLAY_TIME (ms)
            34 -> media.put("connected", (ints?.firstOrNull() ?: 0) == 2) // U_A2DP_SINK_STATE
            7 -> media.put("phone", strs?.firstOrNull() ?: "")            // U_PHONE_NAME = the paired phone's name
            8 -> media.put("callNumber", strs?.firstOrNull() ?: "")       // U_PHONE_NUMBER
            9 -> media.put("callState", ints?.firstOrNull() ?: 0)         // U_PHONE_STATE: 3 dial, 4 ring, 5 talk (FinalBt)
            12 -> media.put("callTime", ints?.firstOrNull() ?: 0)         // U_TALK_TIME
            else -> return
        }
        media.put("source", "bt")
        val artist = media.optString("artist"); val title = media.optString("title"); val key = "$artist|$title"
        val now = android.os.SystemClock.elapsedRealtime()
        if (key != coverKey || (media.optString("cover").isEmpty() && key != "|" && now - coverTry > 60_000)) {
            if (key != coverKey) media.put("cover", "")
            coverKey = key; coverTry = now
            covers.request(artist, title, media.optString("album")) { url ->
                synchronized(media) { if (coverKey == key) { media.put("cover", url); emitMedia(media.toString()) } }
            }
        }
        emitMedia(media.toString())
    }
    /** BT music plays but is silent until the audio source (MAIN app id) is BT music: the stock BT app fixes it by
     *  sending MAIN cmd(C_APP_ID=0, APP_ID_BTAV=3) (Ipc_New.LauncherRequestAppIdBtAv). We do the same when music plays. */
    @Volatile private var appId = -1
    private var appIdAsked = 0L
    private fun ensureBtAudio() {
        val main = modules[MAIN] ?: return
        val now = android.os.SystemClock.elapsedRealtime()
        if (appId == 3 || now - appIdAsked < 3000) return
        appIdAsked = now
        call(main, 1) { it.writeInt(0); it.writeIntArray(intArrayOf(3)); it.writeFloatArray(null); it.writeStringArray(null) }
        Log.i(TAG, "audio source $appId -> BT music (3)")
    }
    private val covers = CoverArt(ctx)
    @Volatile private var coverKey = ""
    private var coverTry = 0L

    /** prev / toggle / next -> BT module cmd (C_BTAV_PREV 0, C_BTAV_NEXT 1, C_BTAV_PLAYPAUSE 2) */
    override fun media(action: String): Boolean {
        val mod = modules[BT] ?: return false
        if (action != "answer" && action != "hangup") ensureBtAudio()
        val c = when (action) { "prev" -> 0; "next" -> 1; "answer" -> 9; "hangup" -> 10; else -> 2 }   // C_PICKUP 9, C_HANG 10
        call(mod, 1) { it.writeInt(c); it.writeIntArray(null); it.writeFloatArray(null); it.writeStringArray(null) }
        Log.i(TAG, "bt cmd $action ($c)")
        return true
    }

    // decoder reports: position = 0x40, dipped = 0x60 (both), main beam = 0x20 alone (observed)
    private fun lights(out: JSONObject) {
        // confirmed by the user (engine off and on): 0x40 = headlights (dipped), 0x20 = main beam; position lights are not reported
        out.put("position", pos || low); out.put("lowbeam", pos); out.put("highbeam", low)
        out.put("illumination", pos || low)  // theme: night as soon as the headlights are on; position lights / off = day
    }

    private fun getModule(toolkit: IBinder, module: Int): IBinder? {
        val d = Parcel.obtain(); val r = Parcel.obtain()
        return try {
            d.writeInterfaceToken(TK_DESC); d.writeInt(module)
            toolkit.transact(1, d, r, 0); r.readException(); r.readStrongBinder()
        } catch (e: Exception) { Log.e(TAG, "getRemoteModule($module)", e); null } finally { d.recycle(); r.recycle() }
    }

    private val handler = android.os.Handler(android.os.Looper.getMainLooper())
    private var keepAlive: Runnable? = null
    /** rpm stream stopped while we still believe the engine runs -> engine off (decoder stops sending when it stalls) */
    @Volatile private var rpmAt = 0L
    @Volatile private var lastRpm = 0
    private fun staleRpm() {
        if (lastRpm > 0 && android.os.SystemClock.elapsedRealtime() - rpmAt > 5_000) {
            lastRpm = 0; emit(JSONObject().put("rpm", 0).toString()); Log.i(TAG, "rpm stale -> 0")
        }
    }
    private fun requestInfo(mod: IBinder) = call(mod, 1) { it.writeInt(4); it.writeIntArray(intArrayOf(1, 0)); it.writeFloatArray(null); it.writeStringArray(null) }

    private fun register(mod: IBinder, cb: Binder, code: Int) = call(mod, 3) { it.writeStrongBinder(cb); it.writeInt(code); it.writeInt(1) }
    private fun unregister(mod: IBinder, cb: Binder, code: Int) = call(mod, 4) { it.writeStrongBinder(cb); it.writeInt(code) }
    private fun call(mod: IBinder, tx: Int, fill: (Parcel) -> Unit) {
        val d = Parcel.obtain(); val r = Parcel.obtain()
        try { d.writeInterfaceToken(MOD_DESC); fill(d); mod.transact(tx, d, r, 0); r.readException() }
        catch (e: Exception) { Log.w(TAG, "tx $tx failed: ${e.message}") } finally { d.recycle(); r.recycle() }
    }

    companion object {
        const val TAG = "W204SYU"
        const val TK_DESC = "com.syu.ipc.IRemoteToolkit"
        const val MOD_DESC = "com.syu.ipc.IRemoteModule"
        const val CB_DESC = "com.syu.ipc.IModuleCallback"
        const val MAIN = 0; const val CANBUS = 7; const val BT = 2
        /** reverse gear engaged (read by AutoStartService: never cover the reverse camera) */
        @Volatile var reverseNow = false
        val KNOWN = mapOf(CANBUS to listOf(0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 13, 14, 16, 17, 18), MAIN to listOf(0, 4), BT to listOf(0, 1, 2, 7, 8, 9, 12, 13, 26, 28, 34))
    }
}
