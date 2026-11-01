package com.philippo237.labosurf.tv

import com.philippo237.labosurf.BuildConfig
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Seule porte du natif vers LABOSURF TV : le ticket est echange aupres du panel configure dans l'APK, jamais ailleurs. */
object TvApi {
    class Denied(val code: String) : Exception(code)

    fun redeem(ticket: String, lang: String): JSONObject {
        val connection = URL(BuildConfig.PANEL_BASE_URL.trimEnd('/') + "/api/tv/play/redeem").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.connectTimeout = 15000
            connection.readTimeout = 15000
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(JSONObject().put("ticket", ticket).put("lang", lang).toString().toByteArray()) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val body = JSONObject(stream?.bufferedReader()?.use { it.readText() } ?: "{}")
            if (status !in 200..299) throw Denied(body.optString("code", "denied"))
            return body.getJSONObject("play")
        } finally {
            connection.disconnect()
        }
    }

    fun isHttps(url: String): Boolean = url.startsWith("https://", ignoreCase = true) && url.length > "https://".length
}

/** Evenements du lecteur vers l'interface : meme principe que LaboVpnService.statsListener, sans aucun lien avec le tunnel. */
object TvEvents {
    @Volatile var progressListener: ((Long, Long, Long, Long) -> Unit)? = null
}
