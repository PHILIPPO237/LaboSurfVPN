package com.philippo237.labosurf.tv

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.Button
import android.widget.ProgressBar
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.philippo237.labosurf.R
import org.json.JSONObject
import java.io.File

/**
 * Lecteur natif de LABOSURF TV. Il ne recoit qu'un ticket du panel, ou l'identifiant d'un fichier deja telecharge.
 * Les boutons de pistes du lecteur ne montrent que ce que la video contient reellement. Aucun lien avec le tunnel VPN.
 */
@OptIn(UnstableApi::class)
class TvPlayerActivity : AppCompatActivity() {

    companion object {
        private const val EXTRA_TICKET = "ticket"
        private const val EXTRA_OFFLINE = "offline"
        private const val EXTRA_LANG = "lang"
        private const val EXTRA_AUDIO = "audio"
        private const val EXTRA_SUBTITLES = "subtitles"
        private const val SAVE_EVERY_MS = 15000L

        fun streamIntent(context: Context, ticket: String, lang: String, audio: String, subtitles: String) =
            Intent(context, TvPlayerActivity::class.java).putExtra(EXTRA_TICKET, ticket).putExtra(EXTRA_LANG, lang).putExtra(EXTRA_AUDIO, audio).putExtra(EXTRA_SUBTITLES, subtitles)

        fun offlineIntent(context: Context, id: String, audio: String, subtitles: String) =
            Intent(context, TvPlayerActivity::class.java).putExtra(EXTRA_OFFLINE, id).putExtra(EXTRA_AUDIO, audio).putExtra(EXTRA_SUBTITLES, subtitles)
    }

    private var player: ExoPlayer? = null
    private lateinit var playerView: PlayerView
    private lateinit var errorBox: View
    private lateinit var errorText: TextView
    private lateinit var nextButton: Button
    private lateinit var loading: ProgressBar
    private val handler = Handler(Looper.getMainLooper())

    private var ticket = ""
    private var offlineId = ""
    private var nextTicket = ""
    private var titleId = 0L
    private var episodeId = 0L
    private var pendingSeekSec = 0L

    private val saver = object : Runnable {
        override fun run() {
            saveProgress()
            handler.postDelayed(this, SAVE_EVERY_MS)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_tv_player)
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        playerView = findViewById(R.id.tvPlayerView)
        errorBox = findViewById(R.id.tvPlayerError)
        errorText = findViewById(R.id.tvPlayerErrorText)
        nextButton = findViewById(R.id.tvPlayerNext)
        loading = findViewById(R.id.tvPlayerLoading)
        findViewById<Button>(R.id.tvPlayerRetry).setOnClickListener { load() }
        nextButton.setOnClickListener { playNext() }

        ticket = intent.getStringExtra(EXTRA_TICKET).orEmpty()
        offlineId = intent.getStringExtra(EXTRA_OFFLINE).orEmpty()
        load()
    }

    private fun load() {
        errorBox.visibility = View.GONE
        loading.visibility = View.VISIBLE
        if (offlineId.isNotEmpty()) {
            loadOffline()
            return
        }
        Thread {
            val lang = intent.getStringExtra(EXTRA_LANG).orEmpty()
            val play = try { TvApi.redeem(ticket, lang) } catch (e: Exception) { null }
            runOnUiThread { if (!isFinishing) { if (play == null) showError(getString(R.string.tv_error_authorize)) else startStream(play) } }
        }.start()
    }

