package net.convoca.cam.encoder

import android.graphics.Bitmap
import android.graphics.Canvas
import com.caverock.androidsvg.SVG

/**
 * Transforma o SVG do placar num Bitmap para a RootEncoder sobrepor.
 *
 * POR QUE ISSO EXISTE. O layout do placar mora em TypeScript
 * (`src/overlay/scoreboard.ts`), e e de la que sai tanto o overlay do celular
 * quanto o do burn no desktop. Uma implementacao so, dois destinos.
 *
 * O que forcou esta classe: `@resvg/resvg-js`, o rasterizador do desktop, e
 * modulo nativo do Node e nao roda no React Native. Alguem tem de rasterizar
 * dentro do aparelho, e esse alguem e aqui.
 *
 * POR QUE E UMA INTERFACE. O `androidsvg` resolve, mas parou em 2019 e eu nao
 * consegui verificar o resultado dele antes de gastar uma das 15 builds
 * mensais. Se ele engasgar com algum atributo, trocar por desenho direto em
 * `Canvas` e implementar esta interface de novo — nao e refazer o modulo.
 *
 * O SVG ja vem do tamanho do quadro inteiro, com o placar posicionado dentro
 * dele. Entao aqui nao ha calculo de layout nenhum, e do lado da RootEncoder o
 * filtro fica em escala 100% e posicao 0,0.
 */
interface OverlayRasterizer {
  /**
   * @param svg documento SVG completo
   * @param width largura do quadro de video, em pixels
   * @param height altura do quadro de video, em pixels
   */
  fun render(svg: String, width: Int, height: Int): Bitmap
}

class AndroidSvgRasterizer : OverlayRasterizer {

  override fun render(svg: String, width: Int, height: Int): Bitmap {
    require(width > 0 && height > 0) { "Dimensoes invalidas: ${width}x$height" }

    val doc = SVG.getFromString(svg)
    // O SVG declara width/height proprios; forcar aqui garante que o bitmap
    // tenha exatamente o tamanho do quadro, mesmo que o documento minta.
    doc.documentWidth = width.toFloat()
    doc.documentHeight = height.toFloat()

    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    // Nada de fundo: o que nao e placar tem de sair transparente, senao o
    // overlay cobriria a imagem da camera.
    doc.renderToCanvas(canvas)
    return bitmap
  }
}
