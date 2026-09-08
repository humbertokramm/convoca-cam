import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import {
  ConvocaEncoder,
  ConvocaEncoderView,
  type EventoStatus,
} from '../../modules/convoca-encoder';
import { resolveSumulaRef, type SumulaRef } from '../data/convocaClient';
import type { MatchEvent } from '../data/watchSumula';
import { usePlacar } from './usePlacar';
import { useRemoto } from './useRemoto';

/**
 * A tela de captura.
 *
 * Fluxo: cola o link da sumula -> escolhe orientacao -> prepara -> preview ->
 * grava e/ou transmite. Do apito em diante ninguem precisa tocar no aparelho:
 * o placar entra sozinho e o comando vem do remoto.
 */

type Orientacao = 'paisagem' | 'retrato';

/**
 * Geometria por orientacao.
 *
 * `rotation` 90 diz ao encoder que o quadro e retrato — sem isso o vertical
 * sairia como um 1920x1080 girado, com a quadra deitada.
 */
const GEOMETRIA: Record<Orientacao, { width: number; height: number; rotation: number }> = {
  paisagem: { width: 1920, height: 1080, rotation: 0 },
  retrato: { width: 1080, height: 1920, rotation: 90 },
};

/** Miniatura de canto, ou preview grande. */
type TamanhoPreview = 'mini' | 'cheio';

