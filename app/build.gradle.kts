plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Adresse de l'API du Laboratoire du Free-Surf, fixee a la compilation (lue par l'interface via
// LaboSurfNative.getApiBase()). HTTPS obligatoire ; jamais de secret ici. Changer sans modifier le code :
//   gradle assembleDebug -PlabosurfPanelBaseUrl=https://mon-panel.exemple
// Valeur par defaut VERIFIEE le 2026-09-28 : https://laboratoire.free-surf237-4all.xyz repond en HTTPS valide (/health = 200).
// L'ancienne valeur app.laboratoire.free-surf237-4all.xyz echoue au TLS (le certificat Cloudflare ne couvre pas
// deux niveaux de sous-domaine) : l'APK v1.2.0 ne pouvait joindre aucun panel.
val panelBaseUrl: String = (project.findProperty("labosurfPanelBaseUrl") as String?)
    ?: "https://laboratoire.free-surf237-4all.xyz"

android {
    namespace = "com.philippo237.labosurf"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.philippo237.labosurf"
        minSdk = 24        // Android 7.0+ (couvre la grande majorite des telephones au Cameroun)
        targetSdk = 34
        versionCode = 4
        versionName = "1.2.1"
        buildConfigField("String", "PANEL_BASE_URL", "\"$panelBaseUrl\"")
    }

    buildFeatures {
        buildConfig = true
    }

    // Signature de PRODUCTION : lue UNIQUEMENT dans l'environnement (secrets GitHub dans la CI, voir
    // .github/workflows/release-apk.yml). Aucun keystore ni mot de passe dans le depot. Sans ces variables,
    // le build release n'est pas signe (et la CI de release echoue : jamais d'APK signe avec une autre cle).
    val releaseKeystore: String? = System.getenv("LABOSURF_KEYSTORE_FILE")
    signingConfigs {
        if (releaseKeystore != null && file(releaseKeystore).exists()) {
            create("release") {
                storeFile = file(releaseKeystore)
                storeType = "pkcs12"
                storePassword = System.getenv("LABOSURF_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("LABOSURF_KEY_ALIAS")
                keyPassword = System.getenv("LABOSURF_KEY_PASSWORD")
                enableV1Signing = true   // Android 7.0 (minSdk 24) verifie aussi le schema v1
                enableV2Signing = true
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfigs.findByName("release")?.let { signingConfig = it }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.16.0")   // API WebView modernes (evaluateJavascript, etc.)

    // Tests unitaires JVM du moteur UDP (app/src/test) : `gradle testDebugUnitTest`
    testImplementation("junit:junit:4.13.2")

    // Moteur VPN : UDP LABOSURF PRO, implémenté en Kotlin pur (app/src/main/java/.../udp) — aucune bibliothèque externe.
    // Les autres moteurs (Xray, Hysteria, TUIC, WireGuard...) ne sont PAS intégrés : voir docs/LABOSURFVPN_REAL_FUNCTIONALITY.md.
}
