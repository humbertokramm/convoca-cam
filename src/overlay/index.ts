import { scoreboardSvg, type ScoreboardState } from './scoreboard';
import { orientacaoDe, scoreboardVerticalSvg } from './scoreboardVertical';

export * from './scoreboard';
export * from './scoreboardVertical';
export * from './tema';

/**
 * Desenha o placar no layout que a forma do quadro pede.
 *
 * A escolha e por geometria e nao por configuracao: um quadro 9:16 com a tarja
 * de 16:9 fica errado qualquer que fosse a intencao de quem gravou. Assim o
 * burn nao precisa carregar uma preferencia — ele olha o video e acerta.
 */
export function scoreboardParaQuadro(
  s: ScoreboardState,
  width: number,
  height: number,
): string {
  return orientacaoDe(width, height) === 'retrato'
    ? scoreboardVerticalSvg(s, { width, height })
    : scoreboardSvg(s, { width, height });
}
