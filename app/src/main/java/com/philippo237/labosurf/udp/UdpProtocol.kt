package com.philippo237.labosurf.udp

import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Protocole de tunnel UDP LABOSURF PRO (voir LABOSURF_PRO/PROTOCOL.md) — Kotlin pur, sans dépendance Android : testable en JVM.
 *
 * HELLO -> CHALLENGE <nonce hex> -> AUTH <hmac hex> -> AUTH_OK <ip> (+ CLIENT_ID <hex>) ; puis des paquets IPv4 bruts précédés d'un
 * en-tête de 12 octets [version=1][3 octets à 0][ClientID sur 8 octets, big-endian].
 *
 * ATTENTION (documenté dans docs/LABOSURFVPN_REAL_FUNCTIONALITY.md) : ce protocole NE CHIFFRE PAS le trafic IP.
 */
object UdpProtocol {
    const val TUNNEL_VERSION: Int = 1
    const val HEADER_SIZE: Int = 12
    const val MAX_UDP: Int = 65507

    /** HMAC-SHA256(clé = mot de passe, message = OCTETS BRUTS du nonce), en hexadécimal minuscule. */
    fun authResponse(nonceHex: String, password: String): String {
        val nonce = hexToBytes(nonceHex) ?: throw IllegalArgumentException("nonce invalide")
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(password.toByteArray(Charsets.UTF_8), "HmacSHA256"))
        return bytesToHex(mac.doFinal(nonce))
    }

    /** ClientID = SHA-256("ip:port")[0:8] (big-endian) ; l'adresse est celle vue PAR LE SERVEUR (voir CLIENT_ID). */
    fun clientIdFromAddress(address: String): Long {
        val d = MessageDigest.getInstance("SHA-256").digest(address.toByteArray(Charsets.UTF_8))
        var v = 0L
        for (i in 0 until 8) v = (v shl 8) or (d[i].toLong() and 0xFF)
        return v
    }

    fun encodeTunnel(clientId: Long, ipPacket: ByteArray, length: Int = ipPacket.size): ByteArray {
        val out = ByteArray(HEADER_SIZE + length)
        out[0] = TUNNEL_VERSION.toByte()
        for (i in 0 until 8) out[4 + i] = (clientId ushr (56 - 8 * i)).toByte()
        System.arraycopy(ipPacket, 0, out, HEADER_SIZE, length)
        return out
    }

    class Decoded(val clientId: Long, val payload: ByteArray)

    fun decodeTunnel(data: ByteArray, length: Int = data.size): Decoded? {
        if (length < HEADER_SIZE || data[0].toInt() != TUNNEL_VERSION) return null
        var id = 0L
        for (i in 0 until 8) id = (id shl 8) or (data[4 + i].toLong() and 0xFF)
        return Decoded(id, data.copyOfRange(HEADER_SIZE, length))
    }

    fun hexToBytes(s: String): ByteArray? {
        if (s.isEmpty() || s.length % 2 != 0) return null
        val out = ByteArray(s.length / 2)
        for (i in out.indices) {
            val hi = Character.digit(s[2 * i], 16)
            val lo = Character.digit(s[2 * i + 1], 16)
            if (hi < 0 || lo < 0) return null
            out[i] = ((hi shl 4) or lo).toByte()
        }
        return out
    }

    fun bytesToHex(b: ByteArray): String {
        val sb = StringBuilder(b.size * 2)
        for (x in b) sb.append(String.format("%02x", x.toInt() and 0xFF))
        return sb.toString()
    }

    // ---------- Paquets IPv4 de sonde (vérification du chemin de données) ----------

    fun checksum(b: ByteArray, off: Int = 0, len: Int = b.size): Int {
        var sum = 0L
        var i = off
        while (i + 1 < off + len) { sum += ((b[i].toInt() and 0xFF) shl 8) or (b[i + 1].toInt() and 0xFF); i += 2 }
        if (len % 2 == 1) sum += (b[off + len - 1].toInt() and 0xFF) shl 8
        while (sum ushr 16 != 0L) sum = (sum and 0xFFFF) + (sum ushr 16)
        return (sum.inv() and 0xFFFF).toInt()
    }

    private fun ipv4(src: ByteArray, dst: ByteArray, proto: Int, payload: ByteArray, ident: Int): ByteArray {
        val p = ByteArray(20 + payload.size)
        p[0] = 0x45
        val total = p.size
        p[2] = (total shr 8).toByte(); p[3] = total.toByte()
        p[4] = (ident shr 8).toByte(); p[5] = ident.toByte()
        p[8] = 64; p[9] = proto.toByte()
        System.arraycopy(src, 0, p, 12, 4); System.arraycopy(dst, 0, p, 16, 4)
        val c = checksum(p, 0, 20)
        p[10] = (c shr 8).toByte(); p[11] = c.toByte()
        System.arraycopy(payload, 0, p, 20, payload.size)
        return p
    }

    fun parseIpv4(s: String): ByteArray? {
        val parts = s.trim().split(".")
        if (parts.size != 4) return null
        val out = ByteArray(4)
        for (i in 0 until 4) {
            val n = parts[i].toIntOrNull() ?: return null
            if (n < 0 || n > 255) return null
            out[i] = n.toByte()
        }
        return out
    }

    /** Requête DNS (type A) pour `name`, identifiant `id`. */
    fun dnsQuery(name: String, id: Int): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        out.write(id shr 8); out.write(id and 0xFF); out.write(0x01); out.write(0x00)   // flags : récursion souhaitée
        out.write(0); out.write(1); out.write(0); out.write(0); out.write(0); out.write(0); out.write(0); out.write(0)
        for (label in name.split(".")) { val b = label.toByteArray(Charsets.US_ASCII); out.write(b.size); out.write(b) }
        out.write(0); out.write(0); out.write(1); out.write(0); out.write(1)                 // type A, classe IN
        return out.toByteArray()
    }

    /** Datagramme IPv4/UDP complet (somme UDP à 0 : autorisée en IPv4). */
    fun udpPacket(src: ByteArray, dst: ByteArray, srcPort: Int, dstPort: Int, payload: ByteArray, ident: Int = 0x4242): ByteArray {
        val udp = ByteArray(8 + payload.size)
        udp[0] = (srcPort shr 8).toByte(); udp[1] = srcPort.toByte()
        udp[2] = (dstPort shr 8).toByte(); udp[3] = dstPort.toByte()
        val l = udp.size
        udp[4] = (l shr 8).toByte(); udp[5] = l.toByte()
        System.arraycopy(payload, 0, udp, 8, payload.size)
        return ipv4(src, dst, 17, udp, ident)
    }

    /** Réponse DNS valide (même identifiant, RCODE 0, au moins une réponse) contenue dans un paquet IPv4/UDP ? */
    fun isDnsAnswer(ipPacket: ByteArray, expectedId: Int, fromIp: ByteArray): Boolean {
        if (ipPacket.size < 20 + 8 + 12) return false
        if ((ipPacket[0].toInt() shr 4) != 4 || ipPacket[9].toInt() != 17) return false
        for (i in 0 until 4) if (ipPacket[12 + i] != fromIp[i]) return false
        val ihl = (ipPacket[0].toInt() and 0x0F) * 4
        if (ipPacket.size < ihl + 8 + 12) return false
        val d = ihl + 8
        val id = ((ipPacket[d].toInt() and 0xFF) shl 8) or (ipPacket[d + 1].toInt() and 0xFF)
        val flags = ((ipPacket[d + 2].toInt() and 0xFF) shl 8) or (ipPacket[d + 3].toInt() and 0xFF)
        val answers = ((ipPacket[d + 6].toInt() and 0xFF) shl 8) or (ipPacket[d + 7].toInt() and 0xFF)
        return id == expectedId && (flags and 0x8000) != 0 && (flags and 0x000F) == 0 && answers >= 1
    }
}
