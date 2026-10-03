package com.philippo237.labosurf

import android.content.Context

/**
 * Mémoire de l'arrêt du tunnel, pour la reprise réseau de la WebView (voir js/api.js).
 *
 * Constat terrain (v1.2.1) : après un STOP, la WebView garde un état réseau hérité du VPN et les requêtes de
 * l'interface échouent avant d'atteindre le panel, jusqu'au redémarrage du processus. Le dernier recours est donc de
 * redémarrer l'application — mais UNE SEULE fois par arrêt de tunnel (jamais de boucle), et seulement si l'arrêt est
 * récent : un panel réellement hors service des heures plus tard ne déclenche jamais de redémarrage.
 *
 * La décision pure (shouldRestart) est testable en JVM ; les lectures/écritures passent par des préférences privées.
 */
object NetworkRecovery {
    private const val PREFS = "labosurf_network"
    private const val KEY_STOPPED_AT = "vpn_stopped_at"
    private const val KEY_RESTARTED_FOR = "restarted_for_stop"

    /** Au-delà, l'échec n'est plus attribué à l'arrêt du tunnel. */
    const val WINDOW_MS = 30 * 60 * 1000L

    /**
     * stoppedAt : instant du dernier arrêt de tunnel (0 = jamais) ; restartedFor : l'arrêt pour lequel un redémarrage
     * a déjà eu lieu (0 = aucun) ; now : instant courant (millisecondes, horloge murale).
     */
    fun shouldRestart(stoppedAt: Long, restartedFor: Long, now: Long): Boolean =
        stoppedAt > 0L && stoppedAt > restartedFor && now >= stoppedAt && now - stoppedAt <= WINDOW_MS

    /** Appelé quand un tunnel qui avait été établi vient d'être fermé. */
    fun markStopped(context: Context, now: Long = System.currentTimeMillis()) {
        prefs(context).edit().putLong(KEY_STOPPED_AT, now).apply()
    }

    fun needsRestart(context: Context, now: Long = System.currentTimeMillis()): Boolean {
        val p = prefs(context)
        return shouldRestart(p.getLong(KEY_STOPPED_AT, 0L), p.getLong(KEY_RESTARTED_FOR, 0L), now)
    }

    /** Enregistre (de façon synchrone : le processus va être tué) que le redémarrage a eu lieu pour l'arrêt courant. */
    fun markRestarted(context: Context) {
        val p = prefs(context)
        p.edit().putLong(KEY_RESTARTED_FOR, p.getLong(KEY_STOPPED_AT, 0L)).commit()
    }

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
