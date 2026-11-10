plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "fr.w204.home"
    compileSdk = 34
    defaultConfig {
        applicationId = "fr.w204.home"
        minSdk = 24            // head units: Android 7+ covered, typical FYT units run 10–13
        targetSdk = 28         // private car app: 28 keeps WifiManager.setWifiEnabled() allowed (Wi-Fi forced on for the phone hotspot)
        versionCode = 2
        versionName = "0.2"
    }
    // The installed app is signed with this key (copy of the Mac's debug key, 2026-11-10). Keep it: without it, updates
    // can't install over the app (uninstall needed -> LED settings, service date and records lost). Back it up off the Mac.
    signingConfigs {
        create("w204") {
            storeFile = rootProject.file("signing/w204.keystore")
            storePassword = "android"; keyAlias = "androiddebugkey"; keyPassword = "android"
        }
    }
    // without signing/w204.keystore (public checkout) the standard debug key is used
    val ownKey = rootProject.file("signing/w204.keystore").exists()
    buildTypes {
        debug { if (ownKey) signingConfig = signingConfigs.getByName("w204") }
        release { isMinifyEnabled = false; if (ownKey) signingConfig = signingConfigs.getByName("w204") }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { buildConfig = true }
    // the web scene (built by `npm run build` in ../web) is packaged as assets/web
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("webassets"))
}

val copyWeb by tasks.registering(Copy::class) {
    val web = rootProject.file("../web/app")
    from(web) { include("index.html", "style.css", "dist/app.js", "assets/*.glb", "assets/*.jpg") }
    into(layout.buildDirectory.dir("webassets/web"))
}
tasks.named("preBuild") { dependsOn(copyWeb) }

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.webkit:webkit:1.11.0")
}
