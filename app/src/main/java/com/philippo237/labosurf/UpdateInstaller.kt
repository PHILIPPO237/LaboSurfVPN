package com.philippo237.labosurf

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Mise a jour depuis l'application : telecharge l'APK annonce par le panel dans le cache PRIVE, le verifie, puis confie
 * l'installation a Android (qui demande toujours la confirmation de l'utilisateur).
 *
 * Quatre verrous avant toute installation, aucun ne peut etre contourne par le contenu web :
 *   1. l'adresse et chaque redirection : HTTPS, vers le panel ou GitHub uniquement ;
 *   2. l'empreinte SHA-256 du fichier, annoncee par le panel ;
 *   3. le paquet : meme application, version strictement superieure ;
 *   4. le certificat : le meme que celui de l'application installee (Android le refuserait de toute facon).
 *
 * Totalement independant du tunnel : aucune reference a LaboVpnService ni au coeur reseau.
 */
class UpdateInstaller(
    private val context: Context,
    private val panelHost: String,
    private val emit: (String, String) -> Unit,
) {
    private val running = AtomicBoolean(false)

    @Volatile private var cancelled = false
    @Volatile private var readyFile: File? = null

    private val dir: File get() = File(context.cacheDir, "updates")

    private class Refused(val code: String) : Exception(code)

    fun isMetered(): Boolean = try {
        (context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).isActiveNetworkMetered
    } catch (e: Exception) {
        false
    }

    fun canInstall(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()

    /** Ouvre le reglage Android « Installer des applications inconnues » de cette application. */
    fun openInstallPermission(): Boolean = try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startActivity(
                Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.packageName))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        }
        true
    } catch (e: Exception) {
        false
    }

    /** Retire les fichiers d'une mise a jour passee ou abandonnee (sans effet pendant un telechargement). */
    fun cleanup() {
        if (running.get()) return
        readyFile = null
        dir.listFiles()?.forEach { it.delete() }
    }

    fun cancel() {
        cancelled = true
    }

    fun download(url: String, sha256: String, expectedSize: Long) {
        if (!running.compareAndSet(false, true)) {
            emit("failed", code("busy"))
            return
        }
        cancelled = false
        readyFile = null
        Thread({
            val target = File(dir, "labosurf-update.apk")
            try {
                dir.mkdirs()
                dir.listFiles()?.forEach { it.delete() }
                fetch(url, target, expectedSize)
                emit("verifying", "{}")
                if (!digest(target).equals(sha256, ignoreCase = true)) throw Refused("sha")
                checkPackage(target)
                readyFile = target
                emit("ready", "{}")
            } catch (e: Refused) {
                target.delete()
                emit(if (e.code == "cancelled") "cancelled" else "failed", code(e.code))
            } catch (e: Exception) {
                target.delete()
                emit("failed", code("network"))
            } finally {
                running.set(false)
            }
        }, "labosurf-update").start()
    }

    /** "started" : la fenetre d'Android est ouverte ; "need_permission" : reglage a accorder ; "failed" : sinon. */
    fun install(): String {
        val file = readyFile ?: return "failed"
        if (!file.isFile) return "failed"
        if (!canInstall()) return "need_permission"
        return try {
            val uri = FileProvider.getUriForFile(context, context.packageName + ".fileprovider", file)
            context.startActivity(
                Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            )
            "started"
        } catch (e: Exception) {
            "failed"
        }
    }

    private fun code(value: String): String = JSONObject().put("code", value).toString()

    private fun hostAllowed(url: URL): Boolean {
        if (url.protocol != "https") return false
        val host = url.host.lowercase()
        return host == panelHost.lowercase() || host == "github.com" || host.endsWith(".githubusercontent.com")
    }

    private fun fetch(start: String, target: File, expectedSize: Long) {
        var url = URL(start)
        var conn: HttpURLConnection? = null
        try {
            var hops = 0
            while (true) {
                if (!hostAllowed(url)) throw Refused("host")
                val c = url.openConnection() as HttpURLConnection
                conn = c
                c.instanceFollowRedirects = false   // chaque redirection repasse par hostAllowed
                c.connectTimeout = CONNECT_TIMEOUT_MS
                c.readTimeout = READ_TIMEOUT_MS
                val status = c.responseCode
                if (status in 300..399) {
                    val next = c.getHeaderField("Location") ?: throw Refused("http")
                    c.disconnect()
                    if (++hops > MAX_REDIRECTS) throw Refused("http")
                    url = URL(url, next)
                    continue
                }
                if (status != 200) throw Refused("http")
                break
            }
            val c = conn ?: throw Refused("network")
            val announced = c.contentLengthLong
            val total = if (announced > 0) announced else expectedSize
            if (total > MAX_APK_BYTES) throw Refused("size")
            val free = context.cacheDir.usableSpace
            if (total > 0 && free < total + DISK_MARGIN_BYTES) throw Refused("disk")
            c.inputStream.use { input ->
                FileOutputStream(target).use { output ->
                    val buffer = ByteArray(BUFFER_BYTES)
                    var done = 0L
                    var lastEmit = 0L
                    while (true) {
                        if (cancelled) throw Refused("cancelled")
                        val n = input.read(buffer)
                        if (n < 0) break
                        output.write(buffer, 0, n)
                        done += n
                        if (done > MAX_APK_BYTES) throw Refused("size")
                        val now = System.currentTimeMillis()
                        if (now - lastEmit >= PROGRESS_EVERY_MS) {
                            lastEmit = now
                            emit("progress", JSONObject().put("done", done).put("total", total).toString())
                        }
                    }
                    emit("progress", JSONObject().put("done", done).put("total", if (total > 0) total else done).toString())
                }
            }
        } catch (e: java.io.IOException) {
            if (context.cacheDir.usableSpace < BUFFER_BYTES) throw Refused("disk")
            throw Refused("network")
        } finally {
            conn?.disconnect()
        }
    }

    private fun digest(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(BUFFER_BYTES)
            while (true) {
                val n = input.read(buffer)
                if (n < 0) break
                md.update(buffer, 0, n)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    @Suppress("DEPRECATION")
    private fun checkPackage(file: File) {
        val pm = context.packageManager
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val archive = pm.getPackageArchiveInfo(file.path, flags) ?: throw Refused("package")
        if (archive.packageName != context.packageName) throw Refused("package")
        val installed = pm.getPackageInfo(context.packageName, flags)
        if (versionCode(archive) <= versionCode(installed)) throw Refused("version")
        if (signers(archive).intersect(signers(installed)).isEmpty()) throw Refused("signature")
    }

    @Suppress("DEPRECATION")
    private fun versionCode(info: PackageInfo): Long =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else info.versionCode.toLong()

    @Suppress("DEPRECATION")
    private fun signers(info: PackageInfo): Set<String> {
        val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val signing = info.signingInfo ?: return emptySet()
            if (signing.hasMultipleSigners()) signing.apkContentsSigners else signing.signingCertificateHistory
        } else {
            info.signatures
        } ?: return emptySet()
        return signatures.map { sig ->
            MessageDigest.getInstance("SHA-256").digest(sig.toByteArray()).joinToString("") { "%02x".format(it) }
        }.toSet()
    }

    private companion object {
        const val CONNECT_TIMEOUT_MS = 20_000
        const val READ_TIMEOUT_MS = 30_000
        const val MAX_REDIRECTS = 5
        const val BUFFER_BYTES = 64 * 1024
        const val PROGRESS_EVERY_MS = 200L
        const val MAX_APK_BYTES = 400L * 1024 * 1024
        const val DISK_MARGIN_BYTES = 30L * 1024 * 1024
    }
}
