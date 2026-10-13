pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories { google(); mavenCentral() }
}
rootProject.name = "MinhaIA"
val llamaLibrary = file("external/llama.cpp/examples/llama.android/lib")
if (!llamaLibrary.isDirectory) {
    throw GradleException("Dependência nativa ausente. Execute: bash scripts/bootstrap-llama.sh")
}
include(":app", ":llamaLib")
project(":llamaLib").projectDir = llamaLibrary
