import { ConvocaError, fetchSumulaStatus, type SumulaRef } from './convocaClient';
import { derivePhase, type MatchPhase } from '../core/phase';
import type { SumulaSnapshot, SumulaStatus, TeamSide } from '../core/types';

/**
 * Campos comuns a todo evento.
 *
 * `versao` carimba a escrita que originou o evento. E o que torna a timeline do
 * video auditavel depois: cada overlay queimado aponta para um numero que
 * existe na sumula, em vez de so um horario.
 */
interface EventoBase {
  /** Epoch ms local em que observamos. */
  at: number;
  /** Epoch ms do servidor (`atualizado_em`), quando disponivel. */
  serverAt: number | null;
  /** `rede.sumulas.versao` no momento do evento. */
  versao: number;
}

/**
 * O que cada evento carrega, sem os campos comuns.
 *
 * Uniao propria em vez de `Omit<MatchEvent, keyof EventoBase>`: `Omit` sobre
 * uniao nao distribui, colapsa para as chaves que todos os membros tem — que
 * aqui e so `tipo`.
 */
type EventoPayload =
  | { tipo: 'fase'; de: MatchPhase | null; para: MatchPhase }
  | { tipo: 'ponto'; lado: TeamSide; set: number; a: number; b: number }
  | { tipo: 'correcao'; set: number; a: number; b: number }
  | { tipo: 'saque'; lado: TeamSide | null }
  | { tipo: 'set_fim'; numero: number; a: number; b: number; vencedor: TeamSide | null }
  | { tipo: 'set_inicio'; numero: number }
  | { tipo: 'fim'; setsA: number; setsB: number };

export type MatchEvent = EventoBase & EventoPayload;

export interface WatchHandlers {
  onSnapshot?(snap: SumulaSnapshot, fase: MatchPhase): void;
  /** Eventos em ordem. `fase pre->live` e o apito inicial. */
  onEvent?(ev: MatchEvent): void;
  onError?(err: ConvocaError, tentativasSeguidas: number): void;
  /** `estado` fora de ('em_jogo','encerrada') — a etapa 4 vai acrescentar. */
  onEstadoNovo?(estado: string): void;
  /**
   * Houve escrita na sumula que nao mexeu em nada que o placar mostra:
   * substituicao, cartao, mudanca de escalacao. Nada a redesenhar.
   */
  onEscritaInvisivel?(versao: number): void;
}

export interface WatchOptions {
  intervaloLiveMs?: number;
  intervaloIdleMs?: number;
  backoffMaxMs?: number;
  signal?: AbortSignal;
}

export interface WatchHandle {
  stop(): void;
  atual(): SumulaSnapshot | null;
  refresh(): Promise<void>;
}

/**
 * Assinatura do que o overlay desenha.
 *
 * Desde a migration 125 do AVF, `versao` e um contador de ESCRITAS guardado em
 * `rede.sumulas`, mantido por gatilho nas oito tabelas filhas e na propria
 * sumula — nao mais `count(*)` de rallies. Ele anda a cada ponto, desfazer,
 * substituicao, cartao e no encerramento, e nunca repete valor anterior.
 * Compara-se com `!==`, nao com `>`: e selo de mudanca, nao sequencia sem
 * buracos (sumulas antigas foram rebaseadas para `count(rallies)+1`).
 *
 * A assinatura fica mesmo assim, por dois motivos que nada tem a ver com
 * desconfianca:
 *
 *  1. Nao custa nada. `sumula_status` devolve o objeto inteiro de qualquer
 *     jeito — nao existe chamada mais barata que traga so `versao`. O que se
 *     economizaria trocando e uma concatenacao de string, nao bytes na rede.
 *  2. `versao` e mais sensivel que o placar: ela anda em escritas que o overlay
 *     nao mostra. A assinatura separa "mudou algo" de "mudou algo VISIVEL", e e
 *     a segunda pergunta que decide se vale redesenhar um frame.
 */
function assinatura(s: SumulaStatus): string {
  const set = s.set_atual;
  return [
    s.estado,
    s.sets_vencidos.A,
    s.sets_vencidos.B,
    set ? `${set.numero}:${set.pontos.A}:${set.pontos.B}:${set.saque ?? '-'}:${set.alvo}:${set.encerrado}` : '-',
    s.sets.map((x) => `${x.numero}:${x.A}:${x.B}:${x.encerrado}`).join(','),
    s.equipes.A,
    s.equipes.B,
  ].join('|');
}

function vencedorDe(a: number, b: number): TeamSide | null {
  return a === b ? null : a > b ? 'A' : 'B';
}

