// W204 Home (Mercedes C-Class W204 Android head unit) — Vehicle speed fallback from the head unit GPS (filters standstill jitter).
package fr.w204.home

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Looper
import android.util.Log

/** Vehicle speed from the unit's own GPS (the decoder sends no reliable speed on this car). Permission granted via adb. */
class GpsSpeed(private val ctx: Context, private val emit: (Int) -> Unit) : LocationListener {
    private val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    private var last = -1
    @SuppressLint("MissingPermission")
    fun start() {
        try { lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 500L, 0f, this, Looper.getMainLooper()) }
        catch (e: Exception) { Log.w("W204SYU", "gps: ${e.message}") }
    }
    fun stop() { try { lm.removeUpdates(this) } catch (_: Exception) {} }
    override fun onLocationChanged(loc: Location) {
        val kmh = if (loc.hasSpeed()) Math.round(loc.speed * 3.6f) else 0
        // GPS jitter at standstill (weak signal, parking): drop low speeds the receiver itself is unsure about
        val unsure = android.os.Build.VERSION.SDK_INT >= 26 && loc.hasSpeedAccuracy() && loc.speedAccuracyMetersPerSecond * 3.6f >= kmh
        val v = if (kmh < 3 || (kmh < 8 && (unsure || loc.accuracy > 25f))) 0 else kmh
        if (v != last) { last = v; emit(v) }
    }
    @Deprecated("") override fun onStatusChanged(p: String?, s: Int, e: Bundle?) {}
    override fun onProviderEnabled(p: String) {}
    override fun onProviderDisabled(p: String) {}
}
