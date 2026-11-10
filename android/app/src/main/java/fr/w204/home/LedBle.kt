// W204 Home (Mercedes C-Class W204 Android head unit) — Native BLE control of aftermarket interior LED strips (LED LAMP app controllers: LEDBLE / LEDCAR families).
package fr.w204.home

import android.bluetooth.*
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.util.ArrayDeque
import java.util.UUID

/**
 * Native control of the interior LED controller (the one the LED LAMP app drives), over BLE, no cloud.
 * Protocol read from LED LAMP 4.3.7 (NetConnectBle, "LEDBLE" family), 9-byte frames 7E … EF written to FFE1 (service FFE0):
 *   on  7E FF 04 01 00 FF FF 00 EF   off 7E FF 04 00 00 FF FF 00 EF
 *   rgb 7E FF 05 03 R G B FF EF      brightness 7E FF 01 <0-100> 00 FF FF FF EF
 * The controller accepts one BLE connection: LED LAMP (unit or phone) must not be connected at the same time.
 */
class LedBle(private val ctx: Context, private val report: (String) -> Unit) {
    private val main = Handler(Looper.getMainLooper())
    private val prefs = ctx.getSharedPreferences("w204", Context.MODE_PRIVATE)
    private val adapter: BluetoothAdapter? get() = (ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
    private var gatt: BluetoothGatt? = null
    private var chr: BluetoothGattCharacteristic? = null
    private var state = "idle"                       // idle | scanning | connecting | connected | error
    private var devName = prefs.getString("led_name", null)
    private val found = linkedMapOf<String, String>() // address -> name
    private val queue = ArrayDeque<ByteArray>()
    private var writing = false
    private var scanning = false
    private val seen = HashSet<String>()

    fun handle(ev: JSONObject) {
        when (ev.optString("action")) {
            "release" -> { released = true; queue.clear(); gatt?.disconnect(); gatt?.close(); gatt = null; chr = null; state = "idle"; emit() }  // hand the LEDs to LED LAMP
            "connect" -> connectEv(ev)
            "scan" -> scan()
            "on" -> send(if (car) car(0xFF, 0x04, 0x01, 0xFF, 0xFF, 0xFF, 0xFF) else frame(0x04, 0x01, 0x00, 0xFF, 0xFF, 0x00))
            "off" -> send(if (car) car(0xFF, 0x04, 0x00, 0xFF, 0xFF, 0xFF, 0xFF) else frame(0x04, 0x00, 0x00, 0xFF, 0xFF, 0x00))
            "rgb" -> { val r = ev.optInt("r"); val g = ev.optInt("g"); val b = ev.optInt("b")
                send(if (car) car(0x00, 0x07, r, g, b, 0x00, 0xFF) else frame(0x05, 0x03, r, g, b, 0xFF)) }
            "bright" -> { val v = ev.optInt("v").coerceIn(0, 100)
                send(if (car) car(0xFF, 0x01, v * 32 / 100, v, 0x00, 0xFF, 0xFF) else frame(0x01, v, 0x00, 0xFF, 0xFF, 0xFF)) }
            "status" -> emit()
        }
    }

    /** LEDCAR-01/02 controllers (e.g. LEDCAR-01-xxxx) use 7B … BF frames (NetConnectBle car branches). */
    private val car get() = devName?.contains("LEDCAR", true) == true
    private fun car(vararg b: Int) = byteArrayOf(0x7B, *b.map { it.toByte() }.toByteArray(), 0xBF.toByte())
    private fun frame(vararg b: Int) = byteArrayOf(0x7E, 0xFF.toByte(), *b.map { it.toByte() }.toByteArray(), 0xEF.toByte())

    private var released = false
    private fun connectEv(ev: JSONObject) { released = false; ev.optString("address").ifEmpty { null }?.let { choose(it, found[it] ?: ev.optString("name")) } ?: connect(null) }

    private fun send(f: ByteArray) {
        if (released) return
        if (state != "connected") { queue.clear(); queue.add(f); connect(null); return }
        if (queue.size > 4) queue.removeFirst()          // colour wheel drags: keep only the latest frames
        queue.add(f); pump()
    }

    private fun pump() {
        val c = chr ?: return; val g = gatt ?: return
        if (writing || queue.isEmpty()) return
        writing = true
        c.value = queue.removeFirst()
        Log.i(TAG, "tx ${c.value.joinToString(" ") { "%02x".format(it) }}")
        c.writeType = if (c.properties and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE != 0)
            BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE else BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        if (!g.writeCharacteristic(c)) writing = false
        main.postDelayed({ writing = false; pump() }, 40)   // no-response writes: pace them ourselves
    }

    /** Saved controller, else scan and take the first LED-type name. */
    private fun connect(address: String?) {
        if (state == "connecting" || state == "connected") return
        val a = adapter ?: return fail("Bluetooth indisponible")
        val addr = address ?: prefs.getString("led_addr", null)
        if (addr == null) { scan(autoConnect = true); return }
        state = "connecting"; emit()
        gatt?.close()
        gatt = a.getRemoteDevice(addr).connectGatt(ctx, false, cb, BluetoothDevice.TRANSPORT_LE)
        main.postDelayed({ if (state == "connecting") { gatt?.close(); gatt = null; fail("LED introuvables : sont-elles connectées au téléphone ?") } }, 12_000)
    }

    private fun scan(autoConnect: Boolean = false) {
        val s = adapter?.bluetoothLeScanner ?: return fail("Bluetooth indisponible")
        if (scanning) return
        found.clear(); seen.clear(); scanning = true; state = "scanning"; emit()
        val scb = object : ScanCallback() {
            override fun onScanResult(type: Int, r: ScanResult) {
                val rec = r.scanRecord
                val n = rec?.deviceName ?: r.device.name ?: ""
                val uuids = rec?.serviceUuids?.map { it.uuid.toString().substring(4, 8) } ?: emptyList()
                if (seen.add(r.device.address)) Log.i(TAG, "seen '$n' ${r.device.address} ${r.rssi} dBm uuids=$uuids raw=${rec?.bytes?.take(31)?.joinToString("") { "%02x".format(it) }}")
                val isLed = LED_NAME.containsMatchIn(n) || uuids.any { it in LED_UUIDS }
                if (!isLed || found.containsKey(r.device.address)) return
                val label = n.takeIf { it.isNotBlank() && it != "noName" } ?: "LED ${r.device.address.takeLast(5)}"
                found[r.device.address] = label; Log.i(TAG, "found $label ${r.device.address}"); emit(); return
            }
        }
        s.startScan(null, ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), scb)
        main.postDelayed({
            runCatching { s.stopScan(scb) }; scanning = false
            val first = found.entries.firstOrNull { it.value.contains("LEDBLE", true) } ?: found.entries.firstOrNull()
            if (first == null) { fail("Aucune LED trouvée : ferme LED LAMP sur le téléphone puis réessaie"); return@postDelayed }
            state = "idle"
            if (autoConnect || found.size == 1) choose(first.key, first.value) else emit()
        }, 6000)
    }

