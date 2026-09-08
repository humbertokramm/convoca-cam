package net.convoca.cam.encoder

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * A ponte entre o TypeScript e a RootEncoder.
 *
 * A superficie e pequena de proposito: preparar, preview, transmitir, gravar,
 * trocar o placar. Toda a inteligencia — ler o convoca, decidir o que o placar
 * diz, o canal do controle remoto — mora em TypeScript, onde ja esta escrita e
 * testada. Aqui so passa o que precisa de hardware.
 *
 * As funcoes sao `AsyncFunction` e nao `Function` porque `prepare` conversa com
 * a camera e com o encoder de hardware: bloquear a thread de JS nisso travaria
 * a interface justamente no momento em que o operador esta olhando pra ela.
 */
class ConvocaEncoderModule : Module() {

  private var encoder: Encoder? = null
  private var view: ConvocaEncoderView? = null

  /** Preview pedido antes de a superficie existir — reaplicado quando ela vier. */
  private var previewPendente = false

  override fun definition() = ModuleDefinition {
    Name("ConvocaEncoder")

    // `status` carrega o que vem do ConnectChecker da RootEncoder: conectado,
    // conexao_falhou, bitrate, gravacao. E o unico jeito de o JS saber que a
    // transmissao caiu.
    Events("onStatus", "onSurface")

    OnCreate {
      encoder = Encoder(
        context = appContext.reactContext ?: throw IllegalStateException("sem contexto"),
        rasterizer = AndroidSvgRasterizer(),
        onEvent = { tipo, detalhe ->
          sendEvent("onStatus", mapOf("tipo" to tipo, "detalhe" to detalhe))
        },
      )
    }

    OnDestroy {
      encoder?.release()
      encoder = null
    }

    AsyncFunction("prepare") { opcoes: OpcoesPrepare ->
      exigir().prepare(
        width = opcoes.width,
        height = opcoes.height,
        videoBitrate = opcoes.videoBitrate,
        fps = opcoes.fps,
        rotation = opcoes.rotation,
        audioBitrate = opcoes.audioBitrate,
        sampleRate = opcoes.sampleRate,
        stereo = opcoes.stereo,
      )
    }

    AsyncFunction("startPreview") {
      val v = view
      if (v == null || !v.superficiePronta) {
        // Nao e erro: a view pode ainda estar montando. Guarda o pedido e
        // aplica quando `surfaceCreated` chegar — pedir preview cedo demais
        // resulta em tela preta sem mensagem nenhuma.
        previewPendente = true
      } else {
        exigir().startPreview(v.surfaceView)
      }
    }

    AsyncFunction("stopPreview") {
      previewPendente = false
      exigir().stopPreview()
    }

    AsyncFunction("startStream") { endpoint: String ->
      exigir().startStream(endpoint)
    }

    AsyncFunction("stopStream") {
      exigir().stopStream()
    }

    // Recebe NOME e devolve o caminho absoluto onde gravou. Resolver o
    // diretorio e trabalho do nativo: o `MediaMuxer` exige caminho absoluto, e
    // nome solto falhava de forma assincrona, sem nada aparecer na tela.
    AsyncFunction("startRecord") { nome: String ->
      exigir().startRecord(nome)
    }

    AsyncFunction("stopRecord") {
      exigir().stopRecord()
    }

    /**
     * Troca o placar. Recebe o SVG inteiro, gerado pelo mesmo codigo que
     * alimenta o burn no desktop.
     */
    AsyncFunction("setOverlaySvg") { svg: String ->
      exigir().setOverlaySvg(svg)
    }

    AsyncFunction("clearOverlay") {
      exigir().clearOverlay()
    }

    AsyncFunction("getState") {
      val e = exigir()
      mapOf(
        "transmitindo" to e.estaTransmitindo,
        "gravando" to e.estaGravando,
        "emPreview" to e.estaEmPreview,
      )
    }

    View(ConvocaEncoderView::class) {
      Events("onSurface")

      OnViewDidUpdateProps { v ->
        view = v
        v.onSurfaceReady = { pronta ->
          sendEvent("onSurface", mapOf("pronta" to pronta))
          if (pronta && previewPendente) {
            previewPendente = false
            runCatching { encoder?.startPreview(v.surfaceView) }
          }
        }
      }
    }
  }

  private fun exigir(): Encoder =
    encoder ?: throw IllegalStateException("encoder nao inicializado")
}
