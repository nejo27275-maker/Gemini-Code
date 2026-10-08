plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android { namespace = "com.nitido.gpu"; compileSdk = 35
    defaultConfig { applicationId = "com.nitido.gpu"; minSdk = 26; targetSdk = 35; versionCode = 226; versionName = "2.26-beta" }
}
