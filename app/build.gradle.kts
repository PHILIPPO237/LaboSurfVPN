plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.philippo237.labosurf"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.philippo237.labosurf"
        minSdk = 24        // Android 7.0+ (couvre la grande majorite des telephones au Cameroun)
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
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

    // ─── Moteur VPN (Xray) — A AJOUTER TOI-MEME QUAND TU OUVRES LE PROJET ───
    // Ce depot sandbox n'a pas acces a Internet librement (domaines restreints),
    // je ne peux donc pas verifier/telecharger la bonne version ici.
    // Exemple couramment utilise par les apps VLESS/Xray sous Android (a verifier/adapter) :
    // implementation("com.github.2dust:AndroidLibXrayLite:<version>")
    // Documentation a lire avant de choisir : https://github.com/2dust/AndroidLibXrayLite
}
