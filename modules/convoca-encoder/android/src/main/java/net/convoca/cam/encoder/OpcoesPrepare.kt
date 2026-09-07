package net.convoca.cam.encoder

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/**
 * Parametros de `prepare`, vindos do TypeScript.
 *
 * Os padroes sao os de uma partida em 1080p a 30fps. Vale explicar os dois que
 * nao sao obvios:
 *
 * `rotation` — 90 ou 270 diz a RootEncoder que o quadro e retrato. E o que faz
 * o vertical sair 1080x1920 de verdade, em vez de um 1920x1080 girado.
 *
 * `videoBitrate` — 4 Mbps e um meio de campo. Internet de ginasio raramente
 * sustenta mais subindo, e abaixo disso a rede de volei comeca a virar borrao
 * na movimentacao rapida, que e exatamente o que se quer ver.
 */
class OpcoesPrepare : Record {
  @Field var width: Int = 1920
  @Field var height: Int = 1080
  @Field var videoBitrate: Int = 4_000_000
  @Field var fps: Int = 30
  @Field var rotation: Int = 0
  @Field var audioBitrate: Int = 128_000
  @Field var sampleRate: Int = 44_100
  @Field var stereo: Boolean = true
}