export default function Captura() {
  const [linkBruto, setLinkBruto] = useState('');
  const [ref, setRef] = useState<SumulaRef | null>(null);
  const [orientacao, setOrientacao] = useState<Orientacao>('paisagem');
  const [rtmp, setRtmp] = useState('');
  const [tamanho, setTamanho] = useState<TamanhoPreview>('mini');

  const [preparado, setPreparado] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [transmitindo, setTransmitindo] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const [status, setStatus] = useState<EventoStatus | null>(null);
  const [bitrateKbps, setBitrateKbps] = useState<number | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const [arquivo, setArquivo] = useState<string | null>(null);
  const [autoLigado, setAutoLigado] = useState(true);

  const geo = GEOMETRIA[orientacao];
  const janela = useWindowDimensions();

  /**
   * Tamanho do preview na tela, respeitando a proporcao do QUADRO GRAVADO.
   *
   * O quadro e 16:9 (ou 9:16) e a tela deste aparelho e 20:9. Deixar o
   * `SurfaceView` esticar com `MATCH_PARENT` foi o que produziu aquele
   * retangulo cortado no canto: a imagem saia numa proporcao e a view em outra.
   *
   * Aqui largura e altura sao calculadas JUNTAS a partir da proporcao, entao
   * nao ha como divergirem.
   */
  const preview = useMemo(() => {
    const proporcao = geo.width / geo.height;
    const margem = 12;

    if (tamanho === 'mini') {
      // Miniatura de canto: dá para conferir enquadramento sem perder os
      // controles de vista.
      const largura = Math.min(janela.width * 0.34, 260);
      return { largura, altura: largura / proporcao, top: margem, left: janela.width - largura - margem };
    }

    // Cheio: o maior retangulo da proporcao certa que cabe, encostado no topo
    // para o painel continuar alcancavel embaixo.
    const largura = Math.min(janela.width - margem * 2, janela.height * 0.7 * proporcao);
    return {
      largura,
      altura: largura / proporcao,
      top: margem,
      left: (janela.width - largura) / 2,
    };
  }, [geo.width, geo.height, janela.width, janela.height, tamanho]);

  // -------------------------------------------------------------- gravacao

  const iniciarGravacao = useCallback(async () => {
    if (gravando) return;
    setOcupado(true);
    try {
      // Nome com o instante: duas partidas no mesmo dia nao podem colidir.
      // Quem resolve o diretorio e o nativo, e ele devolve o caminho.
      const nome = `convoca-${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`;
      const caminho = await ConvocaEncoder.startRecord(nome);
      setArquivo(caminho);
      setGravando(true);
      setFalha(null);
    } catch (e) {
      setFalha(`gravar: ${(e as Error)?.message}`);
    } finally {
      setOcupado(false);
    }
  }, [gravando]);

  const pararGravacao = useCallback(async () => {
    if (!gravando) return;
    setOcupado(true);
    try {
      await ConvocaEncoder.stopRecord();
      setGravando(false);
    } catch (e) {
      setFalha(`parar: ${(e as Error)?.message}`);
    } finally {
      setOcupado(false);
    }
  }, [gravando]);

  // ------------------------------------------------- placar e disparadores

  /**
   * Rede de seguranca: se o primeiro ponto sair e ninguem tiver apertado REC,
   * grava sozinho.
   *
   * NAO serve como mecanismo unico — quando o primeiro ponto acontece, o jogo
   * ja comecou, e a abertura com escalacao e arbitragem tinha de ter rodado
   * antes. E rede, nao porta da frente.
   */
  const aoEvento = useCallback(
    (ev: MatchEvent) => {
      if (!autoLigado || gravando || !preparado) return;
      const virouLive = ev.tipo === 'fase' && ev.para === 'live' && ev.de !== 'live';
      if (virouLive || ev.tipo === 'ponto') void iniciarGravacao();
    },
    [autoLigado, gravando, preparado, iniciarGravacao],
  );

  const placar = usePlacar({ ref, width: geo.width, height: geo.height, onEvento: aoEvento });

  const remoto = useRemoto({
    ref,
    onComando: useCallback(
      (acao) => {
        if (acao === 'gravar') void iniciarGravacao();
        else void pararGravacao();
      },
      [iniciarGravacao, pararGravacao],
    ),
  });

  // ------------------------------------------------------------- overlay

  // Só reenvia quando o SVG muda de fato. Rasterizar custa, e o placar fica
  // parado entre rallies.
  const ultimoSvg = useRef<string | null>(null);
  useEffect(() => {
    if (!preparado || !placar.svg || placar.svg === ultimoSvg.current) return;
    ultimoSvg.current = placar.svg;
    ConvocaEncoder.setOverlaySvg(placar.svg).catch((e: Error) =>
      setFalha(`overlay: ${e.message}`),
    );
  }, [preparado, placar.svg]);

  // -------------------------------------------------------------- status

  useEffect(() => {
    const sub = ConvocaEncoder.addListener('onStatus', (ev) => {
      setStatus(ev);
      if (ev.tipo === 'bitrate' && ev.detalhe) {
        setBitrateKbps(Math.round(Number(ev.detalhe) / 1000));
      }
      if (ev.tipo === 'conexao_falhou' || ev.tipo === 'auth_erro') {
        setTransmitindo(false);
      }
      // A gravacao falha de forma ASSINCRONA: o `startRecord` retorna bem e o
      // muxer quebra depois. Sem tratar isto, o botao parece sem funcao.
      if (ev.tipo === 'gravacao_erro') {
        setGravando(false);
        setFalha(`gravação: ${ev.detalhe ?? 'erro'}`);
      }
      if (ev.tipo === 'gravacao' && ev.detalhe === 'STOPPED') setGravando(false);
    });
    return () => sub.remove();
  }, []);

  // --------------------------------------------------------------- acoes

  const conectar = () => {
    try {
      setRef(resolveSumulaRef(linkBruto));
      setFalha(null);
    } catch (e) {
      setFalha((e as Error)?.message ?? 'link inválido');
    }
  };

  const preparar = async () => {
    setOcupado(true);
    try {
      const ok = await ConvocaEncoder.prepare({
        width: geo.width,
        height: geo.height,
        rotation: geo.rotation,
      });
      if (!ok) throw new Error('o aparelho recusou a configuração de vídeo ou áudio');
      await ConvocaEncoder.startPreview();
      setPreparado(true);
      setFalha(null);
    } catch (e) {
      setFalha(`preparar: ${(e as Error)?.message}`);
    } finally {
      setOcupado(false);
    }
  };

  const alternarTransmissao = async () => {
    setOcupado(true);
    try {
      if (transmitindo) {
        await ConvocaEncoder.stopStream();
        setTransmitindo(false);
      } else {
        if (!rtmp.trim()) throw new Error('informe o endereço RTMP');
        await ConvocaEncoder.startStream(rtmp.trim());
        setTransmitindo(true);
      }
      setFalha(null);
    } catch (e) {
      setFalha(`transmissão: ${(e as Error)?.message}`);
    } finally {
      setOcupado(false);
    }
  };

  const resumoPlacar = useMemo(() => {
    const e = placar.estado;
    if (!e) return 'sem placar ainda';
    const saque = e.saque ? ` · saque ${e.saque}` : '';
    return `${e.equipes.A} ${e.pontos.A} x ${e.pontos.B} ${e.equipes.B} · set ${e.setNumero}${saque}`;
  }, [placar.estado]);

  // ----------------------------------------------------------------- UI

  return (
    <View style={s.tela}>
      {/* O preview flutua sobre o painel, com tamanho vindo da proporcao do
          quadro gravado. `box-none` deixa o toque atravessar para o painel,
          menos onde ha botao. */}
      <View
        style={[
          s.molduraPreview,
          {
            width: preview.largura,
            height: preview.altura,
            top: preview.top,
            left: preview.left,
          },
        ]}
        pointerEvents="box-none"
      >
        <ConvocaEncoderView style={s.preview} />

        <Pressable
          onPress={() => setTamanho((t) => (t === 'mini' ? 'cheio' : 'mini'))}
          style={s.botaoTamanho}
          hitSlop={10}
        >
          <Text style={s.botaoTamanhoTexto}>{tamanho === 'mini' ? '⤢' : '⤡'}</Text>
        </Pressable>

        {gravando && (
          <View style={s.selo}>
            <View style={s.seloPonto} />
            <Text style={s.seloTexto}>REC</Text>
          </View>
        )}
      </View>

      <ScrollView style={s.painel} contentContainerStyle={s.painelConteudo}>
        {/* Espaco reservado para a miniatura nao cobrir o inicio do painel. */}
        {tamanho === 'mini' && <View style={{ height: preview.altura - 8 }} />}

        {!ref ? (
          <>
            <Text style={s.rotulo}>LINK DA SÚMULA</Text>
            <TextInput
              style={s.entrada}
              value={linkBruto}
              onChangeText={setLinkBruto}
              placeholder="cole o link do evento"
              placeholderTextColor="#5a6b85"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Botao titulo="Conectar" destaque onPress={conectar} />
          </>
        ) : (
          <>
            <Text style={s.placar}>{resumoPlacar}</Text>
            <Text style={s.meta}>
              {placar.fase ?? '—'}
              {placar.falhas > 0 ? ` · ${placar.falhas} falhas de leitura` : ''}
            </Text>

            {!preparado ? (
              <>
                <Text style={s.rotulo}>ORIENTAÇÃO</Text>
                <View style={s.linha}>
                  {(['paisagem', 'retrato'] as const).map((o) => (
                    <Botao
                      key={o}
                      titulo={o === 'paisagem' ? 'Paisagem 16:9' : 'Retrato 9:16'}
                      ativo={orientacao === o}
                      onPress={() => setOrientacao(o)}
                    />
                  ))}
                </View>
                <Botao titulo="Preparar câmera" destaque onPress={preparar} carregando={ocupado} />
              </>
            ) : (
              <>
                <Botao
                  titulo={gravando ? 'Parar gravação' : 'Gravar'}
                  destaque={!gravando}
                  perigo={gravando}
                  carregando={ocupado}
                  onPress={() => void (gravando ? pararGravacao() : iniciarGravacao())}
                />

                {arquivo && (
                  <Text style={s.meta} numberOfLines={1}>
                    {arquivo.split('/').slice(-1)[0]}
                  </Text>
                )}

                <Text style={s.rotulo}>ENDEREÇO RTMP (OPCIONAL)</Text>
                <TextInput
                  style={s.entrada}
                  value={rtmp}
                  onChangeText={setRtmp}
                  placeholder="rtmp://..."
                  placeholderTextColor="#5a6b85"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!transmitindo}
                />
                <Botao
                  titulo={transmitindo ? 'Parar transmissão' : 'Transmitir'}
                  perigo={transmitindo}
                  carregando={ocupado}
                  onPress={() => void alternarTransmissao()}
                />

                <Botao
                  titulo={`Iniciar sozinho no 1º ponto: ${autoLigado ? 'sim' : 'não'}`}
                  ativo={autoLigado}
                  onPress={() => setAutoLigado((v) => !v)}
                />

                <Text style={s.rotulo}>CÓDIGO DO CONTROLE REMOTO</Text>
                <Text style={s.codigo} selectable>
                  {remoto.codigo}
                </Text>
                <Text style={s.meta}>
                  {remoto.sessaoId ? 'sessão aberta' : 'abrindo sessão…'}
                  {remoto.relogio.amostras > 0
                    ? ` · relógio ±${Math.round(remoto.relogio.incertezaMs)}ms`
                    : ' · relógio não calibrado'}
                </Text>
              </>
            )}

            {bitrateKbps != null && <Text style={s.meta}>upload {bitrateKbps} kbps</Text>}
            {status && (
              <Text style={s.meta}>
                {status.tipo}
                {status.detalhe && status.tipo !== 'bitrate' ? `: ${status.detalhe}` : ''}
              </Text>
            )}
          </>
        )}

        {(falha ?? placar.erro ?? remoto.erro) && (
          <Text style={s.erro}>{falha ?? placar.erro ?? remoto.erro}</Text>
        )}
      </ScrollView>
    </View>
  );
}

