// W204 Home (Mercedes C-Class W204 Android head unit) — Album art for Bluetooth music (the BT chip sends no cover): iTunes Search API lookup + on-disk cache.
package fr.w204.home

import android.content.Context
import android.util.Base64
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import java.util.concurrent.Executors

/**
 * Album art for Bluetooth music: the unit's BT chip (BLINK) only sends title/artist/album text, no AVRCP cover.
 * Looks the track up in the public iTunes Search API (no account, only "artist title" is sent), caches the JPEG
 * on disk (cacheDir/covers) so it shows offline afterwards. Result = data: URL (or "" if none / offline).
 */
class CoverArt(ctx: Context) {
    private val dir = File(ctx.cacheDir, "covers").apply { mkdirs() }
    private val pool = Executors.newSingleThreadExecutor()
    @Volatile private var wanted = ""

    fun request(artist: String, title: String, album: String, done: (String) -> Unit) {
        val key = "$artist|$title"
        if (artist.isBlank() && title.isBlank()) { wanted = ""; done(""); return }
        wanted = key
        pool.execute {
            if (wanted != key) return@execute                       // track changed again meanwhile
            val url = runCatching { load(artist, title, album) }.onFailure { Log.i(TAG, "cover: ${it.message}") }.getOrNull()
            if (wanted == key) done(url ?: "")
        }
    }

    private fun load(artist: String, title: String, album: String): String? {
        val h = MessageDigest.getInstance("MD5").digest("$artist|$album|$title".lowercase().toByteArray()).joinToString("") { "%02x".format(it) }
        val f = File(dir, "$h.jpg"); val miss = File(dir, "$h.none")
        if (f.exists()) return dataUrl(f)
        if (miss.exists() && System.currentTimeMillis() - miss.lastModified() < 7 * 86400_000L) return null
        val q = URLEncoder.encode("$artist $title".trim(), "UTF-8")
        val js = JSONObject(get("https://itunes.apple.com/search?term=$q&entity=song&limit=5&country=FR").toString(Charsets.UTF_8))
        val res = js.optJSONArray("results") ?: return null
        var art: String? = null
        for (i in 0 until res.length()) {                            // prefer the same artist
            val r = res.getJSONObject(i)
            if (art == null || r.optString("artistName").equals(artist, true)) art = r.optString("artworkUrl100").ifEmpty { null } ?: art
            if (r.optString("artistName").equals(artist, true)) break
        }
        if (art == null) { miss.writeText(""); return null }
        f.writeBytes(get(art.replace("100x100bb", "600x600bb")))
        dir.listFiles()?.sortedBy { it.lastModified() }?.dropLast(300)?.forEach { it.delete() }  // keep the cache small
        return dataUrl(f)
    }

    private fun get(u: String): ByteArray {
        val c = URL(u).openConnection() as HttpURLConnection
        c.connectTimeout = 5000; c.readTimeout = 8000
        try { return c.inputStream.use { it.readBytes() } } finally { c.disconnect() }
    }

    private fun dataUrl(f: File) = "data:image/jpeg;base64," + Base64.encodeToString(f.readBytes(), Base64.NO_WRAP)

    companion object { const val TAG = "W204Cover" }
}
