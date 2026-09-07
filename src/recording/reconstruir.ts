import { ConvocaError, fetchSumulaStatus, type SumulaRef } from '../data/convocaClient';
import type { SumulaStatus } from '../core/types';
import type { ScoreboardState, Lado } from '../overlay/scoreboard';
import { CONTRATO_VERSAO, type Timeline, type TimelineEvento } from './timeline';

/**
 * Reconstroi a timeline DEPOIS da partida.
 *
 * POR QUE ISSO EXISTE. O polling ao vivo constroi a timeline durante o jogo,
 * mas depende de o celular estar online do primeiro ao ultimo rally — num
 * ginasio isso e otimismo. Aqui a exigencia cai para uma so: saber em que
 * instante a gravacao comecou.
 *
 * Esta e a FONTE DE PRODUCAO do video final. Os instantes vem de
 * `sumula_rallies.criado_em`, a hora do ponto no relogio do servidor, e por
 * isso os eventos saem com `precisao: 'rally'`. O caminho ao vivo
 * (`TimelineBuilder`) carimba pelo `atualizado_em`, que desde a 125 marca a
 * ultima escrita de qualquer tipo — bom para o HUD, aproximado para o video.
 *
 * DUAS FUNCOES, NENHUMA TABELA CRUA. Antes este arquivo lia `sumula_rallies` e
 * `sumula_sets` direto e refazia por conta duas regras do dono do schema: o
 * filtro do cursor (`ordem <= rallies_ativos`) e a dobra do placar. Forma de
 * tabela nao e contrato, e pior: aquela era a TERCEIRA implementacao da regra
 * de "quais rallies contam" — a triplicacao que ja tinha produzido um ponto
 * fantasma. A migration 126 expos `sumula_timeline`, que devolve os rallies ja
 * filtrados com placar corrente e saque. O join e a dobra foram apagados daqui.
 *
 * Sobrou UMA regra derivada: `alvoDoSet`. Ela sai de `formato`, que e campo de
 * contrato do `sumula_status` — derivar de valor contratado e diferente de
 * duplicar um filtro sobre linhas cruas.
 *
 * LIMITE HONESTO. Isto reproduz a progressao correta do placar, nao a historia
 * da mesa. Se a mesa marcou e desfez trinta segundos depois, o video sai certo
 * do inicio ao fim, mas nao ha como saber que houve trinta segundos de placar
 * errado no ar — desfazer nao tem carimbo de tempo. O polling ao vivo ve isso
 * (evento `correcao`); este nao.
 *
 * E O QUE ISTO NAO SALVA. A promessa "o video sai igual sem internet" vale para
 * o celular que GRAVA, nao para a mesa. Se quem apita ficou sem sinal, o rally
 * nao existe em lugar nenhum e nao ha o que reconstruir.
 */

interface SetRPC {
  numero: number;
  /** Quem saca ANTES do primeiro ponto do set — instante sem rally que responda. */
  saque_inicial: Lado | null;
}

interface RallyRPC {
  set_numero: number;
  ordem: number;
  ponto_de: Lado;
  criado_em: string;
  /** Placar DEPOIS deste rally, acumulado no set. */
  a: number;
  b: number;
  /** Quem saca o rally SEGUINTE. */
  saque: Lado | null;
}

