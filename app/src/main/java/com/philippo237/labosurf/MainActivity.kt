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
            notifyWeb("error", "Permission VPN refusée")
        }
        pendingServerConfig = null
    }

    private var pendingServerConfig: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

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
        super.onDestroy()
    }

    /** Renvoie l'etat du tunnel vers le JS (window.onNativeVpnState(...)) */
    private fun notifyWeb(state: String, detail: String?) {
        runOnUiThread {
            val safeDetail = (detail ?: "").replace("'", "\\'")
            webView.evaluateJavascript("window.onNativeVpnState('$state', '$safeDetail')", null)
        }
    }

    /**
     * Pont expose au JavaScript de l'app (voir toggleConnection() dans index.html).
     * Toute methode appelable depuis le HTML doit porter @JavascriptInterface.
     */
    inner class NativeBridge {
        @JavascriptInterface
        fun startVpn(serverConfigJson: String) {
            Log.d(TAG, "startVpn appele depuis le JS : $serverConfigJson")
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

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }
}
