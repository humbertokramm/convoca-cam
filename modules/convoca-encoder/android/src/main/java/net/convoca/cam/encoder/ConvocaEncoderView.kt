package net.convoca.cam.encoder

import android.content.Context
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.ViewGroup
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * A view de preview. Hospeda o `SurfaceView` que a RootEncoder desenha.
 *
 * POR QUE A VIEW NAO E DONA DO ENCODER. O encoder sobrevive a esta view: se o
 * React remonta a arvore, ou o app vai pro fundo e volta, o stream nao pode
 * cair junto. Entao o dono e o modulo, e a view apenas empresta a superficie.
 *
 * O `SurfaceHolder.Callback` existe porque `startPreview` precisa de superficie
 * VIVA. Pedir preview antes de o `surfaceCreated` chegar falha silenciosamente
 * — tela preta, sem erro. Daí a view avisar quando esta pronta, em vez de o
 * JavaScript adivinhar o momento.
 */
class ConvocaEncoderView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext) {

  val surfaceView = SurfaceView(context).also {
    it.layoutParams = ViewGroup.LayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT,
      ViewGroup.LayoutParams.MATCH_PARENT,
    )
    addView(it)
  }

  /** Avisado quando a superficie fica utilizavel, e quando deixa de ser. */
  var onSurfaceReady: ((pronta: Boolean) -> Unit)? = null

  private var pronta = false

  val superficiePronta: Boolean get() = pronta

  init {
    surfaceView.holder.addCallback(object : SurfaceHolder.Callback {
      override fun surfaceCreated(holder: SurfaceHolder) {
        pronta = true
        onSurfaceReady?.invoke(true)
      }

      override fun surfaceChanged(holder: SurfaceHolder, format: Int, w: Int, h: Int) = Unit

      override fun surfaceDestroyed(holder: SurfaceHolder) {
        pronta = false
        onSurfaceReady?.invoke(false)
      }
    })
  }
}
