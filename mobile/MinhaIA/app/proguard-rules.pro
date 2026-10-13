# The JNI methods in llama.android use their JVM class/method names as native symbols.
# Preserve the adapter during minified release builds.
-keep class com.arm.aichat.internal.InferenceEngineImpl { *; }
-keep class com.arm.aichat.AiChat { *; }
