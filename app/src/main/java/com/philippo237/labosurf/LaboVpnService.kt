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

/**
 * LaboVpnService : le "moteur" du VPN.
 *
 * CE FICHIER EST UN SQUELETTE FONCTIONNEL (il cree bien un tunnel VPN Android
 * reconnu par le systeme, avec la petite icone de cle dans la barre de statut),
 * mais il ne fait PAS ENCORE transiter le trafic via Xray/VLESS. C'est l'etape
 * suivante, expliquee en bas de ce fichier et dans le README.
 *
 * Pourquoi separer les deux etapes :
 * 1) Cette base (VpnService Android) est indispensable et ne depend d'aucune
 *    librairie externe -> je peux l'ecrire et la verifier entierement ici.
 * 2) Le moteur Xray (le code qui chiffre/route reellement les paquets vers ton
 *    serveur VLESS) vient d'une librairie externe compilee (.aar) qu'il faut
 *    ajouter depuis Android Studio avec un acces Internet normal — impossible
 *    a faire depuis ce sandbox (reseau restreint). Voir le README du projet.
 */
class LaboVpnService : VpnService() {

    companion object {
        const val ACTION_START = "com.philippo237.labosurf.START"
        const val ACTION_STOP = "com.philippo237.labosurf.STOP"
        const val EXTRA_CONFIG = "server_config_json"
        private const val NOTIF_CHANNEL_ID = "labo_surf_vpn"
        private const val NOTIF_ID = 1

        // Permet a MainActivity d'etre notifiee des changements d'etat sans
        // passer par un vrai systeme de broadcast Android (plus simple pour ce
        // squelette ; a robustifier plus tard avec un BroadcastReceiver si besoin).
        var stateListener: ((state: String, detail: String?) -> Unit)? = null

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

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                val configJson = intent.getStringExtra(EXTRA_CONFIG)
                startTunnel(configJson)
            }
            ACTION_STOP -> stopTunnel()
        }
        return START_STICKY
    }

    private fun startTunnel(serverConfigJson: String?) {
        startForeground(NOTIF_ID, buildNotification())
        try {
            // ─── 1. Etablissement de l'interface VPN Android (le "tube") ───
            val builder = Builder()
                .setSession("Labo Surf")
                .addAddress("10.10.0.2", 32)   // adresse locale virtuelle du tunnel
                .addDnsServer("1.1.1.1")
                .addDnsServer("1.0.0.1")
                .addRoute("0.0.0.0", 0)        // route tout le trafic dans le tunnel

            tunInterface = builder.establish()

            // ─── 2. Brancher Xray ici (PROCHAINE ETAPE, pas encore fait) ───
            // C'est ici qu'on demarre le coeur Xray avec la config VLESS/XHTTP
            // recue depuis le panel (serverConfigJson), et qu'on lui passe le
            // file descriptor tunInterface pour qu'il lise/ecrive les paquets.
            // Exemple d'approche (a adapter selon la librairie choisie) :
            //
            //   val fd = tunInterface?.fd ?: throw IllegalStateException()
            //   XrayCore.start(fd, buildXrayConfigFrom(serverConfigJson))
            //
            // Tant que cette partie n'est pas branchee, le tunnel existe mais
            // ne fait rien passer : c'est pour ca qu'on doit faire cette etape
            // avant de considerer le VPN "fonctionnel".

            stateListener?.invoke("connected", null)
        } catch (e: Exception) {
            stateListener?.invoke("error", e.message ?: "Erreur inconnue")
            stopSelf()
        }
    }

    private fun stopTunnel() {
        try {
            tunInterface?.close()
        } catch (_: Exception) {
        }
        tunInterface = null
        stateListener?.invoke("disconnected", null)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onRevoke() {
        // Appele si l'utilisateur revoque la permission VPN depuis les reglages Android
        stopTunnel()
        super.onRevoke()
    }

    private fun buildNotification(): Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIF_CHANNEL_ID, "Labo Surf VPN", NotificationManager.IMPORTANCE_LOW
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
            .setContentText("Connexion sécurisée active")
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setContentIntent(openAppIntent)
            .setOngoing(true)
            .build()
    }
}
