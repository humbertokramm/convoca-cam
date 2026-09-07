import { ConvocaError, type SumulaRef } from './convocaClient';
import type { TeamSide } from '../core/types';

/**
 * A ficha de abertura: o que o video mostra ANTES do primeiro rally.
 *
 * Nao existe RPC para isto e nao precisa existir. A migration 090 do AVF
 * ("sumula publica") deu `grant select ... to anon` e policy `using (true)` a
 * sumulas, sumula_equipes, sumula_atletas e sumula_oficiais — a sumula inteira
 * ja e publica. Basta ler as tabelas pelo PostgREST.
 *
 * O `Accept-Profile: rede` e obrigatorio aqui: sem ele o PostgREST procura em
 * `public` e devolve PGRST205. Isso NAO contradiz a migration 093 (o wrapper
 * `public.sumula_status`, criado porque "um link que precisa de cabecalho nao e
 * um link") — 093 resolve o link que o operador COLA. Esta chamada e feita pelo
 * app, que manda cabecalho a vontade.
 *
 * Uma requisicao so, com os aninhados. Lida uma vez, quando o link e colado.
 *
 * DIVIDA CONHECIDA: isto le tabelas cruas, e forma de tabela nao e contrato —
 * a mesma exposicao que `reconstruir.ts` tinha antes da 126. Fica por ora
 * porque a abertura roda ANTES do jogo: se o formato mudar, o operador ve o
 * cartao errado na hora e ninguem perde a gravacao. Na reconstrucao a mesma
 * falha sairia num video ja publicado, e era por isso que la valia uma RPC.
 * Colunas de que dependemos:
 *
 *   sumulas(id, titulo, estado, sistema, melhor_de, pontos_set, pontos_tiebreak)
 *   sumula_equipes(lado, nome)  ->  sumula_atletas(numero, nome, libero, capitao)
 *   sumula_oficiais(papel, nome, ordem)
 */

export interface AtletaSumula {
  numero: number | null;
  nome: string;
  libero: boolean;
  capitao: boolean;
}

export interface EquipeSumula {
  lado: TeamSide;
  nome: string;
  atletas: AtletaSumula[];
}

/** `papel` e checado no banco como 'arbitro_1' | 'arbitro_2' | 'mesa'. */
export interface Oficial {
  papel: string;
  nome: string;
  ordem: number;
}

export interface Abertura {
  sumulaId: string;
  titulo: string;
  estado: string;
  sistema: string;
  formato: { melhor_de: number; pontos_set: number; pontos_tiebreak: number };
  equipes: Record<TeamSide, EquipeSumula | null>;
  oficiais: Oficial[];
}

/** Rotulo de exibicao para o cartao de abertura. */
export function rotuloPapel(papel: string): string {
  switch (papel) {
    case 'arbitro_1': return '1o arbitro';
    case 'arbitro_2': return '2o arbitro';
    case 'mesa': return 'Mesa';
    default: return papel;
  }
}

const SELECT = [
  'id,titulo,estado,sistema,melhor_de,pontos_set,pontos_tiebreak',
  'sumula_equipes(lado,nome,sumula_atletas(numero,nome,libero,capitao))',
  'sumula_oficiais(papel,nome,ordem)',
].join(',');

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseAtleta(v: unknown): AtletaSumula | null {
  if (!isObj(v) || typeof v.nome !== 'string') return null;
  return {
    numero: typeof v.numero === 'number' ? v.numero : null,
    nome: v.nome,
    libero: v.libero === true,
    capitao: v.capitao === true,
  };
}

export function parseAbertura(raw: unknown): Abertura {
  const linha = Array.isArray(raw) ? raw[0] : raw;
  if (!isObj(linha)) throw new ConvocaError('Sumula nao encontrada para este link.');

  const equipes: Record<TeamSide, EquipeSumula | null> = { A: null, B: null };
  const brutas = Array.isArray(linha.sumula_equipes) ? linha.sumula_equipes : [];

  for (const e of brutas) {
    if (!isObj(e)) continue;
    const lado = e.lado === 'A' || e.lado === 'B' ? e.lado : null;
    if (!lado) continue;

    const atletas = (Array.isArray(e.sumula_atletas) ? e.sumula_atletas : [])
      .map(parseAtleta)
      .filter((a): a is AtletaSumula => a !== null)
      // O embed do PostgREST nao garante ordem; a abertura lista por numero,
      // que e como a escalacao e lida em quadra. Sem numero vai para o fim.
      .sort((x, y) => (x.numero ?? 9999) - (y.numero ?? 9999) || x.nome.localeCompare(y.nome, 'pt-BR'));

    equipes[lado] = { lado, nome: typeof e.nome === 'string' ? e.nome : `Equipe ${lado}`, atletas };
  }

  const oficiais = (Array.isArray(linha.sumula_oficiais) ? linha.sumula_oficiais : [])
    .filter(isObj)
    .filter((o) => typeof o.nome === 'string' && typeof o.papel === 'string')
    .map((o) => ({ papel: o.papel as string, nome: o.nome as string, ordem: typeof o.ordem === 'number' ? o.ordem : 1 }))
    .sort((a, b) => a.ordem - b.ordem || a.papel.localeCompare(b.papel));

  const n = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);

  return {
    sumulaId: typeof linha.id === 'string' ? linha.id : '',
    titulo: typeof linha.titulo === 'string' ? linha.titulo : '',
    estado: typeof linha.estado === 'string' ? linha.estado : '',
    sistema: typeof linha.sistema === 'string' ? linha.sistema : '',
    formato: {
      melhor_de: n(linha.melhor_de, 3),
      pontos_set: n(linha.pontos_set, 25),
      pontos_tiebreak: n(linha.pontos_tiebreak, 15),
    },
    equipes,
    oficiais,
  };
}

export async function fetchAbertura(
  ref: SumulaRef,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<Abertura> {
  const { timeoutMs = 10_000, signal } = opts;
  const url = new URL('/rest/v1/sumulas', ref.host);
  url.searchParams.set('id', `eq.${ref.sumulaId}`);
  url.searchParams.set('select', SELECT);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        apikey: ref.apiKey,
        Accept: 'application/json',
        // Sem isto o PostgREST procura em `public` e devolve PGRST205.
        'Accept-Profile': 'rede',
      },
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const corpo = await res.text().catch(() => '');
      throw new ConvocaError(`HTTP ${res.status} ao ler a abertura. ${corpo.slice(0, 200)}`);
    }
    return parseAbertura(await res.json());
  } catch (e) {
    if (e instanceof ConvocaError) throw e;
    if ((e as Error)?.name === 'AbortError') throw new ConvocaError('Timeout ao ler a abertura.', e);
    throw new ConvocaError(`Falha de rede ao ler a abertura: ${(e as Error)?.message}`, e);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
