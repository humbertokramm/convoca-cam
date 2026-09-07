import type { AncoraDeRelogio, EstadoAncora } from '../core/relogio';
import type { MatchEvent } from '../data/watchSumula';
import type { ScoreboardState } from '../overlay/scoreboard';

/**
 * A timeline: os eventos do placar carimbados no tempo do VIDEO.
 *
 * E o artefato que o passo de burn consome para saber que overlay desenhar em
 * cada frame. Fica ao lado do arquivo de video.
 */

/**
 * Era do contrato de `versao`. Faz parte do artefato de proposito.
 *
 * O compromisso do lado do AVF: para uma mesma `sumula_id`, `versao` so cresce
 * e nunca e reatribuida. O rebase da migration 125 (`count(rallies) + 1`) foi
 * unico e existiu justamente para o numero nunca descer; nao havera outro.
 *
 * O que NAO esta coberto por esse compromisso, e que este campo permite
 * detectar em vez de adivinhar:
 *
 *  - Carimbo anterior a 125. Naquela epoca `versao` era contagem de rallies, e
 *    as faixas se sobrepoem: um `versao: 8` de antes e um de agora sao numeros
 *    iguais falando de coisas diferentes. Nao sao comparaveis, e nenhuma
 *    heuristica sobre o proprio numero descobre isso — so o rotulo da era.
 *  - Restauracao de backup fora de ordem.
 *  - Sumula apagada e recriada. Neste caso a `sumula_id` tambem muda, entao o
 *    carimbo ja fica orfao sozinho — e por isso que ela e gravada aqui.
 *
 * Nos dois ultimos casos o certo e tratar como quebra, nao como divergencia a
 * conciliar. `atualizado_em` e o desempate, porque e relogio e nao contador.
 */
export const CONTRATO_VERSAO = 'escritas-125' as const;
export type ContratoVersao = typeof CONTRATO_VERSAO;

/**
 * De onde saiu o instante de um evento — e, por consequencia, quanto ele vale.
 *
 * `rally`   : de `sumula_rallies.criado_em`. E a hora do ponto, exata.
 * `escrita` : de `sumulas.atualizado_em`. Desde a 125 esse campo marca a
 *             ultima escrita de QUALQUER tipo, entao um cartao ou uma
 *             substituicao entre dois pontos empurra o carimbo. O erro e
 *             limitado ao intervalo de polling, mas existe.
 * `local`   : nenhuma escrita conhecida; sobrou o relogio do aparelho
 *             convertido pela ancora.
 */
export type PrecisaoCarimbo = 'rally' | 'escrita' | 'local';

export interface TimelineEvento {
  /** Milissegundos desde o inicio da gravacao. Negativo = antes do REC. */
  videoMs: number;
  /** `rede.sumulas.versao` no momento da escrita que gerou o evento. */
  versao: number;
  /** Epoch ms no relogio do SERVIDOR. Desempate entre carimbos. */
  serverAt: number | null;
  /** Procedencia do instante. `rally` e exato; os outros, aproximados. */
  precisao: PrecisaoCarimbo;
  /**
   * O estado COMPLETO do placar a partir deste instante, nao o diff.
   *
   * Redundante de proposito. O burn nao deve reconstruir placar somando
   * eventos: um evento perdido desalinharia todo o resto do video, e o erro
   * so apareceria no arquivo final. Com o estado inteiro em cada entrada, o
   * burn e uma busca por faixa de tempo e nada mais.
   */
  estado: ScoreboardState;
  evento: MatchEvent;
}

export interface Timeline {
  sumulaId: string;
  contrato: ContratoVersao;
  /**
   * Epoch ms do primeiro frame, NO RELOGIO DO SERVIDOR.
   *
   * Ancora de todo `videoMs`. Fica em hora de servidor porque `criado_em` dos
   * rallies tambem esta — assim os dois lados de toda subtracao vem do mesmo
   * relogio, e nao sobra desvio nenhum para estimar.
   */
  gravacaoIniciadaEm: number;
  /** Como a ancora estava ao fechar o artefato. Serve para auditar depois. */
  relogio: EstadoAncora;
  eventos: TimelineEvento[];
}

