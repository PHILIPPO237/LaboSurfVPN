package com.philippo237.labosurf.udp

import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.PipedInputStream
import java.io.PipedOutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketAddress
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** Faux serveur UDP LABOSURF (protocole de PROTOCOL.md) : HELLO/CHALLENGE/AUTH, CLIENT_ID optionnel, DNS, PING, tunnel. */
private class FakeServer(
    val password: String,
    var announceClientId: Long? = null,
    var answerDns: Boolean = true,
    var authReply: String? = null,        // remplace la réponse à AUTH (ex. « ACCOUNT_EXPIRED »)
    var silent: Boolean = false,          // ne répond à rien
    val tunnelIp: String = "10.77.0.9",
) : Thread("fake-udp-server") {
    val socket = DatagramSocket(0, InetAddress.getByName("127.0.0.1"))
    val port: Int get() = socket.localPort
    @Volatile var running = true
    val tunnelPackets = LinkedBlockingQueue<ByteArray>()
    @Volatile var clientAddress: SocketAddress? = null
    @Volatile var expectedId: Long = 0

    private fun reply(p: DatagramPacket, text: String) {
        val b = text.toByteArray(Charsets.US_ASCII)
        socket.send(DatagramPacket(b, b.size, p.socketAddress))
    }

    fun sendData(clientId: Long, ipPacket: ByteArray) {
        val b = UdpProtocol.encodeTunnel(clientId, ipPacket)
        socket.send(DatagramPacket(b, b.size, clientAddress))
    }

    override fun run() {
        val buf = ByteArray(65535)
        var nonceHex = ""
        while (running) {
            val p = DatagramPacket(buf, buf.size)
            try { socket.receive(p) } catch (e: Exception) { break }
            if (silent) continue
            clientAddress = p.socketAddress
            val data = buf.copyOf(p.length)
            val text = String(data, Charsets.US_ASCII)
            when {
                text == "HELLO" -> { nonceHex = UdpProtocol.bytesToHex(ByteArray(32) { (it * 7).toByte() }); reply(p, "CHALLENGE $nonceHex") }
                text.startsWith("AUTH ") -> {
                    val ok = text.removePrefix("AUTH ") == UdpProtocol.authResponse(nonceHex, password)
                    val forced = authReply
                    when {
                        forced != null -> reply(p, forced)
                        ok -> {
                            reply(p, "AUTH_OK $tunnelIp")
                            expectedId = announceClientId ?: UdpProtocol.clientIdFromAddress("${p.address.hostAddress}:${p.port}")
                            announceClientId?.let { reply(p, "CLIENT_ID " + String.format("%016x", it)) }
                        }
                        else -> reply(p, "AUTH_FAIL")
                    }
                }
                text == "PING" -> reply(p, "PONG")
                data.isNotEmpty() && data[0].toInt() == 1 -> onTunnel(p, data)
            }
        }
    }

    private fun onTunnel(p: DatagramPacket, data: ByteArray) {
        val dec = UdpProtocol.decodeTunnel(data) ?: return
        if (dec.clientId != expectedId) return                     // « Tunnel refusé : ClientID incorrect »
        tunnelPackets.add(dec.payload)
        val ip = dec.payload
        if (!answerDns || ip.size < 28 || ip[9].toInt() != 17) return
        val ihl = (ip[0].toInt() and 0x0F) * 4
        val dport = ((ip[ihl + 2].toInt() and 0xFF) shl 8) or (ip[ihl + 3].toInt() and 0xFF)
        if (dport != 53) return
        val sport = ((ip[ihl].toInt() and 0xFF) shl 8) or (ip[ihl + 1].toInt() and 0xFF)
        val dns = ip.copyOfRange(ihl + 8, ip.size)
        dns[2] = 0x81.toByte(); dns[3] = 0x80.toByte(); dns[7] = 1
        val answer = UdpProtocol.udpPacket(ip.copyOfRange(16, 20), ip.copyOfRange(12, 16), 53, sport, dns)
        sendData(dec.clientId, answer)
    }

    fun shutdown() { running = false; socket.close() }
}

class UdpTunnelClientTest {
    private val servers = mutableListOf<FakeServer>()
    private val clients = mutableListOf<UdpTunnelClient>()

