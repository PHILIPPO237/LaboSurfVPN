package com.philippo237.labosurf

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ExchangeLinkTest {
    private val host = "laboratoire.free-surf237-4all.xyz"
    private val code = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE"   // 43 caracteres base64url, comme secrets.token_urlsafe(32)

    @Test fun appLinkWithTheCodeInTheFragmentIsAccepted() {
        assertEquals(code, ExchangeLink.extract("https", host, "/app/open", "code=$code", null, host))
    }

    @Test fun chromeIntentWithTheCodeInTheExtraIsAccepted() {
        assertEquals(code, ExchangeLink.extract("https", host, "/app/open", null, code, host))
    }

    @Test fun hostIsComparedWithoutCaseButMustBeThePanel() {
        assertEquals(code, ExchangeLink.extract("https", host.uppercase(), "/app/open", "code=$code", null, host))
        assertNull(ExchangeLink.extract("https", "evil.example", "/app/open", "code=$code", null, host))
        assertNull(ExchangeLink.extract("https", "$host.evil.example", "/app/open", "code=$code", null, host))
    }

    @Test fun onlyHttpsAndOnlyTheAppOpenPath() {
        assertNull(ExchangeLink.extract("http", host, "/app/open", "code=$code", null, host))
        assertNull(ExchangeLink.extract("labosurf", host, "/app/open", "code=$code", null, host))
        assertNull(ExchangeLink.extract("https", host, "/dashboard", "code=$code", null, host))
        assertNull(ExchangeLink.extract("https", host, "/app/openx", "code=$code", null, host))
    }

    @Test fun malformedOrMissingCodesAreRefused() {
        assertNull(ExchangeLink.extract("https", host, "/app/open", null, null, host))
        assertNull(ExchangeLink.extract("https", host, "/app/open", "code=court", null, host))
        assertNull(ExchangeLink.extract("https", host, "/app/open", null, "<script>alert(1)</script>", host))
        assertNull(ExchangeLink.extract("https", host, "/app/open", null, "a".repeat(101), host))
    }

    @Test fun noPanelAddressCompiledMeansNothingIsAccepted() {
        assertNull(ExchangeLink.extract("https", host, "/app/open", "code=$code", null, ""))
    }
}
