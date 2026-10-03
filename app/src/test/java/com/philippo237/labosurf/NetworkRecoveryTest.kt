package com.philippo237.labosurf

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NetworkRecoveryTest {
    private val minute = 60_000L
    private val t0 = 1_700_000_000_000L

    @Test fun neverRestartsWhenNoTunnelWasEverStopped() {
        assertFalse(NetworkRecovery.shouldRestart(0L, 0L, t0))
    }

    @Test fun restartsOnceAfterARecentStop() {
        assertTrue(NetworkRecovery.shouldRestart(t0, 0L, t0 + minute))
    }

    @Test fun doesNotRestartTwiceForTheSameStop() {
        // le redémarrage a été fait pour cet arrêt : jamais de boucle
        assertFalse(NetworkRecovery.shouldRestart(t0, t0, t0 + 2 * minute))
    }

    @Test fun restartsAgainForANewerStop() {
        assertTrue(NetworkRecovery.shouldRestart(t0 + 10 * minute, t0, t0 + 11 * minute))
    }

    @Test fun ignoresAStopOlderThanTheWindow() {
        // un panel hors service des heures plus tard n'est pas attribué à l'arrêt du tunnel
        assertTrue(NetworkRecovery.shouldRestart(t0, 0L, t0 + 30 * minute))
        assertFalse(NetworkRecovery.shouldRestart(t0, 0L, t0 + 30 * minute + 1))
        assertFalse(NetworkRecovery.shouldRestart(t0, 0L, t0 + 5 * 60 * minute))
    }

    @Test fun ignoresAnInconsistentClock() {
        assertFalse(NetworkRecovery.shouldRestart(t0, 0L, t0 - minute))
    }
}
