package com.philippo237.labosurf

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import androidx.core.app.NotificationCompat
import com.philippo237.labosurf.udp.UdpLink
import com.philippo237.labosurf.udp.UdpTunnelClient
import java.io.FileInputStream
import java.io.FileOutputStream

/**
 * LaboVpnService : le moteur VPN Android.
 *
 * Moteur réellement intégré : UDP (protocole LABOSURF PRO, voir udp/UdpTunnelClient.kt et PROTOCOL.md de LABOSURF_PRO).
 * Les autres protocoles (xray, hysteria, tuic, wireguard, ssh, slowdns, dnstt...) NE SONT PAS intégrés : ils sont refusés
 * (`unsupported_protocol`), jamais simulés. Voir docs/LABOSURFVPN_REAL_FUNCTIONALITY.md.
 *
 * « connected » n'est émis QU'APRÈS : handshake réussi + vraie requête DNS aller-retour à travers le tunnel + interface TUN établie.
 * ⚠ Le protocole UDP LABOSURF ne chiffre pas le trafic IP (limitation documentée du protocole).
 */
class LaboVpnService : VpnService() {

    companion object {
        const val ACTION_START = "com.philippo237.labosurf.START"
        const val ACTION_STOP = "com.philippo237.labosurf.STOP"
        const val EXTRA_CONFIG = "server_config_json"

        /** true : un moteur réel est intégré (UDP). Voir SUPPORTED_PROTOCOLS pour ce qu'il sait transporter. */
        const val ENGINE_INTEGRATED = true

        /** Protocoles (champ « protocol » de la configuration émise par PRO) que le moteur intégré sait REELLEMENT transporter. */
        val SUPPORTED_PROTOCOLS: List<String> = listOf("udp")

        const val STATE_CONNECTING = "connecting"
        const val STATE_CONNECTED = "connected"
        const val STATE_STOPPING = "stopping"
        const val STATE_DISCONNECTED = "disconnected"
        const val STATE_ERROR = "error"
        private const val NOTIF_CHANNEL_ID = "labo_surf_vpn"
        private const val NOTIF_ID = 1

        /** MainActivity est notifiée des changements d'état (jamais de secret dans `detail` : un code stable ou vide). */
        var stateListener: ((state: String, detail: String?) -> Unit)? = null

        /** Trafic RÉELLEMENT mesuré à travers le tunnel : (octets reçus, octets envoyés, débit reçu, débit envoyé en octets/s). */
        var statsListener: ((rx: Long, tx: Long, rxSpeed: Long, txSpeed: Long) -> Unit)? = null

        fun start(context: Context, serverConfigJson: String?) {
            val intent = Intent(context, LaboVpnService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_CONFIG, serverConfigJson)
            }
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, LaboVpnService::class.java).apply {
                action = ACTION_STOP
            }
            context.startService(intent)
        }
    }

    private var tunInterface: ParcelFileDescriptor? = null
    private var client: UdpTunnelClient? = null
    private var worker: Thread? = null
    private var statsThread: Thread? = null

    @Volatile private var generation = 0   // invalide les callbacks d'une connexion abandonnée

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> startTunnel(intent.getStringExtra(EXTRA_CONFIG))
            ACTION_STOP -> stopTunnel()
        }
        return START_NOT_STICKY
    }

    private fun fail(code: String) {
        stateListener?.invoke(STATE_ERROR, code)
        teardown()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun startTunnel(serverConfigJson: String?) {
        startForeground(NOTIF_ID, buildNotification())
        teardown()   // une seule connexion à la fois

        // Configuration reçue de l'interface : { name, proto, uri, format } — ne JAMAIS la journaliser (secrets).
        val proto: String
        val uri: String
        try {
            val cfg = org.json.JSONObject(serverConfigJson ?: "")
            proto = cfg.optString("proto").lowercase()
            uri = cfg.optString("uri")
            require(uri.isNotBlank())
        } catch (e: Exception) {
            fail("invalid_config"); return
        }
        if (proto !in SUPPORTED_PROTOCOLS) { fail("unsupported_protocol"); return }
        val link = try { UdpLink.parse(uri) } catch (e: UdpLink.Invalid) { fail("invalid_config"); return }

        val myGeneration = ++generation
        stateListener?.invoke(STATE_CONNECTING, null)
        val udp = UdpTunnelClient(link, protect = { protect(it) })
        client = udp
        worker = Thread({
            try {
                val session = udp.connect()
                udp.verifyPath()                       // une vraie requête DNS traverse le tunnel : sinon PAS de « connecté »
                if (myGeneration != generation) { udp.stop(); return@Thread }
                val builder = Builder()
                    .setSession("Labo Surf")
                    .addAddress(session.tunnelIp, 32)
                    .addRoute("0.0.0.0", 0)            // tout l'IPv4 dans le tunnel
                    .addRoute("::", 0)                 // l'IPv6 est capté puis abandonné (le serveur est IPv4) : aucune fuite
                    .addDnsServer("1.1.1.1")
                    .addDnsServer("8.8.8.8")
                    .setMtu(1380)
                    .setBlocking(true)
                val pfd = builder.establish()
                if (pfd == null) { udp.stop(); fail("vpn_permission_denied"); return@Thread }
                tunInterface = pfd
                udp.start(FileInputStream(pfd.fileDescriptor), FileOutputStream(pfd.fileDescriptor)) { code ->
                    if (myGeneration == generation) { stateListener?.invoke(STATE_ERROR, code ?: "tunnel_closed"); teardown(); stopForeground(STOP_FOREGROUND_REMOVE); stopSelf() }
                }
                startStats(udp, myGeneration)
                stateListener?.invoke(STATE_CONNECTED, null)
            } catch (f: UdpTunnelClient.Failure) {
                if (myGeneration == generation) fail(f.code)
            } catch (e: Exception) {
                if (myGeneration == generation) fail("connect_failed")
            }
        }, "labosurf-connect")
        worker?.isDaemon = true
        worker?.start()
    }

    private fun startStats(udp: UdpTunnelClient, myGeneration: Int) {
        statsThread = Thread({
            var lastRx = 0L
            var lastTx = 0L
            try {
                while (myGeneration == generation) {
                    Thread.sleep(1000)
                    val rx = udp.rxBytes.get()
                    val tx = udp.txBytes.get()
                    statsListener?.invoke(rx, tx, rx - lastRx, tx - lastTx)
                    lastRx = rx; lastTx = tx
                }
            } catch (e: InterruptedException) {
            }
        }, "labosurf-stats")
        statsThread?.isDaemon = true
        statsThread?.start()
    }

    /** Arrête proprement tout ce qui tourne (sans notifier l'interface). */
    private fun teardown() {
        generation++
        try { client?.stop() } catch (_: Exception) { }
        client = null
        try { tunInterface?.close() } catch (_: Exception) { }
        tunInterface = null
        worker?.interrupt(); worker = null
        statsThread?.interrupt(); statsThread = null
    }

    private fun stopTunnel() {
        stateListener?.invoke(STATE_STOPPING, null)
        teardown()
        stateListener?.invoke(STATE_DISCONNECTED, null)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onRevoke() {
        // Appelé si l'utilisateur révoque la permission VPN depuis les réglages Android
        stopTunnel()
        super.onRevoke()
    }

    override fun onDestroy() {
        teardown()
        super.onDestroy()
    }

    private fun buildNotification(): Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIF_CHANNEL_ID, getString(R.string.notif_channel), NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
        val openAppIntent = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, NOTIF_CHANNEL_ID)
            .setContentTitle("Labo Surf")
            .setContentText(getString(R.string.notif_active))
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setContentIntent(openAppIntent)
            .setOngoing(true)
            .build()
    }
}
