package com.philippo237.labosurf.tv

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.os.StatFs
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

/**
 * Telechargements individuels : le fichier va directement de la source autorisee au stockage prive de l'application,
 * sur le telephone de l'utilisateur. Rien ne transite par le serveur LABOSURF, qui ne fournit que l'autorisation.
 */
object TvDownloads {
    private const val PREFS = "labosurf_tv_downloads"
    private const val KEY_ITEMS = "items"
    private const val SPACE_MARGIN_BYTES = 50L * 1024 * 1024

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private fun manager(context: Context) = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
    private fun folder(context: Context): File = File(context.getExternalFilesDir(Environment.DIRECTORY_MOVIES) ?: context.filesDir, "tv").also { it.mkdirs() }

    private fun read(context: Context): JSONObject = try { JSONObject(prefs(context).getString(KEY_ITEMS, "{}") ?: "{}") } catch (e: Exception) { JSONObject() }
    private fun write(context: Context, items: JSONObject) { prefs(context).edit().putString(KEY_ITEMS, items.toString()).apply() }

    private fun freeBytes(context: Context): Long = StatFs(folder(context).path).availableBytes

    /** Renvoie « started », « no_space », ou le code de refus. */
    fun start(context: Context, ticket: String, lang: String): String {
        val play = try { TvApi.redeem(ticket, lang) } catch (e: TvApi.Denied) { return e.code } catch (e: Exception) { return "network" }
        val url = play.optString("url")
        if (play.optString("mode") != "download" || !TvApi.isHttps(url)) return "unavailable"
        val size = play.optLong("file_size", 0L)
        if (size > 0 && size + SPACE_MARGIN_BYTES > freeBytes(context)) return "no_space"

        val id = UUID.randomUUID().toString()
        val name = "$id.mp4"
        val title = play.optString("title")
        val episode = play.optString("episode_title")
        val request = DownloadManager.Request(Uri.parse(url))
            .setTitle(if (episode.isBlank()) title else "$title · $episode")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
            .setAllowedOverMetered(true)
            .setDestinationInExternalFilesDir(context, Environment.DIRECTORY_MOVIES, "tv/$name")
        val managerId = try { manager(context).enqueue(request) } catch (e: Exception) { return "failed" }

        val items = read(context)
        items.put(id, JSONObject().put("id", id).put("manager_id", managerId).put("file", name).put("title", title).put("episode", episode)
            .put("title_id", play.optLong("title_id")).put("episode_id", play.optLong("episode_id")).put("size", size)
            .put("expires_at", play.optString("expires_at")).put("kid", play.optBoolean("kid")).put("position_sec", 0L))
        write(context, items)
        return "started"
    }

    fun list(context: Context): String {
        val items = read(context)
        val out = JSONArray()
        items.keys().forEach { key ->
            val item = items.getJSONObject(key)
            val state = query(context, item)
            out.put(JSONObject().put("id", key).put("title", item.optString("title")).put("episode", item.optString("episode"))
                .put("status", state.status).put("downloaded", state.downloaded).put("size", maxOf(state.total, item.optLong("size")))
                .put("expired", isExpired(item)).put("kid", item.optBoolean("kid")))
        }
        return out.toString()
    }

    fun storage(context: Context): String = JSONObject().put("free", freeBytes(context)).toString()

    fun delete(context: Context, id: String) {
        val items = read(context)
        val item = items.optJSONObject(id) ?: return
        try { manager(context).remove(item.optLong("manager_id")) } catch (e: Exception) { }
        fileOf(context, item).delete()
        items.remove(id)
        write(context, items)
    }

    fun isPlayable(context: Context, id: String): Boolean {
        val item = read(context).optJSONObject(id) ?: return false
        return !isExpired(item) && query(context, item).status == "done" && fileOf(context, item).isFile
    }

    fun item(context: Context, id: String): JSONObject? = read(context).optJSONObject(id)

    fun fileOf(context: Context, item: JSONObject): File = File(folder(context), item.optString("file"))

    fun savePosition(context: Context, id: String, position: Long) {
        val items = read(context)
        val item = items.optJSONObject(id) ?: return
        item.put("position_sec", position)
        write(context, items)
    }

    /** Fin de licence lue sur le telephone : hors connexion, c'est la derniere date transmise par le panel qui s'applique. */
    private fun isExpired(item: JSONObject): Boolean {
        val end = item.optString("expires_at")
        if (end.isBlank()) return false
        return SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date()) > end
    }

    private class State(val status: String, val downloaded: Long, val total: Long)

    private fun query(context: Context, item: JSONObject): State {
        val file = fileOf(context, item)
        try {
            manager(context).query(DownloadManager.Query().setFilterById(item.optLong("manager_id"))).use { cursor ->
                if (cursor != null && cursor.moveToFirst()) {
                    val status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                    val done = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
                    val total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
                    val label = when (status) {
                        DownloadManager.STATUS_SUCCESSFUL -> "done"
                        DownloadManager.STATUS_RUNNING -> "running"
                        DownloadManager.STATUS_PAUSED -> "paused"
                        DownloadManager.STATUS_PENDING -> "pending"
                        else -> "failed"
                    }
                    return State(label, done, maxOf(total, 0L))
                }
            }
        } catch (e: Exception) { }
        // Android a oublie la demande : seul le fichier present fait foi
        return if (file.isFile && file.length() > 0) State("done", file.length(), file.length()) else State("failed", 0L, 0L)
    }
}
