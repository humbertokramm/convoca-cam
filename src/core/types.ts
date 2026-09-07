/**
 * Modelo do placar publico do convoca.net (volei).
 *
 * Derivado do payload real de `rest/v1/rpc/sumula_status`. Campos marcados
 * NAO-VERIFICADO sao inferencias: o schema PostgREST nao e legivel pelo anon
 * (401 na raiz), entao so conhecemos com certeza o que ja veio na resposta.
 */

export type TeamSide = 'A' | 'B';

export const SIDES: readonly TeamSide[] = ['A', 'B'];

export interface SumulaFormato {
  /** Melhor de N sets (ex.: 3 => vence quem fizer 2). */
  melhor_de: number;
  /** Pontos para fechar um set normal (ex.: 25). */
  pontos_set: number;
  /** Pontos para fechar o set decisivo (ex.: 15). */
  pontos_tiebreak: number;
}

export interface SetAtual {
  numero: number;
  pontos: Record<TeamSide, number>;
  /** Quem esta com o saque. Pode vir nulo entre rallies/sets. */
  saque: TeamSide | null;
  /** Pontuacao alvo deste set (25 normal, 15 no tiebreak). */
  alvo: number;
  encerrado: boolean;
}

export interface SetResumo {
  numero: number;
  A: number;
  B: number;
  encerrado: boolean;
}

export interface SumulaStatus {
  sumula_id: string;
  titulo: string;
  /** String crua do servidor. Use `classifyPhase()` em vez de comparar direto. */
  estado: string;
  /** Sistema tatico, ex. "5x1". */
  sistema: string;
  formato: SumulaFormato;
  equipes: Record<TeamSide, string>;
  sets_vencidos: Record<TeamSide, number>;
  /** Ausente antes do primeiro set comecar. */
  set_atual: SetAtual | null;
  sets: SetResumo[];
  /**
   * Contador de ESCRITAS guardado em `rede.sumulas` (migration 125), mantido
   * por gatilho nas oito tabelas filhas e na propria sumula. Anda a cada
   * ponto, desfazer, substituicao, cartao e no encerramento.
   *
   * Comparar com `!==`, nunca com `>`: e selo de mudanca, nao sequencia sem
   * buracos — sumulas anteriores a 125 foram rebaseadas para
   * `count(rallies) + 1`, entao o numero deu um salto para cima de uma vez.
   *
   * (Ate a 125 isto era `count(*)` dos rallies e ficava parado no desfazer.)
   */
  versao: number;
  /**
   * Hora da ultima ESCRITA na sumula, carimbada pelo gatilho da 125.
   *
   * NAO e a hora do ultimo ponto. Ela se move em cartao, substituicao,
   * escalacao e no encerramento tambem — um cartao entre dois pontos a
   * empurra. Ate a 125 isto era `max(criado_em)` dos rallies, e ai as duas
   * coisas coincidiam.
   *
   * CUIDADO AO TESTAR: sumulas anteriores a 125 tiveram este campo preenchido
   * no backfill com a hora do ultimo rally, entao NELAS as duas leituras
   * coincidem — e a diferenca fica invisivel. E o pior formato possivel para
   * testar. A sumula 64d9b1a6 e uma dessas.
   *
   * A hora do ultimo PONTO e `max(criado_em)` em `sumula_rallies`, com o
   * filtro do cursor (`ordem <= rallies_ativos`) — e o que `reconstruir.ts`
   * usa, e por isso a reconstrucao e a fonte precisa.
   */
  atualizado_em: string;
}

/** Snapshot + quando nos o observamos localmente. */
export interface SumulaSnapshot {
  status: SumulaStatus;
  /** Epoch ms local em que a resposta chegou. */
  observedAt: number;
  /** Epoch ms derivado de `atualizado_em`, ou null se impossivel de parsear. */
  serverAt: number | null;
}
