// W204 Home (Mercedes C-Class W204 Android head unit) — Android media-session watcher (fallback music metadata when the FYT Bluetooth module is not used).
package fr.w204.home

import android.content.ComponentName
import android.content.Context
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.service.notification.NotificationListenerService
import android.util.Log
import org.json.JSONObject

/** Needed only so the system lets us read media sessions (granted once via adb, see AndroidManifest). */
class MediaListener : NotificationListenerService()

/** Follows the active media session (Spotify, unit's player…) and pushes {title, artist, playing} to the page. */
class MediaWatcher(private val ctx: Context, private val emit: (String) -> Unit) {
    private val msm = ctx.getSystemService(Context.MEDIA_SESSION_SERVICE) as MediaSessionManager
    private val listenerName = ComponentName(ctx, MediaListener::class.java)
    private var controller: MediaController? = null

    private val cb = object : MediaController.Callback() {
        override fun onMetadataChanged(metadata: MediaMetadata?) = push()
        override fun onPlaybackStateChanged(state: PlaybackState?) = push()
    }
    private val sessions = MediaSessionManager.OnActiveSessionsChangedListener { list -> attach(list?.firstOrNull()) }

    fun start() {
        try {
            msm.addOnActiveSessionsChangedListener(sessions, listenerName)
            attach(msm.getActiveSessions(listenerName).firstOrNull())
        } catch (e: SecurityException) {
            Log.w(MainActivity.TAG, "media: notification access not granted (adb shell cmd notification allow_listener ${listenerName.flattenToString()})")
        }
    }
    fun stop() { controller?.unregisterCallback(cb); try { msm.removeOnActiveSessionsChangedListener(sessions) } catch (_: Exception) {} }

    private fun attach(c: MediaController?) {
        controller?.unregisterCallback(cb); controller = c; c?.registerCallback(cb); push()
    }
    private fun push() {
        val c = controller ?: return
        val md = c.metadata
        val o = JSONObject()
            .put("title", md?.getString(MediaMetadata.METADATA_KEY_TITLE) ?: "")
            .put("artist", md?.getString(MediaMetadata.METADATA_KEY_ARTIST) ?: "")
            .put("playing", c.playbackState?.state == PlaybackState.STATE_PLAYING)
        emit(o.toString())
    }
}
