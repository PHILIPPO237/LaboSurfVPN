package com.philippo237.labosurf

/**
 * Lien de session unifiee Panel -> application (voir app/routers/auth_exchange.py cote panel).
 *
 * Un code d'echange n'est accepte que s'il arrive par un lien du PANEL COMPILE (BuildConfig.PANEL_BASE_URL) :
 * https, meme hote, chemin /app/open. Deux formes reelles :
 *  - App Link verifie (assetlinks.json) : https://<hote>/app/open#code=<code>   (code dans le FRAGMENT, jamais envoye au serveur)
 *  - bouton « Ouvrir l'app » du panel dans Chrome : intention « intent:// » -> meme adresse, code dans l'extra exchange_code
 * Le code est aleatoire (base64url), a usage unique et expire en 60 s : il n'est jamais journalise ni stocke sur le disque.
 *
 * Fonction pure (sans Android) : testee en JVM (ExchangeLinkTest).
 */
object ExchangeLink {
    const val PATH = "/app/open"
    const val EXTRA_CODE = "exchange_code"
    private val CODE = Regex("^[A-Za-z0-9_-]{32,100}$")
    private val IN_FRAGMENT = Regex("(?:^|&)code=([A-Za-z0-9_-]{32,100})(?:&|$)")

    fun isValidCode(code: String?): Boolean = code != null && CODE.matches(code)

    /** Retourne le code a echanger, ou null si le lien ne vient pas du panel attendu ou si le code est mal forme. */
    fun extract(scheme: String?, host: String?, path: String?, fragment: String?, extraCode: String?, panelHost: String): String? {
        if (scheme != "https" || panelHost.isBlank() || host == null || !host.equals(panelHost, ignoreCase = true)) return null
        if (path == null || !(path == PATH || path.startsWith("$PATH/"))) return null
        val code = IN_FRAGMENT.find(fragment ?: "")?.groupValues?.get(1) ?: extraCode
        return if (isValidCode(code)) code else null
    }
}
