package com.philippo237.labosurf.udp

import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetSocketAddress
import java.net.SocketTimeoutException
import java.util.concurrent.atomic.AtomicLong

/**
 * Client du tunnel UDP LABOSURF PRO. Aucune dépendance Android (le VpnService fournit `protect` et les flux du TUN) : testable en JVM.
 *
 * Déroulement : connect() (handshake) -> verifyPath() (une VRAIE requête DNS traverse le tunnel et son retour est contrôlé)
 * -> start() (pompes TUN <-> UDP + keepalive). « Connecté » n'est annoncé par l'appelant qu'après verifyPath().
 */
class UdpTunnelClient(
    private val link: UdpLink,
    private val newSocket: () -> DatagramSocket = { DatagramSocket() },
    private val protect: (DatagramSocket) -> Boolean = { true },
    private val handshakeTimeoutMs: Int = 5000,
    private val probeTimeoutMs: Int = 6000,
    private val clientIdGraceMs: Int = 1500,
) {
    /** `code` est un code stable traduit par l'interface (js/vpn.js) : jamais un message brut du serveur. */
    class Failure(val code: String, message: String) : Exception(message)

    class Session(val tunnelIp: String, val clientId: Long, val clientIdFromServer: Boolean)

    val rxBytes = AtomicLong(0)
    val txBytes = AtomicLong(0)

    @Volatile private var socket: DatagramSocket? = null
    @Volatile private var running = false
    private var session: Session? = null
    private var threads: List<Thread> = emptyList()

    // ---------------- 1. Handshake ----------------
    fun connect(): Session {
        val s = newSocket()
        socket = s
        try {
            if (!protect(s)) throw Failure("protect_failed", "socket non protégée")
            val addr = InetSocketAddress(link.host, link.port)
            if (addr.isUnresolved) throw Failure("server_unreachable", "hôte introuvable")
            s.connect(addr)
            s.soTimeout = handshakeTimeoutMs
            send(s, "HELLO")
            val challenge = receiveText(s) ?: throw Failure("server_unreachable", "aucune réponse du serveur")
            if (!challenge.startsWith("CHALLENGE ")) throw failureFor(challenge)
            val response = try {
                UdpProtocol.authResponse(challenge.removePrefix("CHALLENGE ").trim(), link.password)
            } catch (e: IllegalArgumentException) {
                throw Failure("protocol_error", "challenge invalide")
            }
            send(s, "AUTH $response")

            var tunnelIp: String? = null
            var serverId: Long? = null
            var authOk = false
            val deadline = System.currentTimeMillis() + handshakeTimeoutMs
            while (System.currentTimeMillis() < deadline && !(authOk && serverId != null)) {
                s.soTimeout = if (authOk) clientIdGraceMs else handshakeTimeoutMs
                val msg = (try { receiveText(s) } catch (e: SocketTimeoutException) { null }) ?: break
                when {
                    msg.startsWith("CLIENT_ID ") -> serverId = msg.removePrefix("CLIENT_ID ").trim().toULongOrNull(16)?.toLong()
                    msg.startsWith("AUTH_OK") -> {
                        authOk = true
                        tunnelIp = msg.removePrefix("AUTH_OK").trim().takeIf { it.isNotEmpty() }
                    }
                    else -> throw failureFor(msg)
                }
            }
            if (!authOk) throw Failure("server_unreachable", "pas de réponse d'authentification")
            val ip = tunnelIp ?: throw Failure("server_not_vpn", "le serveur n'a pas de tunnel IP (mode proxy)")
            if (UdpProtocol.parseIpv4(ip) == null) throw Failure("protocol_error", "adresse de tunnel invalide")
            val id: Long
            val fromServer: Boolean
            if (serverId != null) {
                id = serverId; fromServer = true
            } else {
                // Ancien serveur (sans CLIENT_ID) : repli sur l'adresse locale, valable seulement SANS NAT.
                id = UdpProtocol.clientIdFromAddress("${s.localAddress.hostAddress}:${s.localPort}"); fromServer = false
            }
            val result = Session(ip, id, fromServer)
            session = result
            return result
        } catch (e: Failure) {
            close(); throw e
        } catch (e: SocketTimeoutException) {
            close(); throw Failure("server_unreachable", "délai dépassé")
        } catch (e: IOException) {
            close(); throw Failure("server_unreachable", "réseau indisponible")
        }
    }

    // ---------------- 2. Vérification du chemin de données ----------------
    /** Envoie une vraie requête DNS à travers le tunnel et attend sa vraie réponse. Sinon : Failure("tunnel_unverified"). */
    fun verifyPath(dnsServer: String = "1.1.1.1", name: String = "example.com") {
        val s = socket ?: throw Failure("protocol_error", "non connecté")
        val sess = session ?: throw Failure("protocol_error", "non connecté")
        val src = UdpProtocol.parseIpv4(sess.tunnelIp)!!
        val dst = UdpProtocol.parseIpv4(dnsServer)!!
        val probeId = 0x1D1D
        val packet = UdpProtocol.encodeTunnel(sess.clientId, UdpProtocol.udpPacket(src, dst, 40123, 53, UdpProtocol.dnsQuery(name, probeId)))
        val attempts = 3
        val per = (probeTimeoutMs / attempts).coerceAtLeast(300)
        val buf = ByteArray(UdpProtocol.MAX_UDP)
        try {
            repeat(attempts) {
                s.send(DatagramPacket(packet, packet.size))
                val end = System.currentTimeMillis() + per
                while (true) {
                    val left = (end - System.currentTimeMillis()).toInt()
                    if (left <= 0) break
                    s.soTimeout = left
                    val p = DatagramPacket(buf, buf.size)
                    try { s.receive(p) } catch (e: SocketTimeoutException) { break }
                    val text = controlText(buf, p.length)
                    if (text != null && text != "PONG") throw failureFor(text)
                    val dec = UdpProtocol.decodeTunnel(buf, p.length) ?: continue
                    if (dec.clientId == sess.clientId && UdpProtocol.isDnsAnswer(dec.payload, probeId, dst)) return
                }
            }
        } catch (e: IOException) {
            throw Failure("server_unreachable", "réseau indisponible")
        }
        throw Failure("tunnel_unverified", "aucune réponse à travers le tunnel")
    }

    // ---------------- 3. Pompes ----------------
    /** Démarre les pompes TUN -> UDP, UDP -> TUN et le keepalive. `onEnded(code)` est appelé UNE fois si le tunnel s'arrête de lui-même. */
    fun start(tunIn: InputStream, tunOut: OutputStream, onEnded: (String?) -> Unit) {
        val s = socket ?: throw IllegalStateException("non connecté")
        val sess = session ?: throw IllegalStateException("non connecté")
        running = true
        val ended = java.util.concurrent.atomic.AtomicBoolean(false)
        val finish = { code: String? -> if (ended.compareAndSet(false, true)) { running = false; onEnded(code) } }

        val up = Thread({
            val buf = ByteArray(32767)
            try {
                while (running) {
                    val n = tunIn.read(buf)
                    if (n < 0) break
                    if (n < 20 || (buf[0].toInt() shr 4) != 4) continue           // IPv6 et paquets invalides : jamais envoyés (le serveur est IPv4)
                    val out = UdpProtocol.encodeTunnel(sess.clientId, buf, n)
                    s.send(DatagramPacket(out, out.size))
                    txBytes.addAndGet(n.toLong())
                }
            } catch (e: IOException) {
                if (running) finish("network_lost")
            }
            if (running) finish(null)
        }, "labosurf-udp-up")

        val down = Thread({
            val buf = ByteArray(UdpProtocol.MAX_UDP)
            s.soTimeout = 1000
            try {
                while (running) {
                    val p = DatagramPacket(buf, buf.size)
                    try { s.receive(p) } catch (e: SocketTimeoutException) { continue }
                    val text = controlText(buf, p.length)
                    if (text != null) {
                        if (text == "PONG") continue
                        finish(failureFor(text).code); return@Thread
                    }
                    val dec = UdpProtocol.decodeTunnel(buf, p.length) ?: continue
                    if (dec.clientId != sess.clientId) continue
                    tunOut.write(dec.payload)
                    rxBytes.addAndGet(dec.payload.size.toLong())
                }
            } catch (e: IOException) {
                if (running) finish("network_lost")
            }
        }, "labosurf-udp-down")

        val keepalive = Thread({
            try {
                while (running) {
                    var waited = 0
                    while (running && waited < 25_000) { Thread.sleep(500); waited += 500 }
                    if (running) send(s, "PING")
                }
            } catch (e: InterruptedException) {
            } catch (e: IOException) {
                if (running) finish("network_lost")
            }
        }, "labosurf-udp-keepalive")

        threads = listOf(up, down, keepalive)
        threads.forEach { it.isDaemon = true; it.start() }
    }

    fun stop() {
        running = false
        close()
        threads.forEach { it.interrupt() }
    }

    private fun close() {
        try { socket?.close() } catch (e: Exception) { }
    }

    // ---------------- utilitaires ----------------
    private fun send(s: DatagramSocket, text: String) {
        val b = text.toByteArray(Charsets.US_ASCII)
        s.send(DatagramPacket(b, b.size))
    }

    private fun receiveText(s: DatagramSocket): String? {
        val buf = ByteArray(2048)
        val p = DatagramPacket(buf, buf.size)
        s.receive(p)
        return String(buf, 0, p.length, Charsets.US_ASCII).trim()
    }

    /** Un datagramme de contrôle est du texte ASCII imprimable (un paquet tunnel commence par l'octet 0x01). */
    private fun controlText(b: ByteArray, len: Int): String? {
        if (len <= 0 || len > 64) return null
        for (i in 0 until len) { val c = b[i].toInt(); if (c < 0x20 || c > 0x7e) return null }
        return String(b, 0, len, Charsets.US_ASCII).trim()
    }

    private fun failureFor(message: String): Failure = when (message) {
        "AUTH_FAIL" -> Failure("auth_failed", "identifiants refusés")
        "ACCOUNT_EXPIRED" -> Failure("account_expired", "accès expiré")
        "QUOTA_EXCEEDED" -> Failure("quota_exceeded", "quota atteint")
        "MAX_CONNECTIONS" -> Failure("max_connections", "limite de connexions atteinte")
        "MAX_IPS" -> Failure("max_ips", "limite d'adresses atteinte")
        "TUNNEL_IP_UNAVAILABLE" -> Failure("ip_unavailable", "plus d'adresse tunnel disponible")
        "NO_SESSION" -> Failure("session_lost", "session expirée côté serveur")
        else -> Failure("protocol_error", "réponse inattendue du serveur")
    }
}
