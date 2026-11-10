// W204 Home (Mercedes C-Class W204 Android head unit) — Auto start: brings the W204 home screen to the front when the head unit boots or wakes (screen on = ACC on); forces Wi-Fi on.
package fr.w204.home

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log

/**
 * Brings the W204 screen to the front when the head unit wakes up (ACC on = screen on) or boots.
 * The FYT unit mostly sleeps instead of rebooting, so SCREEN_ON (dynamic receiver only) is the main trigger.
 * Starting an activity from the background needs the SYSTEM_ALERT_WINDOW app-op (granted once via adb).
 */
class AutoStartService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private val screenOn = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) { Log.i(TAG, "screen on"); wifiOn(c); bringToFront(1500) }
    }

    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("auto", "Démarrage auto", NotificationManager.IMPORTANCE_MIN))
        startForeground(1, Notification.Builder(this, "auto").setSmallIcon(android.R.drawable.ic_menu_compass)
            .setContentTitle("W204").setContentText("Lancement automatique actif").build())
        registerReceiver(screenOn, IntentFilter(Intent.ACTION_SCREEN_ON))
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        wifiOn(this)
        if (intent?.getBooleanExtra("launch", false) == true) bringToFront(4000)
        return START_STICKY
    }
    private fun bringToFront(delay: Long, tries: Int = 0) {
        handler.removeCallbacksAndMessages(null)
        if (SyuSource.reverseNow) {                     // reverse camera on screen: wait until reverse is released (max 2 min)
            if (tries < 120) handler.postDelayed({ bringToFront(delay, tries + 1) }, 1000)
            Log.i(TAG, "reverse engaged: auto start postponed"); return
        }
        // after the stock wake-up sequence (launcher / last app) so we end up on top
        handler.postDelayed({ startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)) }, delay)
        handler.postDelayed({ startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)) }, delay + 3000)
    }
    override fun onDestroy() { runCatching { unregisterReceiver(screenOn) }; super.onDestroy() }
    override fun onBind(i: Intent?): IBinder? = null

    companion object {
        const val TAG = "W204Auto"
        /** something on the unit sometimes leaves Wi-Fi off: force it on so the phone hotspot connects (targetSdk 28 allows it) */
        @Suppress("DEPRECATION")
        fun wifiOn(c: Context) {
            val wm = c.applicationContext.getSystemService(Context.WIFI_SERVICE) as android.net.wifi.WifiManager
            if (!wm.isWifiEnabled) Log.i(TAG, "wifi was off -> on: ${wm.setWifiEnabled(true)}")
        }
        fun start(c: Context, launch: Boolean = false) =
            c.startForegroundService(Intent(c, AutoStartService::class.java).putExtra("launch", launch))
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) { Log.i(AutoStartService.TAG, "boot: ${i.action}"); AutoStartService.start(c, launch = true) }
}
