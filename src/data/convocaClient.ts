import type { SetAtual, SetResumo, SumulaSnapshot, SumulaStatus, TeamSide } from '../core/types';

const DEFAULT_HOST = 'https://ajbgjlnxfmdqsdzglybd.supabase.co';
const RPC_PATH = '/rest/v1/rpc/sumula_status';
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export class ConvocaError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'ConvocaError';
  }
}

export interface SumulaRef {
  host: string;
  sumulaId: string;
  apiKey: string;
}

/**
 * Aceita o que o operador tiver em maos e extrai a referencia da sumula:
 *
 *  - URL completa da RPC (`.../rpc/sumula_status?p_sumula=...&apikey=...`)
 *  - URL publica do convoca.net contendo o UUID (hash route inclusive)
 *  - UUID cru (a chave entao precisa vir de `fallbackApiKey`)
 *
 * A chave e publishable (`sb_publishable_...`): e desenhada para ir no cliente,
 * protegida por RLS no servidor. Nao e segredo.
 */
export function resolveSumulaRef(input: string, fallbackApiKey?: string): SumulaRef {
  const bruto = input.trim();
  if (!bruto) throw new ConvocaError('Link vazio.');

  let host = DEFAULT_HOST;
  let sumulaId: string | undefined;
  let apiKey = fallbackApiKey;

  if (/^https?:\/\//i.test(bruto)) {
    let url: URL;
    try {
      url = new URL(bruto);
    } catch (e) {
      throw new ConvocaError(`Link malformado: ${bruto}`, e);
    }

    const qsKey = url.searchParams.get('apikey');
    if (qsKey) apiKey = qsKey;

    const qsSumula = url.searchParams.get('p_sumula') ?? url.searchParams.get('sumula');
    if (qsSumula) sumulaId = qsSumula;

    // Rota em hash do convoca.net: o UUID pode estar depois do '#'.
    if (!sumulaId) sumulaId = bruto.match(UUID_RE)?.[0];

    if (url.pathname.includes('/rest/v1/')) host = url.origin;
  } else {
    sumulaId = bruto.match(UUID_RE)?.[0];
  }

  if (!sumulaId) throw new ConvocaError('Nao encontrei o id da sumula (UUID) no link informado.');
  if (!apiKey) throw new ConvocaError('Nao encontrei a apikey no link e nenhuma foi configurada.');

  return { host, sumulaId, apiKey };
}

export function buildStatusUrl(ref: SumulaRef): string {
  const url = new URL(RPC_PATH, ref.host);
  url.searchParams.set('p_sumula', ref.sumulaId);
  return url.toString();
}

// ---------------------------------------------------------------- validacao

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown, campo: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ConvocaError(`Campo "${campo}" deveria ser numero, veio ${JSON.stringify(v)}`);
  }
  return v;
}

function str(v: unknown, campo: string): string {
  if (typeof v !== 'string') {
    throw new ConvocaError(`Campo "${campo}" deveria ser string, veio ${JSON.stringify(v)}`);
  }
  return v;
}

function side(v: unknown): TeamSide | null {
  return v === 'A' || v === 'B' ? v : null;
}

function pares(v: unknown, campo: string): Record<TeamSide, number> {
  if (!isObj(v)) throw new ConvocaError(`Campo "${campo}" deveria ser objeto {A,B}.`);
  return { A: num(v.A, `${campo}.A`), B: num(v.B, `${campo}.B`) };
}

function parseSetAtual(v: unknown): SetAtual | null {
  if (v == null) return null;
  if (!isObj(v)) throw new ConvocaError('Campo "set_atual" deveria ser objeto ou nulo.');
  return {
    numero: num(v.numero, 'set_atual.numero'),
    pontos: pares(v.pontos, 'set_atual.pontos'),
    saque: side(v.saque),
    alvo: num(v.alvo, 'set_atual.alvo'),
    encerrado: v.encerrado === true,
  };
}

function parseSets(v: unknown): SetResumo[] {
  if (v == null) return [];
  if (!Array.isArray(v)) throw new ConvocaError('Campo "sets" deveria ser lista.');
  return v.map((s, i) => {
    if (!isObj(s)) throw new ConvocaError(`sets[${i}] deveria ser objeto.`);
    return {
      numero: num(s.numero, `sets[${i}].numero`),
      A: num(s.A, `sets[${i}].A`),
      B: num(s.B, `sets[${i}].B`),
      encerrado: s.encerrado === true,
    };
  });
}

/** Valida o payload cru. Dado externo nunca entra no app sem passar por aqui. */
export function parseSumulaStatus(raw: unknown): SumulaStatus {
  // PostgREST pode devolver a linha unica embrulhada em array.
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!isObj(v)) throw new ConvocaError('Resposta da sumula nao e um objeto.');

  const formato = isObj(v.formato) ? v.formato : {};
  const equipes = isObj(v.equipes) ? v.equipes : {};

  return {
    sumula_id: str(v.sumula_id, 'sumula_id'),
    titulo: typeof v.titulo === 'string' ? v.titulo : '',
    estado: str(v.estado, 'estado'),
    sistema: typeof v.sistema === 'string' ? v.sistema : '',
    formato: {
      melhor_de: num(formato.melhor_de ?? 3, 'formato.melhor_de'),
      pontos_set: num(formato.pontos_set ?? 25, 'formato.pontos_set'),
      pontos_tiebreak: num(formato.pontos_tiebreak ?? 15, 'formato.pontos_tiebreak'),
    },
    equipes: {
      A: typeof equipes.A === 'string' ? equipes.A : 'Equipe A',
      B: typeof equipes.B === 'string' ? equipes.B : 'Equipe B',
    },
    sets_vencidos: pares(v.sets_vencidos ?? { A: 0, B: 0 }, 'sets_vencidos'),
    set_atual: parseSetAtual(v.set_atual),
    sets: parseSets(v.sets),
    versao: num(v.versao ?? 0, 'versao'),
    atualizado_em: typeof v.atualizado_em === 'string' ? v.atualizado_em : '',
  };
}

// ------------------------------------------------------------------- fetch

export async function fetchSumulaStatus(
  ref: SumulaRef,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<SumulaSnapshot> {
  const { timeoutMs = 8000, signal } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const res = await fetch(buildStatusUrl(ref), {
      method: 'GET',
      headers: { apikey: ref.apiKey, Accept: 'application/json' },
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const corpo = await res.text().catch(() => '');
      throw new ConvocaError(`HTTP ${res.status} ao ler a sumula. ${corpo.slice(0, 200)}`);
    }

    const observedAt = Date.now();
    const status = parseSumulaStatus(await res.json());
    const t = status.atualizado_em ? Date.parse(status.atualizado_em) : NaN;

    return { status, observedAt, serverAt: Number.isNaN(t) ? null : t };
  } catch (e) {
    if (e instanceof ConvocaError) throw e;
    if ((e as Error)?.name === 'AbortError') throw new ConvocaError('Timeout ao ler a sumula.', e);
    throw new ConvocaError(`Falha de rede ao ler a sumula: ${(e as Error)?.message}`, e);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
