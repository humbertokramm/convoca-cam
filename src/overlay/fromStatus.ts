import { ehTiebreak } from '../core/phase';
import type { SumulaStatus } from '../core/types';
import type { ScoreboardState } from './scoreboard';

/**
 * Traduz o payload da sumula no estado que o placar desenha.
 *
 * Fica separado do renderizador de proposito: o renderizador nao precisa saber
 * que existe um convoca.net, e o dia em que outro esporte entrar, e so escrever
 * outro tradutor.
 */
export function scoreboardDe(status: SumulaStatus): ScoreboardState {
  const set = status.set_atual;

  return {
    equipes: { A: status.equipes.A, B: status.equipes.B },
    setsVencidos: { A: status.sets_vencidos.A, B: status.sets_vencidos.B },
    pontos: { A: set?.pontos.A ?? 0, B: set?.pontos.B ?? 0 },
    saque: set?.saque ?? null,
    setNumero: set?.numero ?? 1,
    // Sem set aberto ainda, o alvo e o do set normal — o decisivo so vira alvo
    // quando a partida chega nele.
    alvo: set?.alvo ?? status.formato.pontos_set,
    tiebreak: ehTiebreak(status),
  };
}
