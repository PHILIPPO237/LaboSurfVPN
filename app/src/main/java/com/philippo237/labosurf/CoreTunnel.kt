package com.philippo237.labosurf

/**
 * Pont vers le cœur réseau Go `labocore` (bibliothèque AAR compilée par gomobile, voir core/ et
 * docs/ARCHITECTURE_MULTI_MOTEURS.md) : tous les moteurs autres que l'UDP LABOSURF, qui garde son
 * implémentation Kotlin (udp/).
 *
 * Chargé à la demande : si la bibliothèque native est absente (tests JVM), aucun moteur n'est annoncé
 * — jamais un moteur présumé disponible.
 */
object CoreTunnel {

    /** Moteurs que le cœur embarqué sait RÉELLEMENT transporter ; vide si la bibliothèque est absente. */
    val engines: List<String> by lazy {
        try {
            labocore.Labocore.engines().split(",").map { it.trim().lowercase() }.filter { it.isNotEmpty() }
        } catch (e: Throwable) {
            emptyList()
        }
    }

    /** Démarre le moteur décrit par la configuration du Panel sur l'interface TUN déjà établie. */
    fun start(configJson: String, tunFd: Int, mtu: Int) {
        labocore.Labocore.start(configJson, tunFd.toLong(), mtu.toLong())
    }

    /** Vraie requête DNS à travers le moteur : lève une exception si le trafic ne passe pas. */
    fun probe() {
        labocore.Labocore.probe()
    }

    fun stop() {
        try { labocore.Labocore.stop() } catch (_: Throwable) { }
    }

    /** (octets reçus, octets envoyés) réellement mesurés par le cœur ; null si indisponible. */
    fun stats(): Pair<Long, Long>? = try {
        val o = org.json.JSONObject(labocore.Labocore.stats())
        if (o.optBoolean("running")) Pair(o.getLong("rx"), o.getLong("tx")) else null
    } catch (e: Throwable) {
        null
    }
}
