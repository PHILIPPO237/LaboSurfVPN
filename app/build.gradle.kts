plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Adresse de l'API du Laboratoire du Free-Surf, fixee a la compilation (lue par l'interface via
// LaboSurfNative.getApiBase()). HTTPS obligatoire ; jamais de secret ici. Changer sans modifier le code :
//   gradle assembleDebug -PlabosurfPanelBaseUrl=https://mon-panel.exemple
// La valeur par defaut est la « topologie de reference » du panel (docs/guides/LOCAL_ENV_SETUP.md : « App publique ») :
// A CONFIRMER avant une diffusion (voir docs/AUDIT_LABOSURFVPN.md).
val panelBaseUrl: String = (project.findProperty("labosurfPanelBaseUrl") as String?)
    ?: "https://app.laboratoire.free-surf237-4all.xyz"

android {
    namespace = "com.philippo237.labosurf"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.philippo237.labosurf"
        minSdk = 24        // Android 7.0+ (couvre la grande majorite des telephones au Cameroun)
        targetSdk = 34
        versionCode = 2
        versionName = "1.1.0"
        buildConfigField("String", "PANEL_BASE_URL", "\"$panelBaseUrl\"")
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
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
