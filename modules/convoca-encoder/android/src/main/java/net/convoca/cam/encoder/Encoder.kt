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
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

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

  // ------------------------------------------------------------- gravacao

  private var rotacao: ScheduledExecutorService? = null
  private var nomeBase = ""
  private var segundosSegmento = 0
  private var indiceSegmento = 0
  private var caminhoAtual = ""

  private fun ouvinteDeGravacao(caminho: String) = object : RecordController.Listener {
    override fun onStatusChange(status: RecordController.Status) {
      onEvent("gravacao", status.name)
    }

    // Objeto em vez de lambda porque a lambda (SAM) só implementa o metodo
    // abstrato `onStatusChange`. O `onError` tem implementacao padrao e some —
    // e era justamente ele que carregava o motivo da falha, silenciosamente
    // engolido: o botao "Gravar" parecia sem funcao nenhuma.
    override fun onError(e: Exception?) {
      Log.e(TAG, "erro ao gravar em $caminho", e)
      onEvent("gravacao_erro", e?.message ?: e?.javaClass?.simpleName ?: "erro ao gravar")
    }
  }

  private fun abreSegmento(indice: Int): String {
    val nome =
      if (segundosSegmento > 0) String.format("%s-%03d.mp4", nomeBase, indice)
      else "$nomeBase.mp4"

    val arquivo = File(pastaDeVideo(), nome)
    caminhoAtual = arquivo.absolutePath
    stream.startRecord(caminhoAtual, ouvinteDeGravacao(caminhoAtual))
    return caminhoAtual
  }

  /**
   * Fecha o segmento corrente e abre o seguinte.
   *
   * `requestKeyframe()` depois de abrir: sem isso o arquivo novo comeca
   * esperando o proximo quadro-chave natural, e os primeiros segundos ficam
   * sem imagem decodificavel.
   */
  private fun rodaSegmento() {
    if (!stream.isRecording) return
    val fechado = caminhoAtual

    stream.stopRecord()
    // O segmento fechou e tem indice completo: ja pode ser publicado. Avisar
    // AQUI, e nao no fim da partida, e o que faz a bateria morrer custar so o
    // segmento em andamento.
    onEvent("segmento_fechado", fechado)

    indiceSegmento += 1
    abreSegmento(indiceSegmento)
    stream.requestKeyframe()
  }

  /**
   * Grava em arquivo. Pode rodar junto com a transmissao — e o motivo de a
   * RootEncoder ter sido escolhida.
   *
   * RECEBE NOME, DEVOLVE CAMINHO. O caminho e resolvido aqui de proposito: quem
   * chamava passava so o nome do arquivo, e o `MediaMuxer` por tras disso exige
   * caminho ABSOLUTO. Nome solto resolvia contra o diretorio de trabalho do
   * processo, que nao e gravavel — e a falha vinha assincrona, sem nada na tela.
   *
   * SEGMENTACAO. Com `segundosPorSegmento > 0` a gravacao e picada em arquivos
   * `<nome>-001.mp4`, `-002.mp4`, ...
   *
   * Por que isso existe: o MP4 guarda o indice (`moov`) no FIM do arquivo,
   * escrito quando a gravacao para. Se o processo morrer antes — bateria, o
   * sistema matando o app, travamento — o arquivo fica sem indice e nao abre em
   * player nenhum. Nao e video parcial: e video perdido. Em 90 minutos de
   * partida isso nao e hipotese.
   *
   * A RootEncoder 2.6.0 nao tem segmentacao nativa (sem `maxDuration`, sem
   * `maxFileSize`; aquilo veio na 2.8, incompativel com o Kotlin do Expo),
   * entao e feita aqui: temporizador que para e recomeca.
   *
   * Custo: perde-se uma fracao de segundo na costura entre segmentos. Contra
   * perder a partida inteira, e troca facil.
   */
  fun startRecord(nome: String, segundosPorSegmento: Int): String {
    exigirPreparado()
    if (stream.isRecording) return ""

    segundosSegmento = segundosPorSegmento.coerceAtLeast(0)
    nomeBase = nome.removeSuffix(".mp4")
    indiceSegmento = 1

    val primeiro = abreSegmento(indiceSegmento)

    if (segundosSegmento > 0) {
      // Executor proprio em vez do Looper principal: fechar um segmento grava o
      // indice do arquivo, e nao vale arriscar segurar a interface por isso.
      rotacao?.shutdownNow()
      val ex = Executors.newSingleThreadScheduledExecutor()
      rotacao = ex
      ex.scheduleAtFixedRate(
        {
          runCatching { rodaSegmento() }.onFailure { erro ->
            Log.e(TAG, "falha ao rodar segmento", erro)
            onEvent("gravacao_erro", erro.message ?: "falha ao rodar segmento")
          }
        },
        segundosSegmento.toLong(),
        segundosSegmento.toLong(),
        TimeUnit.SECONDS,
      )
    }
    return primeiro
  }

  /**
   * Encerra a gravacao de vez.
   *
   * Emite `gravacao_encerrada` ALEM do `segmento_fechado`, porque a rotacao de
   * segmento tambem produz o `STOPPED` cru da biblioteca — sem um evento que
   * distinga os dois, a interface acharia que a gravacao parou a cada 5
   * minutos.
   */
  fun stopRecord() {
    rotacao?.shutdownNow()
    rotacao = null
    if (stream.isRecording) {
      val fechado = caminhoAtual
      stream.stopRecord()
      onEvent("segmento_fechado", fechado)
    }
    onEvent("gravacao_encerrada", null)
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
    rotacao?.shutdownNow()
    rotacao = null
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
