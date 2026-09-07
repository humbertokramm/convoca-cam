import { useEffect, useRef, useState } from 'react';

import type { MatchPhase } from '../core/phase';
import { type SumulaRef } from '../data/convocaClient';
import { watchSumula, type MatchEvent } from '../data/watchSumula';
import { scoreboardDe } from '../overlay/fromStatus';
import { scoreboardParaQuadro, type ScoreboardState } from '../overlay';

/**
 * Acompanha a sumula e produz o SVG do placar pronto para queimar.
 *
 * O caminho e curto de proposito: snapshot da sumula -> estado do placar ->
 * SVG. Nenhuma das tres etapas guarda estado derivado, entao nao ha o que
 * dessincronizar.
 *
 * `svg` so muda quando algo VISIVEL muda. O `watchSumula` separa "houve
 * escrita" de "mudou o que se desenha" — cartao e substituicao movem a versao
 * da sumula e nao devem repintar o overlay.
 *
 * ESTE HOOK NAO MEXE NA ANCORA DE RELOGIO, de proposito. A tentacao e usar o
 * `atualizado_em` que chega em cada leitura como "hora do servidor", mas ele e
 * instante PASSADO — a ultima escrita, que pode ter sido minutos atras (medimos
 * 11 minutos numa sumula real). Alimentar a ancora com isso destruiria a
 * calibracao. As fontes validas sao o `agora` das funcoes `gravacao_*`
 * (`clock_timestamp()`) e o header `Date` das respostas; quem cuida disso e o
 * `useRemoto`.
 */

export interface Placar {
  estado: ScoreboardState | null;
  /** SVG do quadro inteiro, com o placar posicionado dentro. */
  svg: string | null;
  fase: MatchPhase | null;
  /** Erro da ultima leitura, se houver. O polling continua com backoff. */
  erro: string | null;
  /** Quantas leituras seguidas falharam. Zero quando esta saudavel. */
  falhas: number;
}

export interface OpcoesPlacar {
  ref: SumulaRef | null;
  /** Dimensoes do QUADRO DE VIDEO, nao da tela. Definem o layout escolhido. */
  width: number;
  height: number;
  /** Chamado a cada evento. Usado para o disparo automatico no primeiro ponto. */
  onEvento?: (ev: MatchEvent) => void;
}

export function usePlacar({ ref, width, height, onEvento }: OpcoesPlacar): Placar {
  const [estado, setEstado] = useState<ScoreboardState | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [fase, setFase] = useState<MatchPhase | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [falhas, setFalhas] = useState(0);

  // `onEvento` num ref para o watcher nao ser recriado quando o callback muda
  // de identidade — recriar o watcher perderia o snapshot anterior, e o
  // proximo diff sairia errado (um ponto viraria "primeira leitura").
  const eventoRef = useRef(onEvento);
  eventoRef.current = onEvento;

  useEffect(() => {
    if (!ref) return;

    const h = watchSumula(
      ref,
      {
        onSnapshot(snap, f) {
          const novo = scoreboardDe(snap.status);
          setEstado(novo);
          setSvg(scoreboardParaQuadro(novo, width, height));
          setFase(f);
          setErro(null);
          setFalhas(0);
        },
        onEvent(ev) {
          eventoRef.current?.(ev);
        },
        onError(e, seguidas) {
          setErro(e.message);
          setFalhas(seguidas);
        },
      },
      { intervaloLiveMs: 1500, intervaloIdleMs: 4000 },
    );

    return () => h.stop();
    // `width`/`height` entram porque trocar de paisagem para retrato muda o
    // layout, e o SVG precisa ser regerado com a geometria nova.
  }, [ref, width, height]);

  return { estado, svg, fase, erro, falhas };
}