    private fun startStream(play: JSONObject) {
        val url = play.optString("url")
        if (play.optString("kind") == "youtube" || !TvApi.isHttps(url)) {
            showError(getString(R.string.tv_error_authorize))
            return
        }
        titleId = play.optLong("title_id")
        episodeId = play.optLong("episode_id")
        pendingSeekSec = play.optLong("position_sec", 0L)
        nextTicket = play.optString("next_ticket")
        nextButton.visibility = if (nextTicket.isEmpty()) View.GONE else View.VISIBLE

        val builder = MediaItem.Builder().setUri(Uri.parse(url))
        if (play.optString("kind") == "hls") builder.setMimeType(MimeTypes.APPLICATION_M3U8)
        val subtitles = play.optJSONArray("subtitles")
        if (subtitles != null) {
            val configs = ArrayList<MediaItem.SubtitleConfiguration>()
            for (i in 0 until subtitles.length()) {
                val track = subtitles.getJSONObject(i)
                val address = track.optString("url")
                if (!TvApi.isHttps(address)) continue
                val mime = if (address.substringBefore('?').endsWith(".srt", true)) MimeTypes.APPLICATION_SUBRIP else MimeTypes.TEXT_VTT
                configs.add(MediaItem.SubtitleConfiguration.Builder(Uri.parse(address)).setMimeType(mime).setLanguage(track.optString("lang")).setLabel(track.optString("label")).build())
            }
            builder.setSubtitleConfigurations(configs)
        }
        play(builder.build())
    }

    private fun loadOffline() {
        val item = TvDownloads.item(this, offlineId)
        if (item == null || !TvDownloads.isPlayable(this, offlineId)) {
            showError(getString(R.string.tv_error_authorize))
            return
        }
        val file: File = TvDownloads.fileOf(this, item)
        titleId = item.optLong("title_id")
        episodeId = item.optLong("episode_id")
        pendingSeekSec = item.optLong("position_sec", 0L)
        nextButton.visibility = View.GONE
        play(MediaItem.fromUri(Uri.fromFile(file)))
    }

    private fun play(media: MediaItem) {
        releasePlayer(save = false)
        val audio = intent.getStringExtra(EXTRA_AUDIO).orEmpty()
        val subtitles = intent.getStringExtra(EXTRA_SUBTITLES).orEmpty()
        val exo = ExoPlayer.Builder(this).build()
        val params = exo.trackSelectionParameters.buildUpon()
        if (audio.isNotEmpty()) params.setPreferredAudioLanguage(audio)
        if (subtitles == "off") params.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
        else if (subtitles.isNotEmpty()) params.setPreferredTextLanguage(subtitles)
        exo.trackSelectionParameters = params.build()
        exo.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                loading.visibility = if (state == Player.STATE_BUFFERING) View.VISIBLE else View.GONE
                if (state == Player.STATE_ENDED) {
                    saveProgress()
                    if (nextTicket.isNotEmpty()) playNext() else finish()
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                showError(getString(R.string.tv_error_source))
            }
        })
        playerView.player = exo
        player = exo
        exo.setMediaItem(media)
        exo.prepare()
        if (pendingSeekSec > 0) exo.seekTo(pendingSeekSec * 1000)
        exo.playWhenReady = true
        handler.removeCallbacks(saver)
        handler.postDelayed(saver, SAVE_EVERY_MS)
    }

    private fun playNext() {
        if (nextTicket.isEmpty()) return
        saveProgress()
        ticket = nextTicket
        nextTicket = ""
        load()
    }

    private fun showError(message: String) {
        loading.visibility = View.GONE
        errorText.text = message
        errorBox.visibility = View.VISIBLE
    }

    private fun saveProgress() {
        val exo = player ?: return
        val position = exo.currentPosition / 1000
        val duration = if (exo.duration > 0) exo.duration / 1000 else 0
        if (position <= 0 || titleId == 0L) return
        if (offlineId.isNotEmpty()) TvDownloads.savePosition(this, offlineId, position)
        TvEvents.progressListener?.invoke(titleId, episodeId, position, duration)
    }

    private fun releasePlayer(save: Boolean = true) {
        if (save) saveProgress()
        handler.removeCallbacks(saver)
        playerView.player = null
        player?.release()
        player = null
    }

    override fun onStop() {
        super.onStop()
        saveProgress()
        player?.pause()
    }

    override fun onDestroy() {
        releasePlayer()
        super.onDestroy()
    }
}