    private fun choose(addr: String, name: String) {
        prefs.edit().putString("led_addr", addr).putString("led_name", name).apply(); devName = name
        connect(addr)
    }

    private val cb = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) = main.post {
            if (newState == BluetoothProfile.STATE_CONNECTED) g.discoverServices()
            else { chr = null; writing = false; if (state != "error") { state = "idle"; emit() }; g.close(); if (gatt === g) gatt = null }
        }.let {}
        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) = main.post {
            val all = g.services.flatMap { it.characteristics }
            val writable = all.filter { it.properties and (BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0 }
            chr = PREFERRED.firstNotNullOfOrNull { u -> writable.firstOrNull { it.uuid == u } } ?: writable.firstOrNull()
            Log.i(TAG, "services: ${all.map { it.uuid.toString().substring(4, 8) }} -> ${chr?.uuid}")
            if (chr == null) { fail("Contrôleur non compatible"); g.disconnect(); return@post }
            state = "connected"; emit(); pump()
        }.let {}
    }

    private fun fail(msg: String) { state = "error"; Log.w(TAG, msg); emit(msg); main.postDelayed({ if (state == "error") { state = "idle"; emit() } }, 6000) }

    private fun emit(msg: String? = null) {
        val o = JSONObject().put("state", state).put("name", devName ?: "")
        if (msg != null) o.put("msg", msg)
        o.put("found", JSONArray().apply { found.forEach { (a, n) -> put(JSONObject().put("address", a).put("name", n)) } })
        report(o.toString())
    }

    fun stop() { gatt?.close(); gatt = null }

    companion object {
        const val TAG = "W204Led"
        val LED_UUIDS = setOf("ffe0", "fff0", "ffd5", "ffb0")
        val LED_NAME = Regex("LED|ELK|MELK|BLEDOM|QHM|Triones", RegexOption.IGNORE_CASE)
        val PREFERRED = listOf("ffe1", "fff3", "ffd9").map { UUID.fromString("0000$it-0000-1000-8000-00805f9b34fb") }
    }
}
