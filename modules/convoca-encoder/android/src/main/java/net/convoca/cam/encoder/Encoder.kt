package net.convoca.cam.encoder

import android.content.Context
import android.graphics.Bitmap
import android.os.Environment
import android.util.Log
import android.view.SurfaceView
import com.pedro.common.ConnectChecker
// `object` e palavra reservada do Kotlin, e o pacote da biblioteca (Java) se
// chama literalmente assim — daí as crases.
import com.pedro.encoder.input.gl.render.filters.`object`.ImageObjectFilterRender
import com.pedro.library.base.recording.RecordController
import com.pedro.library.generic.GenericStream
import java.io.File

/**
 * Dona do encoder. Uma instancia por processo.
 *
 * A RootEncoder toma conta de camera, preview e encoder de uma vez — e por isso
 * que a VisionCamera saiu do projeto: as duas disputariam o mesmo hardware.
 *
 * O DESENHO BARATO DO OVERLAY. O filtro de imagem entra UMA vez, no prepare, e
 * dali em diante cada ponto so troca o bitmap dele. O placar muda algumas
 * dezenas de vezes numa partida, entao nao ha nada a otimizar depois disso: nao
 * se desenha por frame, nao se recria filtro, nao se mexe no grafo de GL.
 *
 * A ORDEM IMPORTA. `prepareVideo` da RootEncoder lanca excecao se houver stream,
 * gravacao ou preview ativos. Entao: prepare -> preview -> stream/gravacao.
 */