function diffEventos(ant: SumulaStatus | null, novo: SumulaStatus, base: EventoBase): MatchEvent[] {
  const evs: MatchEvent[] = [];
  const push = (e: EventoPayload) => evs.push({ ...base, ...e });

  const faseNova = derivePhase(novo);
  if (!ant) {
    push({ tipo: 'fase', de: null, para: faseNova });
    return evs;
  }

  const faseAnt = derivePhase(ant);
  if (faseAnt !== faseNova) push({ tipo: 'fase', de: faseAnt, para: faseNova });

  const sa = ant.set_atual;
  const sn = novo.set_atual;

  if (sn && (!sa || sa.numero !== sn.numero)) {
    if (sa && !sa.encerrado) {
      push({
        tipo: 'set_fim', numero: sa.numero, a: sa.pontos.A, b: sa.pontos.B,
        vencedor: vencedorDe(sa.pontos.A, sa.pontos.B),
      });
    }
    push({ tipo: 'set_inicio', numero: sn.numero });
  }

  if (sa && sn && sa.numero === sn.numero) {
    const dA = sn.pontos.A - sa.pontos.A;
    const dB = sn.pontos.B - sa.pontos.B;

    if (dA < 0 || dB < 0 || dA + dB > 1) {
      // Placar andou para tras ou pulou: a mesa usou o cursor (desfazer/refazer)
      // ou corrigiu na mao. Narrar isso como rally seria mentira — o overlay so
      // reposiciona no valor novo.
      push({ tipo: 'correcao', set: sn.numero, a: sn.pontos.A, b: sn.pontos.B });
    } else {
      if (dA === 1) push({ tipo: 'ponto', lado: 'A', set: sn.numero, a: sn.pontos.A, b: sn.pontos.B });
      if (dB === 1) push({ tipo: 'ponto', lado: 'B', set: sn.numero, a: sn.pontos.A, b: sn.pontos.B });
    }

    if (!sa.encerrado && sn.encerrado) {
      push({
        tipo: 'set_fim', numero: sn.numero, a: sn.pontos.A, b: sn.pontos.B,
        vencedor: vencedorDe(sn.pontos.A, sn.pontos.B),
      });
    }
    if (sa.saque !== sn.saque) push({ tipo: 'saque', lado: sn.saque });
  }

  if (faseNova === 'ended' && faseAnt !== 'ended') {
    push({ tipo: 'fim', setsA: novo.sets_vencidos.A, setsB: novo.sets_vencidos.B });
  }

  return evs;
}

/**
 * Acompanha a sumula por polling.
 *
 * Polling e nao Realtime porque o anon so enxerga a RPC `public.sumula_status`
 * (a raiz do PostgREST devolve 401): nao ha tabela para assinar por websocket.
 */
export function watchSumula(
  ref: SumulaRef,
  handlers: WatchHandlers = {},
  opts: WatchOptions = {},
): WatchHandle {
  const { intervaloLiveMs = 1500, intervaloIdleMs = 5000, backoffMaxMs = 30_000, signal } = opts;

  let parado = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let ultimo: SumulaSnapshot | null = null;
  let ultimaVersao: number | null = null;
  let ultimaAssinatura: string | null = null;
  let erros = 0;
  const estadosVistos = new Set<string>();

  const ctrl = new AbortController();
  signal?.addEventListener('abort', () => stop(), { once: true });

  async function tick(): Promise<void> {
    if (parado) return;
    try {
      const snap = await fetchSumulaStatus(ref, { signal: ctrl.signal });
      erros = 0;
      const { status } = snap;

      if (!estadosVistos.has(status.estado)) {
        estadosVistos.add(status.estado);
        if (status.estado !== 'em_jogo' && status.estado !== 'encerrada') {
          handlers.onEstadoNovo?.(status.estado);
        }
      }

      const sig = assinatura(status);
      const mudouVersao = status.versao !== ultimaVersao;
      const mudouVisivel = sig !== ultimaAssinatura;

      // `||` de proposito: nem a versao nem o conteudo sozinhos podem deixar
      // uma mudanca passar batido.
      if (!mudouVersao && !mudouVisivel) {
        agenda(intervaloAtual());
        return;
      }

      const anterior = ultimo?.status ?? null;
      ultimo = snap;
      ultimaVersao = status.versao;
      ultimaAssinatura = sig;

      if (!mudouVisivel) {
        handlers.onEscritaInvisivel?.(status.versao);
        agenda(intervaloAtual());
        return;
      }

      handlers.onSnapshot?.(snap, derivePhase(status));
      const base: EventoBase = { at: snap.observedAt, serverAt: snap.serverAt, versao: status.versao };
      for (const ev of diffEventos(anterior, status, base)) handlers.onEvent?.(ev);

      agenda(intervaloAtual());
    } catch (e) {
      if (parado) return;
      erros += 1;
      const err = e instanceof ConvocaError ? e : new ConvocaError(String(e), e);
      handlers.onError?.(err, erros);
      agenda(Math.min(intervaloIdleMs * 2 ** (erros - 1), backoffMaxMs));
    }
  }

  function intervaloAtual(): number {
    const fase = ultimo ? derivePhase(ultimo.status) : 'pre';
    return fase === 'live' ? intervaloLiveMs : intervaloIdleMs;
  }

  function agenda(ms: number): void {
    if (parado) return;
    timer = setTimeout(() => void tick(), ms);
  }

  function stop(): void {
    if (parado) return;
    parado = true;
    if (timer) clearTimeout(timer);
    timer = null;
    ctrl.abort();
  }

  void tick();

  return {
    stop,
    atual: () => ultimo,
    refresh: async () => {
      if (timer) clearTimeout(timer);
      await tick();
    },
  };
}
