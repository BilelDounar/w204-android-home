// W204 Home (Mercedes C-Class W204 Android head unit) — Full-screen WebView host of the home screen (web/app) + JS bridge, split view (Waze), rotary knob keys.
package fr.w204.home

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioManager
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject

/**
 * Home screen: a full-screen WebView running the 3D scene (web/app), fed by a [VehicleSource].
 * Data source = CAN decoder box + MCU of the unit only (never OBD, see docs/donnees-decodeur.md).
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private var source: VehicleSource? = null
    private var media: MediaWatcher? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (getSharedPreferences("w204", Context.MODE_PRIVATE).getInt("ver", 0) != BuildConfig.VERSION_CODE) {
            WebView(this).clearCache(true); getSharedPreferences("w204", Context.MODE_PRIVATE).edit().putInt("ver", BuildConfig.VERSION_CODE).apply()
        }
        AutoStartService.start(this)
        AutoStartService.wifiOn(this)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        immersive()

        // pages served from the APK as https://appassets.androidplatform.net/assets/web/… (fetch + modules work, no file://)
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.cacheMode = android.webkit.WebSettings.LOAD_NO_CACHE   // local assets: never serve an old app.js / 3D model after an update
            settings.mediaPlaybackRequiresUserGesture = false
            setBackgroundColor(0xFF030405.toInt())     // same darkness as the intro
            addJavascriptInterface(Bridge(), "W204Native")
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    loader.shouldInterceptRequest(request.url)
            }
        }
        WebView.setWebContentsDebuggingEnabled(true)     // chrome://inspect from the Mac over USB
        applyExtras(intent)
        setContentView(web)
        web.loadUrl("https://appassets.androidplatform.net/assets/web/index.html")
    }

    /** Settings via adb, no rebuild needed:
     *  adb shell am start -n fr.w204.home/.MainActivity --es source demo|idle --es launcher <pkg>/<activity> */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (applyExtras(intent)) recreate()
    }
    private fun applyExtras(i: Intent?): Boolean {
        val e = getSharedPreferences("w204", Context.MODE_PRIVATE).edit(); var changed = false
        i?.getStringExtra("source")?.let { e.putString("source", it); changed = true }
        i?.getStringExtra("launcher")?.let { e.putString("launcher", it); changed = true }
        e.apply(); return changed
    }

    override fun onResume() { super.onResume(); immersive(); web.onResume() }
    override fun onPause() { web.onPause(); super.onPause() }
    override fun onDestroy() { source?.stop(); media?.stop(); web.destroy(); super.onDestroy() }

    private fun immersive() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN)
    }

    /** Push a JS call to the page (UI thread). */
    fun js(call: String) = runOnUiThread { web.evaluateJavascript(call, null) }

    private fun onPageReady() {
        // vehicle data: pick the source found during discovery (adb/discover.sh, adb/can_capture.sh)
        source = VehicleSource.create(this, { raw -> js("w204.update($raw)") }, { m -> js("w204.media($m)") }).also { it.start() }
        media = MediaWatcher(this) { m -> js("w204.media($m)") }.also { it.start() }
    }

    private val main = android.os.Handler(android.os.Looper.getMainLooper())

    /* ---- rotary knob / steering keys: logged (tag W204Key) to map the car's own codes, standard ones handled ---- */
    override fun dispatchKeyEvent(e: android.view.KeyEvent): Boolean {
        if (e.action == android.view.KeyEvent.ACTION_DOWN) Log.i("W204Key", "key ${e.keyCode} ${android.view.KeyEvent.keyCodeToString(e.keyCode)} scan=${e.scanCode} src=${e.source}")
        val k = when (e.keyCode) {
            android.view.KeyEvent.KEYCODE_DPAD_RIGHT, android.view.KeyEvent.KEYCODE_DPAD_DOWN, android.view.KeyEvent.KEYCODE_TAB -> "next"
            android.view.KeyEvent.KEYCODE_DPAD_LEFT, android.view.KeyEvent.KEYCODE_DPAD_UP -> "prev"
            android.view.KeyEvent.KEYCODE_DPAD_CENTER, android.view.KeyEvent.KEYCODE_ENTER, android.view.KeyEvent.KEYCODE_NUMPAD_ENTER -> "ok"
            android.view.KeyEvent.KEYCODE_MEDIA_NEXT -> "track_next"
            android.view.KeyEvent.KEYCODE_MEDIA_PREVIOUS -> "track_prev"
            else -> null
        } ?: return super.dispatchKeyEvent(e)
        if (e.action == android.view.KeyEvent.ACTION_DOWN) when (k) {
            "track_next" -> source?.media("next")
            "track_prev" -> source?.media("prev")
            else -> js("w204.key('$k')")
        }
        return true
    }
    override fun dispatchGenericMotionEvent(e: android.view.MotionEvent): Boolean {
        val v = e.getAxisValue(android.view.MotionEvent.AXIS_SCROLL)      // rotary encoders often arrive as scroll
        if (v != 0f) { Log.i("W204Key", "scroll $v src=${e.source}"); js("w204.key('${if (v < 0) "next" else "prev"}')"); return true }
        return super.dispatchGenericMotionEvent(e)
    }
    private val led by lazy { LedBle(this) { s -> js("w204.led($s)") } }

    /** Called from JS: window.W204Native.onEvent(json) */
    inner class Bridge {
        @JavascriptInterface
        fun onEvent(json: String) {
            val ev = try { JSONObject(json) } catch (e: Exception) { return }
            Log.i(TAG, "event $json")
            runOnUiThread {
                when (ev.optString("type")) {
                    "ready" -> onPageReady()
                    "openLauncher" -> openStockLauncher()
                    "openApp" -> openApp(ev.optString("pkg"))
                    "openSplit" -> openSplit(ev.optString("pkg"))
                    "closeSplit" -> closeSplit()
                    "led" -> led.handle(ev)
                    "dim" -> window.attributes = window.attributes.apply {        // night: dim the screen while our app is in front
                        screenBrightness = if (ev.optBoolean("on")) ev.optDouble("level", 0.35).toFloat() else android.view.WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE }
                    "media" -> if (source?.media(ev.optString("action")) != true) mediaKey(ev.optString("action"))
                    "openVehicle" -> Toast.makeText(this@MainActivity, "Onglet Véhicule : à venir", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    /** 3×3 button: the stock (Mercedes-style) launcher with all the apps. Our app is never HOME. */
    private fun openStockLauncher() {
        val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        val launchers = packageManager.queryIntentActivities(home, PackageManager.MATCH_DEFAULT_ONLY)
            .map { it.activityInfo }.filter { it.packageName != packageName }
        // preference saved after discovery (adb shell am start … --es launcher pkg/cls), else the system default, else the first one
        val pref = getSharedPreferences("w204", Context.MODE_PRIVATE).getString("launcher", null)
        val def = packageManager.resolveActivity(home, PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo
        val target = launchers.firstOrNull { "${it.packageName}/${it.name}" == pref }
            ?: def?.takeIf { it.packageName != packageName && it.packageName != "android" }
            ?: launchers.firstOrNull()
        if (target == null) { Toast.makeText(this, "Launcher d'origine introuvable", Toast.LENGTH_SHORT).show(); return }
        startActivity(Intent(home).setComponent(ComponentName(target.packageName, target.name)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /**
     * Split view: our app on the left (primary), [pkg] (Waze) on the right.
     * Already in split -> launch adjacent. Otherwise move ourselves to the split-primary stack first
     * (ActivityOptions.setLaunchWindowingMode, hidden API, may be refused), then launch adjacent; fallback = full screen.
     */
    private fun openSplit(pkg: String) {
        val target = packageManager.getLaunchIntentForPackage(pkg)?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) ?: return openApp(pkg)
        val acc = SplitAccess.instance
        if (acc == null) { Log.w(TAG, "split helper not enabled -> full screen"); startActivity(target); return }
        val self = Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_LAUNCH_ADJACENT)
        if (isInMultiWindowMode) { startActivity(target); return }
        // Waze on the left (driver side), our app on the right. This ROM locks the divider at 1/2 (drag refused, even over adb).
        startActivity(target)                                              // 1. Waze in front (its existing task)
        main.postDelayed({ Log.i(TAG, "split: toggle ${acc.toggleSplit()}") }, 1500)                        // 2. Waze -> primary (left), recents on the right
        main.postDelayed({ Log.i(TAG, "split: self"); startActivity(self) }, 2800)                     // 3. our app -> secondary (right)
    }
    /** back to full screen: toggling split again keeps the primary (our app) */
    private fun closeSplit() {
        if (!isInMultiWindowMode) return
        SplitAccess.instance?.toggleSplit()                                // ends split (Waze stays full screen)...
        main.postDelayed({ startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)) }, 700)  // ...then us in front
    }

    /** Open an installed app (e.g. com.ledlamp); if missing, its Play Store page. */
    private fun openApp(pkg: String) {
        val i = packageManager.getLaunchIntentForPackage(pkg)
        if (i != null) { startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return }
        try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$pkg")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        catch (e: Exception) { Toast.makeText(this, "$pkg n'est pas installée", Toast.LENGTH_SHORT).show() }
    }

    private fun mediaKey(action: String) {
        val code = when (action) {
            "prev" -> KeyEvent.KEYCODE_MEDIA_PREVIOUS
            "next" -> KeyEvent.KEYCODE_MEDIA_NEXT
            else -> KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
        }
        val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val t = SystemClock.uptimeMillis()
        am.dispatchMediaKeyEvent(KeyEvent(t, t, KeyEvent.ACTION_DOWN, code, 0))
        am.dispatchMediaKeyEvent(KeyEvent(t, t, KeyEvent.ACTION_UP, code, 0))
    }

    companion object { const val TAG = "W204" }
}
