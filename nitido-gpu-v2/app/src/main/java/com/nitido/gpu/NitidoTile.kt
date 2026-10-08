package com.nitido.gpu

import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

class NitidoTile : TileService() {
    override fun onStartListening() { refresh() }

    override fun onClick() {
        if (ScalerService.running) {
            stopService(Intent(this, ScalerService::class.java))
        } else {
            val i = Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("autostart", true)
            if (Build.VERSION.SDK_INT >= 34) startActivityAndCollapse(PendingIntent.getActivity(this, 2, i, PendingIntent.FLAG_IMMUTABLE))
            else collapseLegacy(i)
        }
    }

    @Suppress("DEPRECATION")
    private fun collapseLegacy(i: Intent) { startActivityAndCollapse(i) }

    private fun refresh() {
        val t = qsTile ?: return
        t.state = if (ScalerService.running) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        t.updateTile()
    }
}