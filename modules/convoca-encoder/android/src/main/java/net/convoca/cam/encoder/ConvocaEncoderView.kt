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

  /**
   * Avisado quando a superficie muda de TAMANHO.
   *
   * Existe porque o preview alterna entre miniatura de canto e tela grande. A
   * `SurfaceView` acompanha o container sozinha (MATCH_PARENT), mas a
   * RootEncoder fixa o viewport de GL no `startPreview` e nao descobre que a
   * view cresceu — a imagem continuava desenhada no tamanho antigo, encolhida
   * no canto de um retangulo preto.
   */
  var onSurfaceResized: ((largura: Int, altura: Int) -> Unit)? = null

  private var pronta = false

  val superficiePronta: Boolean get() = pronta

  init {
    surfaceView.holder.addCallback(object : SurfaceHolder.Callback {
      override fun surfaceCreated(holder: SurfaceHolder) {
        pronta = true
        onSurfaceReady?.invoke(true)
      }

      override fun surfaceChanged(holder: SurfaceHolder, format: Int, w: Int, h: Int) {
        onSurfaceResized?.invoke(w, h)
      }

      // CONTRATO DO ANDROID: depois que este metodo retorna, a superficie deixa
      // de valer. Quem desenha nela precisa parar AQUI DENTRO, de forma
      // sincrona. Seguir desenhando numa superficie morta derruba a thread de
      // GL — e o encoder vai junto, sem erro nenhum na tela.
      override fun surfaceDestroyed(holder: SurfaceHolder) {
        pronta = false
        onSurfaceReady?.invoke(false)
      }
    })
  }
}
