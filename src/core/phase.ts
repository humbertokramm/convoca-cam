import type { SumulaStatus } from './types';

/**
 * Fase da partida.
 *
 * `pre`  -> sumula aberta, apito inicial ainda nao aconteceu (overlay de abertura)
 * `live` -> primeiro rally registrado, bola rolando (overlay de placar)
 * `ended`-> sumula encerrada (overlay de resultado final)
 */
export type MatchPhase = 'pre' | 'live' | 'ended';

/**
 * O enum REAL de `rede.sumulas.estado`, confirmado no check constraint da
 * migration 083 do repositorio AVF:
 *
 *   check (estado in ('em_jogo', 'encerrada'))   default 'em_jogo'
 *
 * Ou seja: NAO existe estado de "antes do apito". A sumula nasce `em_jogo`.
 * Quem separa aquecimento de bola em jogo e a existencia do primeiro rally,
 * nao o `estado` — e por isso `derivePhase()` olha o placar, nao so a string.
 *
 * A migration 083 avisa que a etapa 4 (assinatura) vai acrescentar estados de
 * aprovacao. Por isso o classificador abaixo tolera valores novos em vez de
 * quebrar: um estado desconhecido cai em `null` e a decisao sai do placar.
 */
export const ESTADOS_CONHECIDOS = ['em_jogo', 'encerrada'] as const;

function chave(estado: string): string {
  let out = '';
  for (const ch of estado.normalize('NFD')) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x0300 && cp <= 0x036f) continue; // marca combinante
    out += ch;
  }
  return out.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/**
 * Traduz `estado` no que ele sozinho consegue dizer.
 * `null` = "nao sei, decida pelo placar".
 */
export function classifyEstado(estado: string): 'aberta' | 'ended' | null {
  const k = chave(estado);
  if (k === 'em_jogo') return 'aberta';
  if (k === 'encerrada') return 'ended';

  // Tolerancia a estados futuros (assinatura/aprovacao da etapa 4).
  if (/(encerr|finaliz|conclu|cancel|termin|assinad|aprovad|homologad)/.test(k)) return 'ended';
  if (/(jogo|andamento|inicia|corrent|vivo|aberta|aberto)/.test(k)) return 'aberta';
  return null;
}

/** Total de pontos ja disputados na sumula inteira. */
export function totalPontos(status: SumulaStatus): number {
  return status.sets.reduce((acc, s) => acc + s.A + s.B, 0);
}

/**
 * A fase efetiva.
 *
 * O apito inicial e o PRIMEIRO RALLY, nao uma transicao de `estado`: a sumula
 * ja e criada `em_jogo`, entao esperar `estado` mudar significaria esperar
 * para sempre. Enquanto nao ha ponto algum, a mesa esta em preparo — e esse e
 * exatamente o intervalo em que a abertura (arbitragem, escalacoes) deve rodar.
 */
export function derivePhase(status: SumulaStatus): MatchPhase {
  if (classifyEstado(status.estado) === 'ended') return 'ended';

  const set = status.set_atual;
  const comecou =
    totalPontos(status) > 0 ||
    status.sets_vencidos.A > 0 ||
    status.sets_vencidos.B > 0 ||
    (set != null && (set.pontos.A > 0 || set.pontos.B > 0));

  return comecou ? 'live' : 'pre';
}

/** Quantos sets um time precisa vencer para fechar a partida. */
export function setsParaVencer(melhorDe: number): number {
  return Math.floor(melhorDe / 2) + 1;
}

/** True quando o set corrente e o decisivo (alvo cai para `pontos_tiebreak`). */
export function ehTiebreak(status: SumulaStatus): boolean {
  const n = status.set_atual?.numero;
  return n != null && status.formato.melhor_de > 1 && n === status.formato.melhor_de;
}
