plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }

android {
    namespace = "com.nitido.gpu"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.nitido.gpu"
        minSdk = 30
        targetSdk = 34
        versionCode = 26
        versionName = "2.26"
    }

    buildTypes {
        debug { }
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    lint { abortOnError = false }
}
