package com.philippo237.labosurf.udp

/**
 * Lien de connexion UDP émis par LABOSURF_PRO : `udp://<utilisateur>@<hôte>:<port>?pass=<mot de passe>`
 * (internal/clientcfg/access.go). Lu tel quel : jamais reconstruit ni « corrigé » côté Android.
 * Le mot de passe n'apparaît JAMAIS dans toString() ni dans les messages d'erreur.
 */
class UdpLink private constructor(val username: String, val host: String, val port: Int, val password: String) {
    override fun toString(): String = "udp://$username@$host:$port"

    class Invalid(message: String) : Exception(message)

    companion object {
        fun parse(uri: String?): UdpLink {
            val text = uri?.trim().orEmpty()
            if (!text.startsWith("udp://")) throw Invalid("schéma udp:// attendu")
            var rest = text.removePrefix("udp://")
            val hash = rest.indexOf('#')
            if (hash >= 0) rest = rest.substring(0, hash)
            val q = rest.indexOf('?')
            val authority = if (q >= 0) rest.substring(0, q) else rest
            val query = if (q >= 0) rest.substring(q + 1) else ""
            val at = authority.lastIndexOf('@')
            if (at <= 0) throw Invalid("nom d'utilisateur manquant")
            val user = safeDecode(authority.substring(0, at))
            val hostPort = authority.substring(at + 1)
            val colon = hostPort.lastIndexOf(':')
            if (colon <= 0) throw Invalid("port manquant")
            val host = hostPort.substring(0, colon).trim('[', ']')
            val port = hostPort.substring(colon + 1).toIntOrNull() ?: throw Invalid("port invalide")
            if (host.isEmpty()) throw Invalid("hôte manquant")
            if (port < 1 || port > 65535) throw Invalid("port hors limites")
            var pass = ""
            for (kv in query.split("&")) {
                val eq = kv.indexOf('=')
                if (eq > 0 && kv.substring(0, eq) == "pass") pass = safeDecode(kv.substring(eq + 1))
            }
            if (pass.isEmpty()) throw Invalid("mot de passe manquant")
            if (user.isEmpty()) throw Invalid("nom d'utilisateur manquant")
            return UdpLink(user, host, port, pass)
        }

        /** Décodage %XX uniquement : le « + » reste un « + » (le lien de PRO n'est pas un formulaire) ; un « % » non suivi de 2 chiffres reste littéral. */
        private fun safeDecode(s: String): String {
            val out = java.io.ByteArrayOutputStream()
            val bytes = s.toByteArray(Charsets.UTF_8)
            var i = 0
            while (i < bytes.size) {
                val c = bytes[i].toInt() and 0xFF
                if (c == '%'.code && i + 2 < bytes.size) {
                    val hi = Character.digit(bytes[i + 1].toInt() and 0xFF, 16)
                    val lo = Character.digit(bytes[i + 2].toInt() and 0xFF, 16)
                    if (hi >= 0 && lo >= 0) {
                        out.write((hi shl 4) or lo)
                        i += 3
                        continue
                    }
                }
                out.write(c)
                i++
            }
            return String(out.toByteArray(), Charsets.UTF_8)
        }
    }
}