    private fun server(password: String = "secret-test", block: FakeServer.() -> Unit = {}): FakeServer {
        val s = FakeServer(password); s.block(); s.isDaemon = true; s.start(); servers.add(s); return s
    }

    private fun client(s: FakeServer, password: String = "secret-test", handshakeMs: Int = 800, probeMs: Int = 900): UdpTunnelClient {
        val c = UdpTunnelClient(UdpLink.parse("udp://t-udp1@127.0.0.1:${s.port}?pass=$password"), handshakeTimeoutMs = handshakeMs,
            probeTimeoutMs = probeMs, clientIdGraceMs = 300)
        clients.add(c); return c
    }

    @After fun cleanup() { clients.forEach { it.stop() }; servers.forEach { it.shutdown() } }

    private fun failureCode(block: () -> Unit): String {
        try { block() } catch (f: UdpTunnelClient.Failure) { return f.code }
        fail("aucune Failure levée"); return ""
    }

    // ---------- handshake ----------
    @Test fun handshakeSucceedsAndUsesTheClientIdAnnouncedByTheServer() {
        val announced = 0x1122334455667788L      // ≠ ClientID calculé depuis l'adresse locale : simule un NAT
        val s = server { announceClientId = announced }
        val session = client(s).connect()
        assertEquals("10.77.0.9", session.tunnelIp)
        assertEquals(announced, session.clientId)
        assertTrue(session.clientIdFromServer)
    }

    @Test fun withoutClientIdFallsBackToTheLocalAddress() {
        val s = server()                          // ancien serveur : pas de CLIENT_ID
        val session = client(s).connect()
        assertFalse(session.clientIdFromServer)         // repli « au mieux » : valable seulement sans NAT, jamais le cas nominal
    }

    @Test fun wrongPasswordIsRefused() {
        val s = server()
        assertEquals("auth_failed", failureCode { client(s, password = "mauvais").connect() })
    }

    @Test fun serverErrorCodesAreMappedToStableCodes() {
        val cases = mapOf("ACCOUNT_EXPIRED" to "account_expired", "QUOTA_EXCEEDED" to "quota_exceeded", "MAX_CONNECTIONS" to "max_connections",
            "MAX_IPS" to "max_ips", "TUNNEL_IP_UNAVAILABLE" to "ip_unavailable", "AUTH_FAIL" to "auth_failed", "N_IMPORTE_QUOI" to "protocol_error")
        for ((wire, code) in cases) {
            val s = server { authReply = wire }
            assertEquals(wire, code, failureCode { client(s).connect() })
        }
    }

    @Test fun silentServerMeansUnreachableNotConnected() {
        val s = server { silent = true }
        assertEquals("server_unreachable", failureCode { client(s, handshakeMs = 400).connect() })
    }

    @Test fun serverWithoutTunnelIpIsNotAVpnServer() {
        val s = server { authReply = "AUTH_OK" }
        assertEquals("server_not_vpn", failureCode { client(s).connect() })
    }

    @Test fun socketProtectionFailureAbortsBeforeAnyPacket() {
        val s = server()
        val c = UdpTunnelClient(UdpLink.parse("udp://u@127.0.0.1:${s.port}?pass=secret-test"), protect = { false })
        clients.add(c)
        assertEquals("protect_failed", failureCode { c.connect() })
        assertTrue("aucun paquet ne doit partir", s.tunnelPackets.isEmpty())
    }

    // ---------- vérification du chemin ----------
    @Test fun verifyPathSucceedsWhenARealDnsAnswerComesBackThroughTheTunnel() {
        val s = server { announceClientId = 0x0badc0ffee0ddf00L }
        val c = client(s); c.connect(); c.verifyPath()          // ne lève pas
        assertNotNull(s.tunnelPackets.poll(1, TimeUnit.SECONDS))  // la requête est bien arrivée au serveur avec le bon ClientID
    }

    @Test fun verifyPathFailsWhenNothingComesBack() {
        val s = server { announceClientId = 0x1L; answerDns = false }
        val c = client(s); c.connect()
        assertEquals("tunnel_unverified", failureCode { c.verifyPath() })
    }