/**
 * Acumula eventos durante a gravacao.
 *
 * SINCRONIA. Duas coisas atrapalham e sao problemas diferentes:
 *
 *  1. O polling de 1,5s observa um ponto ate 1,5s depois de ele acontecer.
 *     Mitigado usando `atualizado_em` — hora de servidor — em vez da hora em
 *     que a resposta chegou.
 *  2. O relogio do aparelho nao e o do servidor. Resolvido pela
 *     {@link AncoraDeRelogio}, que converte o instante do REC para hora de
 *     servidor uma vez, no comeco.
 *
 * Feito isso, `videoMs` e uma subtracao entre dois instantes do MESMO relogio.
 *
 * ESTA NAO E A FONTE PRECISA, E DE PROPOSITO. Desde a 125, `atualizado_em`
 * marca a ultima escrita de qualquer tipo: se um cartao entrou entre o rally e
 * a nossa leitura, o ponto herda a hora do cartao. O erro fica limitado ao
 * intervalo de polling — a mesma ordem de grandeza do problema (1) — entao
 * mitiga, nao elimina.
 *
 * Por isso os eventos saem marcados como `precisao: 'escrita'`, e o caminho de
 * producao para o video final e `reconstruir.ts`, que le
 * `sumula_rallies.criado_em` e produz `precisao: 'rally'`. Esta classe serve ao
 * HUD do operador e como rede de seguranca se a reconstrucao nao for possivel.
 */
export class TimelineBuilder {
  private readonly eventos: TimelineEvento[] = [];
  /** Instante do primeiro frame, ja convertido para hora de servidor. */
  private readonly t0Servidor: number;

  constructor(
    private readonly sumulaId: string,
    /** Epoch ms do primeiro frame, no relogio do APARELHO. */
    gravacaoIniciadaEmAparelho: number,
    private readonly ancora: AncoraDeRelogio,
  ) {
    this.t0Servidor = ancora.paraServidor(gravacaoIniciadaEmAparelho);
  }

  /** Hora de servidor do primeiro frame — o `t0` que a reconstrucao espera. */
  get inicioServidor(): number {
    return this.t0Servidor;
  }

  /** Converte o instante de um evento em milissegundos de video. */
  private paraVideoMs(ev: MatchEvent): number {
    // Com `serverAt` ja estamos em hora de servidor: subtracao direta.
    // Sem ele (nenhuma escrita na sumula ainda), converte-se a observacao.
    const servidor = ev.serverAt ?? this.ancora.paraServidor(ev.at);
    return servidor - this.t0Servidor;
  }

  registra(ev: MatchEvent, estado: ScoreboardState): TimelineEvento {
    const item: TimelineEvento = {
      videoMs: this.paraVideoMs(ev),
      versao: ev.versao,
      serverAt: ev.serverAt,
      precisao: ev.serverAt == null ? 'local' : 'escrita',
      estado,
      evento: ev,
    };
    this.eventos.push(item);
    return item;
  }

  build(): Timeline {
    return {
      sumulaId: this.sumulaId,
      contrato: CONTRATO_VERSAO,
      gravacaoIniciadaEm: this.t0Servidor,
      relogio: this.ancora.estado(),
      // Ordena por tempo de video: correcoes da mesa podem chegar fora de ordem
      // em relacao ao relogio do servidor.
      eventos: [...this.eventos].sort((a, b) => a.videoMs - b.videoMs),
    };
  }
}

// ------------------------------------------------------- leitura de artefatos

export type Comparacao =
  | { comparavel: true }
  | { comparavel: false; motivo: 'sumula_diferente' | 'contrato_diferente' };

/**
 * Dois carimbos so podem ser comparados por `versao` se falarem da mesma sumula
 * E da mesma era do contrato.
 *
 * Nao devolve boolean: o motivo e o que decide o que fazer. `sumula_diferente`
 * e so um artefato de outra partida; `contrato_diferente` e um carimbo velho,
 * cujo numero parece valido e nao e.
 */
export function carimbosComparaveis(
  a: Pick<Timeline, 'sumulaId' | 'contrato'>,
  b: Pick<Timeline, 'sumulaId' | 'contrato'>,
): Comparacao {
  if (a.sumulaId !== b.sumulaId) return { comparavel: false, motivo: 'sumula_diferente' };
  if (a.contrato !== b.contrato) return { comparavel: false, motivo: 'contrato_diferente' };
  return { comparavel: true };
}

/**
 * Ordena dois momentos da MESMA sumula.
 *
 * `versao` e contador e so vale dentro da mesma era. Fora dela, e quando o
 * numero empata, o desempate e `serverAt` — relogio, nao contador. Devolve
 * `null` quando nao da para afirmar nada, para o chamador nao confundir
 * "empatado" com "nao sei".
 */
export function ordenaCarimbos(
  a: { versao: number; serverAt: number | null; contrato: ContratoVersao },
  b: { versao: number; serverAt: number | null; contrato: ContratoVersao },
): number | null {
  if (a.contrato === b.contrato && a.versao !== b.versao) return a.versao - b.versao;
  if (a.serverAt != null && b.serverAt != null && a.serverAt !== b.serverAt) {
    return a.serverAt - b.serverAt;
  }
  return null;
}
