package com.philippo237.labosurf.udp

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * Vecteurs de test calculés par le client de RÉFÉRENCE Python (tests/udp/reference_client.py), lui-même validé contre un vrai
 * serveur UDP LABOSURF PRO : si ces valeurs changent, le protocole n'est plus celui du serveur.
 */
class UdpProtocolTest {
    private val nonce = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"

    @Test fun authResponseMatchesReferenceVector() {
        assertEquals("8bac8e99819fd1a6aac7b56fa94ec7845fecb2783db4bc388ca0ef4f6cbb581b", UdpProtocol.authResponse(nonce, "mot-de-passe-test"))
    }

    @Test fun authResponseIsComputedOnRawNonceBytesNotOnTheHexText() {
        assertFalse(UdpProtocol.authResponse(nonce, "x") == UdpProtocol.authResponse(nonce, "y"))
        assertEquals(64, UdpProtocol.authResponse(nonce, "x").length)
        try { UdpProtocol.authResponse("zz", "x"); fail("nonce invalide accepté") } catch (e: IllegalArgumentException) { }
    }

    @Test fun clientIdMatchesReferenceVector() {
        assertEquals(0x3c20dc214ac3b4ebL, UdpProtocol.clientIdFromAddress("165.210.39.242:30722"))
    }

    @Test fun tunnelHeaderIsVersionThreeZerosThenBigEndianClientId() {
        val enc = UdpProtocol.encodeTunnel(0x0123456789abcdefL, byteArrayOf(1, 2, 3))
        assertEquals("010000000123456789abcdef010203", UdpProtocol.bytesToHex(enc))
        val dec = UdpProtocol.decodeTunnel(enc)
        assertNotNull(dec)
        assertEquals(0x0123456789abcdefL, dec!!.clientId)
        assertArrayEquals(byteArrayOf(1, 2, 3), dec.payload)
    }

    @Test fun decodeRejectsWrongVersionAndShortPackets() {
        assertNull(UdpProtocol.decodeTunnel(ByteArray(11)))
        val bad = UdpProtocol.encodeTunnel(1L, byteArrayOf(9)); bad[0] = 2
        assertNull(UdpProtocol.decodeTunnel(bad))
    }

    @Test fun encodeHonoursTheGivenLengthNotTheBufferSize() {
        val big = ByteArray(100) { 7 }
        assertEquals(UdpProtocol.HEADER_SIZE + 5, UdpProtocol.encodeTunnel(1L, big, 5).size)
    }

    @Test fun dnsProbePacketMatchesReferenceBytes() {
        val src = UdpProtocol.parseIpv4("10.77.0.5")!!
        val dst = UdpProtocol.parseIpv4("1.1.1.1")!!
        val pkt = UdpProtocol.udpPacket(src, dst, 40123, 53, UdpProtocol.dnsQuery("example.com", 0x1D1D))
        assertEquals(
            "450000394242000040112c1f0a4d0005010101019cbb0035002500001d1d01000001000000000000076578616d706c6503636f6d0000010001",
            UdpProtocol.bytesToHex(pkt),
        )
        assertEquals(0, UdpProtocol.checksum(pkt, 0, 20))   // en-tête IPv4 valide : somme de contrôle = 0
    }

    @Test fun parseIpv4() {
        assertArrayEquals(byteArrayOf(10, 77, 0, 5), UdpProtocol.parseIpv4("10.77.0.5"))
        assertNull(UdpProtocol.parseIpv4("10.77.0"))
        assertNull(UdpProtocol.parseIpv4("10.77.0.256"))
        assertNull(UdpProtocol.parseIpv4("a.b.c.d"))
    }

    @Test fun isDnsAnswerRequiresIdSourceResponseFlagAndAnAnswer() {
        val client = UdpProtocol.parseIpv4("10.77.0.5")!!
        val dns = UdpProtocol.parseIpv4("1.1.1.1")!!
        val q = UdpProtocol.dnsQuery("example.com", 0x1D1D)
        val answer = q.copyOf(); answer[2] = 0x81.toByte(); answer[3] = 0x80.toByte(); answer[7] = 1
        val good = UdpProtocol.udpPacket(dns, client, 53, 40123, answer)
        assertTrue(UdpProtocol.isDnsAnswer(good, 0x1D1D, dns))
        assertFalse("mauvais identifiant", UdpProtocol.isDnsAnswer(good, 0x1D1E, dns))
        assertFalse("mauvaise source", UdpProtocol.isDnsAnswer(good, 0x1D1D, UdpProtocol.parseIpv4("8.8.8.8")!!))
        assertFalse("une requête n'est pas une réponse", UdpProtocol.isDnsAnswer(UdpProtocol.udpPacket(dns, client, 53, 40123, q), 0x1D1D, dns))
        val noAnswer = answer.copyOf(); noAnswer[7] = 0
        assertFalse("sans enregistrement", UdpProtocol.isDnsAnswer(UdpProtocol.udpPacket(dns, client, 53, 40123, noAnswer), 0x1D1D, dns))
        val nx = answer.copyOf(); nx[3] = 0x83.toByte()
        assertFalse("RCODE non nul", UdpProtocol.isDnsAnswer(UdpProtocol.udpPacket(dns, client, 53, 40123, nx), 0x1D1D, dns))
    }
}
