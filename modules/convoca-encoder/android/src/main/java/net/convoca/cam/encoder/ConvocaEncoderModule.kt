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

  /**
   * O preview DEVE estar no ar.
   *
   * Nao e o mesmo que "esta no ar". A superficie morre e renasce sozinha — app
   * pro fundo, tela apagada, React remontando a arvore — e o JavaScript nao
   * fica sabendo. Guardar a INTENCAO aqui e o que permite religar o preview
   * quando a superficie voltar.
   *
   * Sem isto, sair do app e voltar deixava tela preta e sem placar, com o app
   * ainda dizendo que gravava. E gravava mesmo: preto.
   */
  private var previewDesejado = false

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
      previewDesejado = true
      val v = view
      // Se a superficie ainda nao existe nao e erro: a view pode estar
      // montando. `previewDesejado` segura o pedido, e o `surfaceCreated`
      // aplica. Pedir preview cedo demais da tela preta sem mensagem nenhuma.
      if (v != null && v.superficiePronta) exigir().startPreview(v.surfaceView)
    }

    AsyncFunction("stopPreview") {
      previewDesejado = false
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
    // `segundosPorSegmento` maior que zero pica a gravacao em arquivos
    // numerados. Ver o porque em Encoder.startRecord: MP4 sem indice e video
    // perdido, nao video parcial.
    AsyncFunction("startRecord") { nome: String, segundosPorSegmento: Int ->
      exigir().startRecord(nome, segundosPorSegmento)
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
          if (pronta) {
            // Volta do fundo, ou primeira montagem: religa se era pra estar no ar.
            if (previewDesejado) runCatching { encoder?.startPreview(v.surfaceView) }
              .onFailure { sendEvent("onStatus", mapOf("tipo" to "preview_erro", "detalhe" to it.message)) }
          } else {
            // Solta a superficie AQUI, sincronamente, ainda dentro do
            // `surfaceDestroyed`. Depois que ele retorna a superficie e
            // invalida, e continuar desenhando nela derruba a thread de GL —
            // levando o encoder junto, sem erro visivel.
            //
            // `previewDesejado` NAO e limpo: quem manda parar de verdade e o
            // JavaScript, nao o sistema tirando a janela da frente.
            runCatching { encoder?.stopPreview() }
          }
        }

        v.onSurfaceResized = { largura, altura ->
          encoder?.redimensionarPreview(largura, altura)
        }
      }
    }
  }

  private fun exigir(): Encoder =
    encoder ?: throw IllegalStateException("encoder nao inicializado")
}