function Botao({
  titulo,
  onPress,
  ativo,
  destaque,
  perigo,
  carregando,
}: {
  titulo: string;
  onPress: () => void;
  ativo?: boolean;
  destaque?: boolean;
  perigo?: boolean;
  carregando?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={carregando}
      style={({ pressed }) => [
        s.botao,
        ativo && s.botaoAtivo,
        destaque && s.botaoDestaque,
        perigo && s.botaoPerigo,
        pressed && s.botaoPressionado,
      ]}
    >
      {carregando ? (
        <ActivityIndicator color="#0b1220" />
      ) : (
        <Text style={[s.botaoTexto, (destaque ?? perigo) && s.botaoTextoForte]}>{titulo}</Text>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  tela: { flex: 1, backgroundColor: '#0b1220' },

  molduraPreview: {
    position: 'absolute',
    zIndex: 10,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1e2d47',
    backgroundColor: '#000',
  },
  preview: { flex: 1 },

  botaoTamanho: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(11,18,32,0.78)',
  },
  botaoTamanhoTexto: { color: '#f4f7fb', fontSize: 16, fontWeight: '700' },

  selo: {
    position: 'absolute',
    top: 6,
    left: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: 'rgba(255,60,60,0.9)',
  },
  seloPonto: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#fff' },
  seloTexto: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 1 },

  painel: { flex: 1 },
  painelConteudo: { padding: 16, gap: 10 },

  rotulo: { color: '#8fa3bf', fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  placar: { color: '#f4f7fb', fontSize: 19, fontWeight: '700' },
  meta: { color: '#8fa3bf', fontSize: 12 },
  codigo: { color: '#ffcc33', fontSize: 13, fontFamily: 'monospace' },
  erro: { color: '#ff8080', fontSize: 13 },
  linha: { flexDirection: 'row', gap: 10 },

  entrada: {
    backgroundColor: '#111c30',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e2d47',
    color: '#f4f7fb',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  botao: {
    flex: 1,
    backgroundColor: '#111c30',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e2d47',
    paddingVertical: 13,
    alignItems: 'center',
  },
  botaoAtivo: { borderColor: '#ffcc33' },
  botaoDestaque: { backgroundColor: '#ffcc33', borderColor: '#ffcc33' },
  botaoPerigo: { backgroundColor: '#ff6b6b', borderColor: '#ff6b6b' },
  botaoPressionado: { opacity: 0.7 },
  botaoTexto: { color: '#f4f7fb', fontWeight: '600' },
  botaoTextoForte: { color: '#101010' },
});
