package com.philippo237.labosurf

import android.content.Intent
import android.net.Uri
import android.net.VpnService
import android.os.Bundle
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat

/**
 * MainActivity heberge l'interface Labo Surf (index.html, deja construite et
 * validee cote design) dans une WebView. Le HTML/CSS/JS ne change pas entre
 * la version PWA (navigateur) et cette version native : seule la presence de
 * window.LaboSurfNative differencie les deux (voir toggleConnection() dans
 * index.html).
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private val TAG = "LaboSurf"

    // Lance la boite de dialogue systeme Android ("Labo Surf souhaite configurer
    // une connexion VPN") — obligatoire, ce n'est pas quelque chose qu'on peut
    // sauter ou personnaliser : c'est une protection standard d'Android.
    private val vpnPermissionLauncher = registerForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == RESULT_OK) {
            LaboVpnService.start(this, pendingServerConfig)
        } else {
            notifyWeb("error", "vpn_permission_denied") // code traduit cote interface (js/vpn.js)
        }
        pendingServerConfig = null
    }

    private var pendingServerConfig: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Inspection de la WebView (chrome://inspect, test automatise sur emulateur) : versions DEBUG uniquement.
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)

        webView = findViewById(R.id.webview)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.webViewClient = ExternalLinkWebViewClient()
        webView.addJavascriptInterface(NativeBridge(), "LaboSurfNative")
        webView.loadUrl("file:///android_asset/www/index.html")

        // Ecoute les mises a jour d'etat envoyees par LaboVpnService (broadcast local)
        LaboVpnService.stateListener = { nativeState, detail ->
            notifyWeb(nativeState, detail)
        }
        // Trafic RÉELLEMENT mesuré par le moteur (octets qui ont traversé le tunnel) — jamais une estimation
        LaboVpnService.statsListener = { rx, tx, rxSpeed, txSpeed ->
            runOnUiThread {
                webView.evaluateJavascript("window.onNativeVpnStats($rx, $tx, $rxSpeed, $txSpeed)", null)
            }
        }
    }

    /**
     * Sans ceci, tout lien "target=_blank" (Telegram, canal, groupe, développeur...)
     * reste muet quand on appuie dessus : une WebView ne sait pas ouvrir une nouvelle
     * fenêtre toute seule. Ici on intercepte ces liens et on les ouvre soit dans
     * l'app Telegram (si installée), soit dans le navigateur du téléphone.
     */
    inner class ExternalLinkWebViewClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url.toString()
            // Les pages internes de l'app (assets locaux) restent gerees par la WebView elle-meme
            if (url.startsWith("file:///android_asset/")) return false
            return try {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                true
            } catch (e: Exception) {
                Log.e(TAG, "Impossible d'ouvrir le lien : $url", e)
                false
            }
        }
    }

    override fun onDestroy() {
        LaboVpnService.stateListener = null
        LaboVpnService.statsListener = null
        super.onDestroy()
    }

    /** Renvoie l'etat du tunnel vers le JS (window.onNativeVpnState(...)) */
    private fun notifyWeb(state: String, detail: String?) {
        runOnUiThread {
            // JSONObject.quote produit un litteral JS correctement echappe (guillemets, retours a la ligne...)
            val jsState = org.json.JSONObject.quote(state)
            val jsDetail = org.json.JSONObject.quote(detail ?: "")
            webView.evaluateJavascript("window.onNativeVpnState($jsState, $jsDetail)", null)
        }
    }

    /**
     * Pont expose au JavaScript de l'app (voir toggleConnection() dans index.html).
     * Toute methode appelable depuis le HTML doit porter @JavascriptInterface.
     */
    inner class NativeBridge {
        @JavascriptInterface
        fun startVpn(serverConfigJson: String) {
            // Ne jamais journaliser la configuration : elle contient les identifiants de connexion de l'utilisateur.
            Log.d(TAG, "startVpn appele depuis le JS (${serverConfigJson.length} caracteres)")
            if (!LaboVpnService.ENGINE_INTEGRATED) {
                // Inutile de demander l'autorisation VPN au système si aucun moteur ne peut transporter le trafic.
                notifyWeb("error", "engine_unavailable")
                return
            }
            val intent = VpnService.prepare(this@MainActivity)
            if (intent != null) {
                // Premiere utilisation (ou permission revoquee) : Android doit
                // demander confirmation a l'utilisateur avant d'autoriser le tunnel.
                pendingServerConfig = serverConfigJson
                vpnPermissionLauncher.launch(intent)
            } else {
                // Permission deja accordee precedemment
                LaboVpnService.start(this@MainActivity, serverConfigJson)
            }
        }

        @JavascriptInterface
        fun stopVpn() {
            Log.d(TAG, "stopVpn appele depuis le JS")
            LaboVpnService.stop(this@MainActivity)
        }

        /** Ouvre les reglages VPN d'Android (VPN permanent, blocage des connexions hors VPN = kill switch). */
        @JavascriptInterface
        fun openVpnSettings() {
            runOnUiThread {
                try {
                    startActivity(Intent(android.provider.Settings.ACTION_VPN_SETTINGS))
                } catch (e: Exception) {
                    Log.e(TAG, "Impossible d'ouvrir les reglages VPN", e)
                }
            }
        }

        /**
         * Capacites REELLES du moteur natif, lues par js/vpn.js AVANT tout appel au backend :
         * { "integrated": bool, "protocols": ["tuic", ...] }. Tant que le moteur n'est pas branche
         * (LaboVpnService.ENGINE_INTEGRATED = false), l'interface ne demande aucune configuration au panel
         * (un tel appel cree un Access et peut consommer l'essai de l'appareil) et n'annonce jamais « connecte ».
         */
        @JavascriptInterface
        fun getEngineInfo(): String {
            val protocols = org.json.JSONArray()
            LaboVpnService.SUPPORTED_PROTOCOLS.forEach { protocols.put(it) }
            return org.json.JSONObject()
                .put("integrated", LaboVpnService.ENGINE_INTEGRATED)
                .put("protocols", protocols)
                .toString()
        }

        /**
         * Adresse de l'API du Laboratoire du Free-Surf, fixee A LA COMPILATION (BuildConfig.PANEL_BASE_URL,
         * voir app/build.gradle.kts). Le contenu web ne peut pas la remplacer. HTTPS obligatoire (js/contract.js).
         */
        @JavascriptInterface
        fun getApiBase(): String = BuildConfig.PANEL_BASE_URL

        /** Version affichee dans Reglages > Application. */
        @JavascriptInterface
        fun getAppVersion(): String = try {
            packageManager.getPackageInfo(packageName, 0).versionName ?: ""
        } catch (e: Exception) {
            ""
        }

        /** Aligne barre d'etat / de navigation Android sur le theme de l'interface (js/theme.js). */
        @JavascriptInterface
        fun setSystemBars(dark: Boolean) {
            runOnUiThread {
                val color = android.graphics.Color.parseColor(if (dark) "#03100a" else "#F3F6F2")
                window.statusBarColor = color
                window.navigationBarColor = color
                webView.setBackgroundColor(color)
                val controller = WindowCompat.getInsetsController(window, webView)
                controller.isAppearanceLightStatusBars = !dark
                controller.isAppearanceLightNavigationBars = !dark
            }
        }

        /** Journal et cache > Vider le cache : vide le cache web (images de banniere, fichiers). Ne touche ni au compte ni aux reglages. */
        @JavascriptInterface
        fun clearWebCache() {
            runOnUiThread { webView.clearCache(true) }
        }

        @JavascriptInterface
        fun getDeviceId(): String {
            // Identifiant d'appareil stable (survit a la desinstallation/reinstallation
            // de l'app, contrairement a un simple stockage JS) -- utilise uniquement
            // pour l'anti-abus de l'essai gratuit limite dans le temps (voir
            // app/routers/user.py::_check_trial_abuse cote panel). Ne sert a rien
            // d'autre, jamais transmis en dehors de cet usage.
            return try {
                android.provider.Settings.Secure.getString(
                    contentResolver, android.provider.Settings.Secure.ANDROID_ID
                ) ?: ""
            } catch (e: Exception) {
                Log.e(TAG, "Impossible de lire ANDROID_ID", e)
                ""
            }
        }
    }

    /**
     * Retour Android : l'interface gere d'abord (fermer un dialogue, revenir a l'accueil),
     * sinon comportement par defaut (voir window.LaboBack dans js/app.js).
     */
    @Suppress("OVERRIDE_DEPRECATION")
    override fun onBackPressed() {
        webView.evaluateJavascript("(window.LaboBack ? window.LaboBack() : false)") { handled ->
            if (handled != "true") defaultBack()
        }
    }

    @Suppress("DEPRECATION")
    private fun defaultBack() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }
}

