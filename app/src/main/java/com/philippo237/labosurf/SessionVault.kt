package com.philippo237.labosurf

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * « Rester connecté » : la SESSION du compte (jeton émis par le Panel, durée d'appareil de confiance) est gardée sur le
 * téléphone, chiffrée en AES-256-GCM par une clé du Keystore Android (non exportable, liée à cette installation).
 *
 *  - Jamais le mot de passe : seul le jeton de session, que le Panel peut révoquer à tout moment (déconnexion,
 *    « Mes appareils », changement de mot de passe, compte désactivé).
 *  - Jamais en clair sur le disque, jamais journalisé ; android:allowBackup="false" et la clé Keystore ne quitte pas l'appareil.
 *  - Effacé à la déconnexion, à l'expiration de la session, ou quand l'option est désactivée (js/account.js).
 *  - Toute anomalie (clé perdue, données illisibles, session expirée) efface le contenu : l'utilisateur se reconnecte.
 */
object SessionVault {
    private const val ALIAS = "labosurf_session_v1"
    private const val PREFS = "labosurf_session"
    private const val KEY_BLOB = "blob"
    private const val GCM_TAG_BITS = 128

    /** Validation pure (testée en JVM, SessionVaultTest) : jeton du Panel (base64url) et expiration future. */
    object Payload {
        private val TOKEN = Regex("^[A-Za-z0-9_-]{20,200}$")

        fun isSavable(token: String?, expiresAtMs: Double, nowMs: Long): Boolean =
            token != null && TOKEN.matches(token) && expiresAtMs.isFinite() && expiresAtMs > nowMs

        fun encode(token: String, expiresAtMs: Long): String = "$token\n$expiresAtMs"

        /** « jeton\nexpiration » -> paire validée, ou null (illisible ou expiré). */
        fun decode(plain: String?, nowMs: Long): Pair<String, Long>? {
            val parts = plain?.split("\n") ?: return null
            if (parts.size != 2) return null
            val exp = parts[1].toLongOrNull() ?: return null
            return if (isSavable(parts[0], exp.toDouble(), nowMs)) Pair(parts[0], exp) else null
        }
    }

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return gen.generateKey()
    }

    fun save(ctx: Context, token: String?, expiresAtMs: Double): Boolean {
        if (!Payload.isSavable(token, expiresAtMs, System.currentTimeMillis())) return false
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
            val ct = cipher.doFinal(Payload.encode(token!!, expiresAtMs.toLong()).toByteArray(Charsets.UTF_8))
            val blob = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP)
            prefs(ctx).edit().putString(KEY_BLOB, blob).apply()
            true
        } catch (e: Exception) {
            clear(ctx)
            false
        }
    }

    /** « jeton\nexpiration » si une session valide est gardée, sinon « » (et le contenu illisible ou expiré est effacé). */
    fun load(ctx: Context): String {
        val blob = prefs(ctx).getString(KEY_BLOB, null) ?: return ""
        return try {
            val (iv, ct) = blob.split(":").let { Pair(Base64.decode(it[0], Base64.NO_WRAP), Base64.decode(it[1], Base64.NO_WRAP)) }
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(GCM_TAG_BITS, iv)) }
            val plain = String(cipher.doFinal(ct), Charsets.UTF_8)
            val ok = Payload.decode(plain, System.currentTimeMillis())
            if (ok == null) { clear(ctx); "" } else Payload.encode(ok.first, ok.second)
        } catch (e: Exception) {
            clear(ctx)
            ""
        }
    }

    fun clear(ctx: Context) {
        prefs(ctx).edit().remove(KEY_BLOB).apply()
    }

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
