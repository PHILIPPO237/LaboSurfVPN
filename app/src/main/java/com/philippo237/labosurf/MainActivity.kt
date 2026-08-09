package com.philippo237.labosurf

import android.content.Intent
import android.net.VpnService
import android.os.Bundle
import android.util.Log
import android.webkit.JavascriptInterface
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
        webView.webViewClient = WebViewClient()
        webView.addJavascriptInterface(NativeBridge(), "LaboSurfNative")
        webView.loadUrl("file:///android_asset/www/index.html")

        // Ecoute les mises a jour d'etat envoyees par LaboVpnService (broadcast local)
        LaboVpnService.stateListener = { nativeState, detail ->
            notifyWeb(nativeState, detail)
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
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }
}
