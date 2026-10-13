package com.philippo237.labosurf

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** « Rester connecté » : seule une session valide du Panel est gardée ; rien d'expiré, rien de mal formé. */
class SessionVaultTest {
    private val now = 1_800_000_000_000L
    private val token = "Ab3_dE-fGhIjKlMnOpQrStUvWxYz0123456789abcd"   // forme de secrets.token_urlsafe(32)

    @Test
    fun savesOnlyAValidTokenWithAFutureExpiry() {
        assertTrue(SessionVault.Payload.isSavable(token, (now + 60_000).toDouble(), now))
        assertFalse("expirée", SessionVault.Payload.isSavable(token, (now - 1).toDouble(), now))
        assertFalse("expiration inconnue", SessionVault.Payload.isSavable(token, Double.NaN, now))
        assertFalse("vide", SessionVault.Payload.isSavable("", (now + 60_000).toDouble(), now))
        assertFalse("null", SessionVault.Payload.isSavable(null, (now + 60_000).toDouble(), now))
        assertFalse("caractères interdits", SessionVault.Payload.isSavable("abc def\nghijklmnopqrstuvwxyz", (now + 60_000).toDouble(), now))
        assertFalse("trop court", SessionVault.Payload.isSavable("abc", (now + 60_000).toDouble(), now))
    }

    @Test
    fun roundTripAndExpiry() {
        val enc = SessionVault.Payload.encode(token, now + 60_000)
        assertEquals(Pair(token, now + 60_000), SessionVault.Payload.decode(enc, now))
        assertNull("expirée entre-temps", SessionVault.Payload.decode(enc, now + 120_000))
        assertNull(SessionVault.Payload.decode("n'importe quoi", now))
        assertNull(SessionVault.Payload.decode("$token\nabc", now))
        assertNull(SessionVault.Payload.decode(null, now))
    }
}
