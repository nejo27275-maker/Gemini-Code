package com.nitido.gpu

import android.content.Context
import android.content.Intent

data class Config(
    val scale: Float = 1f,
    val sharp: Float = .05f,
    val aa: Float = 1f,
    val touch: Boolean = true,
    val precise: Boolean = false,
    val thermal: Boolean = true
) {
    fun putInto(i: Intent): Intent = i
        .putExtra(K_SCALE, scale).putExtra(K_SHARP, sharp).putExtra(K_AA, aa)
        .putExtra(K_TOUCH, touch).putExtra(K_PRECISE, precise).putExtra(K_THERMAL, thermal)

    fun save(c: Context) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putInt("scale", ((scale - .5f) * 100f + .5f).toInt()).putInt("aa", (aa * 100f + .5f).toInt())
            .putInt("sharp", (sharp * 100f + .5f).toInt())
            .putBoolean("touch", touch).putBoolean("precise", precise).putBoolean("thermal", thermal).apply()
    }

    companion object {
        const val PREFS = "nitido"
        const val K_SCALE = "scale"; const val K_SHARP = "sharp"; const val K_AA = "aa"
        const val K_TOUCH = "touch"; const val K_PRECISE = "precise"; const val K_LAST_ERROR = "lastError"
        const val K_THERMAL = "thermal"

        fun from(i: Intent) = Config(
            scale = i.getFloatExtra(K_SCALE, 1f).coerceIn(.5f, 1f),
            sharp = i.getFloatExtra(K_SHARP, .05f).coerceIn(0f, 1f),
            aa = i.getFloatExtra(K_AA, 1f).coerceIn(0f, 1f),
            touch = i.getBooleanExtra(K_TOUCH, true),
            precise = i.getBooleanExtra(K_PRECISE, false),
            thermal = i.getBooleanExtra(K_THERMAL, true)
        )

        fun load(c: Context): Config {
            val p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            return Config(
                scale = (50 + p.getInt("scale", 50)) / 100f, sharp = p.getInt("sharp", 5) / 100f, aa = p.getInt("aa", 100) / 100f,
                touch = p.getBoolean("touch", true), precise = p.getBoolean("precise", NitidoAccessibility.instance != null),
                thermal = p.getBoolean("thermal", true)
            )
        }
    }
}