pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // JitPack : necessaire pour la librairie du moteur Xray (voir README, etape 2)
        maven { url = uri("https://jitpack.io") }
    }
}

rootProject.name = "LaboSurfVPN"
include(":app")