class Encoder(
  private val context: Context,
  private val rasterizer: OverlayRasterizer,
  private val onEvent: (tipo: String, detalhe: String?) -> Unit,
) {

  companion object {
    private const val TAG = "ConvocaEncoder"
  }

  private val overlay = ImageObjectFilterRender()

  private val checker = object : ConnectChecker {
    override fun onConnectionStarted(url: String) = onEvent("conexao_iniciada", url)
    override fun onConnectionSuccess() = onEvent("conectado", null)
    override fun onConnectionFailed(reason: String) = onEvent("conexao_falhou", reason)
    override fun onDisconnect() = onEvent("desconectado", null)
    override fun onAuthError() = onEvent("auth_erro", null)
    override fun onAuthSuccess() = onEvent("auth_ok", null)
    // Chega a cada segundo com a taxa real de upload. E o unico sinal honesto
    // de que a internet do ginasio esta dando conta.
    override fun onNewBitrate(bitrate: Long) = onEvent("bitrate", bitrate.toString())
  }

  private val stream: GenericStream by lazy {
    GenericStream(context, checker).apply {
      getStreamClient().setReTries(Int.MAX_VALUE)
    }
  }

  /** Dimensoes com que o `prepare` foi feito — o rasterizador precisa delas. */
  private var largura = 0
  private var altura = 0
  private var preparado = false

  val estaTransmitindo: Boolean get() = stream.isStreaming
  val estaGravando: Boolean get() = stream.isRecording
  val estaEmPreview: Boolean get() = stream.isOnPreview

  /**
   * Configura video e audio. Precisa vir antes de tudo, e so uma vez.
   *
   * `rotation` em 90 ou 270 diz a biblioteca que o quadro e retrato — e o que
   * faz o vertical sair 1080x1920 de verdade, e nao 1920x1080 girado.
   */
  fun prepare(
    width: Int,
    height: Int,
    videoBitrate: Int,
    fps: Int,
    rotation: Int,
    audioBitrate: Int,
    sampleRate: Int,
    stereo: Boolean,
  ): Boolean {
    if (stream.isStreaming || stream.isRecording || stream.isOnPreview) {
      throw IllegalStateException(
        "prepare exige stream, gravacao e preview parados (a RootEncoder recusa)"
      )
    }

    val okVideo = stream.prepareVideo(width, height, videoBitrate, fps, rotation = rotation)
    val okAudio = stream.prepareAudio(sampleRate, stereo, audioBitrate)
    preparado = okVideo && okAudio

    if (preparado) {
      largura = width
      altura = height
      // O filtro entra aqui e nunca mais sai. Escala e posicao cheias porque o
      // SVG ja vem do tamanho do quadro, com o placar colocado dentro dele.
      stream.getGlInterface().addFilter(overlay)
      overlay.setScale(100f, 100f)
      overlay.setPosition(0f, 0f)
    } else {
      Log.e(TAG, "prepare falhou: video=$okVideo audio=$okAudio")
    }
    return preparado
  }

  fun startPreview(surface: SurfaceView) {
    exigirPreparado()
    if (!stream.isOnPreview) stream.startPreview(surface)
  }

  fun stopPreview() {
    if (stream.isOnPreview) stream.stopPreview()
  }

  fun startStream(endpoint: String) {
    exigirPreparado()
    if (!stream.isStreaming) stream.startStream(endpoint)
  }

  fun stopStream() {
    if (stream.isStreaming) stream.stopStream()
  }

  /**
   * Diretorio das gravacoes.
   *
   * `getExternalFilesDir` e area privada do app: nao precisa de permissao de
   * armazenamento e nao suja a galeria com arquivo pela metade enquanto grava.
   * Publicar na galeria e passo separado, depois de o arquivo fechar.
   */
  private fun pastaDeVideo(): File {
    val dir = context.getExternalFilesDir(Environment.DIRECTORY_MOVIES)
      ?: throw IllegalStateException("aparelho sem diretorio de video acessivel")
    if (!dir.exists() && !dir.mkdirs()) {
      throw IllegalStateException("nao consegui criar ${dir.absolutePath}")
    }
    return dir
  }

  /**
   * Grava em arquivo. Pode rodar junto com a transmissao — e o motivo de a
   * RootEncoder ter sido escolhida.
   *
   * RECEBE NOME, DEVOLVE CAMINHO. O caminho e resolvido aqui de proposito: quem
   * chamava passava so o nome do arquivo, e o `MediaMuxer` por tras disso exige
   * caminho ABSOLUTO. Nome solto resolvia contra o diretorio de trabalho do
   * processo, que nao e gravavel — e a falha vinha assincrona, sem nada na tela.
   */
  fun startRecord(nome: String): String {
    exigirPreparado()
    if (stream.isRecording) return ""

    val arquivo = File(pastaDeVideo(), nome)

    // Objeto em vez de lambda porque a lambda (SAM) só implementa o metodo
    // abstrato `onStatusChange`. O `onError` tem implementacao padrao e some —
    // e era justamente ele que carregava o motivo da falha, silenciosamente
    // engolido: o botao "Gravar" parecia sem funcao nenhuma.
    stream.startRecord(
      arquivo.absolutePath,
      object : RecordController.Listener {
        override fun onStatusChange(status: RecordController.Status) {
          onEvent("gravacao", status.name)
        }

        override fun onError(e: Exception?) {
          Log.e(TAG, "erro ao gravar em ${arquivo.absolutePath}", e)
          onEvent("gravacao_erro", e?.message ?: e?.javaClass?.simpleName ?: "erro ao gravar")
        }
      },
    )
    return arquivo.absolutePath
  }

  fun stopRecord() {
    if (stream.isRecording) stream.stopRecord()
  }

  /**
   * Troca o placar sobreposto.
   *
   * Chamada a cada ponto. Rasteriza o SVG no tamanho do quadro configurado no
   * `prepare` — nao no tamanho da tela, que e outra coisa.
   */
  fun setOverlaySvg(svg: String) {
    exigirPreparado()
    val bitmap: Bitmap = rasterizer.render(svg, largura, altura)
    overlay.setImage(bitmap)
  }

  /** Remove o placar sem desmontar o filtro. */
  fun clearOverlay() {
    overlay.setImage(null)
  }

  fun release() {
    stopRecord()
    stopStream()
    stopPreview()
    stream.release()
    preparado = false
  }

  private fun exigirPreparado() {
    if (!preparado) throw IllegalStateException("chame prepare() antes")
  }
}