    @Test fun verifyPathFailsWhenTheServerRejectsTheClientId() {
        // Le serveur attend un autre ClientID que celui utilisé par le client : tout est écarté, comme un vrai serveur derrière un NAT.
        val s = server { announceClientId = 0x5L }
        val c = client(s); c.connect(); s.expectedId = 0x6L
        assertEquals("tunnel_unverified", failureCode { c.verifyPath() })
    }

    // ---------- pompes ----------
    @Test fun pumpsForwardIpv4BothWaysCountRealBytesAndDropIpv6() {
        val s = server { announceClientId = 0x77L }
        val c = client(s); val session = c.connect()

        val tunWriteEnd = PipedOutputStream(); val tunIn = PipedInputStream(tunWriteEnd, 65536)      // ce que l'appli « lit » depuis le TUN
        val tunOutSink = PipedInputStream(65536); val tunOut = PipedOutputStream(tunOutSink)           // ce que l'appli « écrit » dans le TUN
        val ended = AtomicReference<String?>("pas fini")
        c.start(tunIn, tunOut) { ended.set(it) }

        val v4 = UdpProtocol.udpPacket(UdpProtocol.parseIpv4(session.tunnelIp)!!, UdpProtocol.parseIpv4("9.9.9.9")!!, 1000, 2000, byteArrayOf(1, 2, 3))
        val v6 = ByteArray(60); v6[0] = 0x60
        // Un vrai TUN rend UN paquet par lecture : on attend que l'IPv6 soit consommé avant d'écrire le paquet suivant.
        tunWriteEnd.write(v6); tunWriteEnd.flush()
        val drained = System.currentTimeMillis() + 2000
        while (tunIn.available() > 0 && System.currentTimeMillis() < drained) Thread.sleep(5)
        Thread.sleep(100)
        tunWriteEnd.write(v4); tunWriteEnd.flush()
        val got = s.tunnelPackets.poll(2, TimeUnit.SECONDS)
        assertNotNull("le paquet IPv4 doit arriver au serveur", got)
        assertArrayEquals(v4, got)
        assertNull("l'IPv6 ne doit jamais être envoyé", s.tunnelPackets.poll(300, TimeUnit.MILLISECONDS))
        assertEquals(v4.size.toLong(), c.txBytes.get())

        val back = UdpProtocol.udpPacket(UdpProtocol.parseIpv4("9.9.9.9")!!, UdpProtocol.parseIpv4(session.tunnelIp)!!, 2000, 1000, byteArrayOf(4, 5))
        s.sendData(0x999L, UdpProtocol.udpPacket(UdpProtocol.parseIpv4("6.6.6.6")!!, UdpProtocol.parseIpv4(session.tunnelIp)!!, 1, 2, byteArrayOf(9)))   // mauvais ClientID : ignoré
        s.sendData(session.clientId, back)
        val buf = ByteArray(back.size); var read = 0
        val deadline = System.currentTimeMillis() + 2000
        while (read < back.size && System.currentTimeMillis() < deadline) {
            if (tunOutSink.available() > 0) read += tunOutSink.read(buf, read, back.size - read) else Thread.sleep(20)
        }
        assertEquals("seul le paquet au bon ClientID est écrit dans le TUN", back.size, read)
        assertArrayEquals(back, buf)
        assertEquals(back.size.toLong(), c.rxBytes.get())
        assertEquals("pas fini", ended.get())
    }

    @Test fun serverControlMessageEndsTheTunnelWithAStableCode() {
        val s = server { announceClientId = 0x77L }
        val c = client(s); c.connect()
        val tunIn = PipedInputStream(PipedOutputStream(), 1024)
        val tunOut = PipedOutputStream(PipedInputStream(1024))
        val ended = LinkedBlockingQueue<String>()
        c.start(tunIn, tunOut) { ended.add(it ?: "null") }
        Thread.sleep(200)
        val b = "ACCOUNT_EXPIRED".toByteArray(Charsets.US_ASCII)
        s.socket.send(DatagramPacket(b, b.size, s.clientAddress))
        assertEquals("account_expired", ended.poll(3, TimeUnit.SECONDS))
    }
}
