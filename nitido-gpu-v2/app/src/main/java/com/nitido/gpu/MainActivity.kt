package com.nitido.gpu
import android.app.Activity
import android.os.Bundle
import android.graphics.Color
import android.view.Gravity
import android.widget.*
class MainActivity: Activity() {
 override fun onCreate(b: Bundle?) { super.onCreate(b)
  val box=LinearLayout(this); box.orientation=LinearLayout.VERTICAL; box.gravity=Gravity.CENTER; box.setPadding(40,40,40,40)
  val title=TextView(this); title.text="Nítido GPU\n2.26 Beta"; title.textSize=28f; title.gravity=Gravity.CENTER
  val info=TextView(this); info.text="Build Android funcionando.\nO pipeline está pronto para gerar o APK."; info.textSize=16f; info.gravity=Gravity.CENTER
  val btn=Button(this); btn.text="TESTAR"; btn.setOnClickListener { Toast.makeText(this,"Nítido GPU: teste OK",Toast.LENGTH_SHORT).show() }
  box.addView(title); box.addView(info); box.addView(btn); setContentView(box)
 }
}