export interface TimelineRPC {
  sumula_id: string;
  sets: SetRPC[];
  rallies: RallyRPC[];
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function lado(v: unknown): Lado | null {
  return v === 'A' || v === 'B' ? v : null;
}

export function parseTimelineRPC(raw: unknown): TimelineRPC {
  const v = Array.isArray(raw) ? raw[0] : raw;
  // A funcao devolve `null` para sumula inexistente.
  if (v == null) throw new ConvocaError('Sumula nao encontrada.');
  if (!isObj(v)) throw new ConvocaError('Resposta de sumula_timeline nao e objeto.');

  const sets = (Array.isArray(v.sets) ? v.sets : []).filter(isObj).map((s) => ({
    numero: Number(s.numero),
    saque_inicial: lado(s.saque_inicial),
  }));

  const rallies = (Array.isArray(v.rallies) ? v.rallies : []).filter(isObj).map((r) => ({
    set_numero: Number(r.set_numero),
    ordem: Number(r.ordem),
    ponto_de: lado(r.ponto_de) ?? 'A',
    criado_em: String(r.criado_em),
    a: Number(r.a),
    b: Number(r.b),
    saque: lado(r.saque),
  }));

  return { sumula_id: String(v.sumula_id ?? ''), sets, rallies };
}

/**
 * Le `public.sumula_timeline`.
 *
 * Pelo atalho em `public`, entao sem `Accept-Profile` — a mesma escolha da 093.
 */
export async function fetchTimelineRPC(
  ref: SumulaRef,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<TimelineRPC> {
  const { timeoutMs = 15_000, signal } = opts;
  const url = new URL('/rest/v1/rpc/sumula_timeline', ref.host);
  url.searchParams.set('p_sumula', ref.sumulaId);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const res = await fetch(url.toString(), {
      headers: { apikey: ref.apiKey, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new ConvocaError(
        `HTTP ${res.status} em sumula_timeline. ${(await res.text().catch(() => '')).slice(0, 200)}`,
      );
    }
    return parseTimelineRPC(await res.json());
  } catch (e) {
    if (e instanceof ConvocaError) throw e;
    if ((e as Error)?.name === 'AbortError') throw new ConvocaError('Timeout em sumula_timeline.');
    throw new ConvocaError(`Falha de rede em sumula_timeline: ${(e as Error)?.message}`, e);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Pontuacao que fecha o set.
 *
 * Derivada de `formato`, que e campo de contrato do `sumula_status`. O
 * `set_atual.alvo` de la responde so pelo set corrente, e a reconstrucao
 * precisa dos anteriores tambem.
 */
export function alvoDoSet(numero: number, formato: SumulaStatus['formato']): number {
  return formato.melhor_de > 1 && numero === formato.melhor_de
    ? formato.pontos_tiebreak
    : formato.pontos_set;
}

export interface DadosBrutos {
  timeline: TimelineRPC;
  status: SumulaStatus;
}

export async function buscaDadosBrutos(ref: SumulaRef): Promise<DadosBrutos> {
  // As duas leituras sao independentes. `sumula_timeline` traz rallies, placar
  // corrente e saque; `sumula_status` traz o que ela deliberadamente NAO
  // duplica: formato, equipes e quais sets estao encerrados.
  const [timeline, snap] = await Promise.all([fetchTimelineRPC(ref), fetchSumulaStatus(ref)]);
  return { timeline, status: snap.status };
}

/**
 * Converte os rallies em estados de placar.
 *
 * `t0Servidor` e o instante do primeiro frame MEDIDO NO RELOGIO DO SERVIDOR.
 * Ancorar ali elimina o desvio entre os relogios de uma vez: os dois lados da
 * subtracao vem do mesmo relogio, e nao ha skew a estimar.
 */
export function montaEventos(d: DadosBrutos, t0Servidor: number): TimelineEvento[] {
  const { timeline, status } = d;
  const equipes = { A: status.equipes.A, B: status.equipes.B };
  const saqueInicial = new Map(timeline.sets.map((s) => [s.numero, s.saque_inicial]));

  // Quais sets estao encerrados e com que placar vem do `sumula_status`, que e
  // quem responde por `encerrado` — a 126 deliberadamente nao duplica isso.
  const setsVencidosAntesDe = (numero: number): Record<Lado, number> => {
    let a = 0;
    let b = 0;
    for (const s of status.sets) {
      if (s.numero >= numero || !s.encerrado) continue;
      if (s.A > s.B) a += 1;
      else if (s.B > s.A) b += 1;
    }
    return { A: a, B: b };
  };

  const eventos: TimelineEvento[] = [];

  for (const r of timeline.rallies) {
    const serverAt = Date.parse(r.criado_em);
    if (Number.isNaN(serverAt)) continue;

    const tiebreak = status.formato.melhor_de > 1 && r.set_numero === status.formato.melhor_de;
    const estado: ScoreboardState = {
      equipes,
      setsVencidos: setsVencidosAntesDe(r.set_numero),
      pontos: { A: r.a, B: r.b },
      saque: r.saque,
      setNumero: r.set_numero,
      alvo: alvoDoSet(r.set_numero, status.formato),
      tiebreak,
    };

    eventos.push({
      videoMs: serverAt - t0Servidor,
      // `criado_em` do proprio rally: hora do ponto, nao de uma escrita
      // qualquer. Esta e a fonte precisa.
      precisao: 'rally',
      // A reconstrucao nao conhece a `versao` de cada escrita — ela nao fica
      // gravada no rally. Zero e o valor honesto, nao um numero inventado que
      // pareceria comparavel.
      versao: 0,
      serverAt,
      estado,
      evento: {
        tipo: 'ponto', lado: r.ponto_de, set: r.set_numero,
        a: r.a, b: r.b, at: serverAt, serverAt, versao: 0,
      },
    });

    // Antes do primeiro ponto do set a tarja apareceria sem indicador de saque.
    // `saque_inicial` existe exatamente para esse instante.
    if (r.a + r.b === 1) {
      const si = saqueInicial.get(r.set_numero) ?? null;
      if (si) {
        eventos.push({
          videoMs: serverAt - t0Servidor - 1,
          precisao: 'rally',
          versao: 0,
          serverAt: serverAt - 1,
          estado: { ...estado, pontos: { A: 0, B: 0 }, saque: si },
          evento: {
            tipo: 'set_inicio', numero: r.set_numero,
            at: serverAt - 1, serverAt: serverAt - 1, versao: 0,
          },
        });
      }
    }
  }

  return eventos.sort((x, y) => x.videoMs - y.videoMs);
}

export async function reconstruirTimeline(ref: SumulaRef, t0Servidor: number): Promise<Timeline> {
  const d = await buscaDadosBrutos(ref);
  return {
    sumulaId: ref.sumulaId,
    contrato: CONTRATO_VERSAO,
    gravacaoIniciadaEm: t0Servidor,
    // Tudo aqui opera em hora de servidor — `criado_em` e `t0Servidor` vem do
    // mesmo relogio. Nao ha conversao, logo nao ha incerteza a declarar.
    relogio: { offsetMs: 0, incertezaMs: 0, amostras: 0, reinicios: 0 },
    eventos: montaEventos(d, t0Servidor),
  };
}
