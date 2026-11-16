package com.philippo237.labosurf.udp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.fail
import org.junit.Test

class UdpLinkTest {
    @Test fun parsesTheLinkEmittedByPro() {
        val l = UdpLink.parse("udp://fs-u4101@162.248.100.115:5667?pass=abcDEF123_-xyz")
        assertEquals("fs-u4101", l.username)
        assertEquals("162.248.100.115", l.host)
        assertEquals(5667, l.port)
        assertEquals("abcDEF123_-xyz", l.password)
    }

    @Test fun parsesUserinfoPasswordLinkEmittedByHarmonizedPro() {
        val direct = UdpLink.parse("udp://test_udp:LaboSurf2026!@162.248.100.115:5667")
        assertEquals("test_udp", direct.username)
        assertEquals("162.248.100.115", direct.host)
        assertEquals(5667, direct.port)
        assertEquals("LaboSurf2026!", direct.password)

        val encoded = UdpLink.parse("udp://test_udp:LaboSurf2026%21@162.248.100.115:5667")
        assertEquals("test_udp", encoded.username)
        assertEquals("162.248.100.115", encoded.host)
        assertEquals(5667, encoded.port)
        assertEquals("LaboSurf2026!", encoded.password)
    }

    @Test fun percentEncodingIsDecodedButPlusStaysPlus() {
        assertEquals("a+b c%", UdpLink.parse("udp://u@h.example:1?pass=a+b%20c%25").password)
        assertEquals("100%", UdpLink.parse("udp://u@h.example:1?pass=100%").password)   // « % » orphelin conservé
    }

    @Test fun ignoresFragmentAndOtherParameters() {
        val l = UdpLink.parse("udp://u@h.example:443?x=1&pass=secret&y=2#LABOSURF")
        assertEquals("secret", l.password)
        assertEquals(443, l.port)
    }

    @Test fun rejectsAnythingThatIsNotAWellFormedUdpLink() {
        for (bad in listOf("", "   ", "tuic://u:p@h:1", "udp://h:5667?pass=x", "udp://u@h?pass=x", "udp://u@h:0?pass=x", "udp://u@h:70000?pass=x",
            "udp://u@h:abc?pass=x", "udp://u@:5667?pass=x", "udp://u@h:5667", "udp://u@h:5667?pass=", "udp://@h:5667?pass=x")) {
            try { UdpLink.parse(bad); fail("accepté à tort : $bad") } catch (e: UdpLink.Invalid) { }
        }
        try { UdpLink.parse(null); fail() } catch (e: UdpLink.Invalid) { }
    }

    @Test fun neverExposesThePasswordInToStringOrErrors() {
        val l = UdpLink.parse("udp://u@h.example:5667?pass=SuperSecret")
        assertFalse(l.toString().contains("SuperSecret"))
        assertEquals("udp://u@h.example:5667", l.toString())
        try { UdpLink.parse("udp://u@h:99999?pass=SuperSecret") } catch (e: UdpLink.Invalid) { assertFalse(e.message!!.contains("SuperSecret")) }
    }
}
