/**
 * O que os dois layouts de placar compartilham.
 *
 * Existe porque o vertical NAO e o horizontal reposicionado — sao geometrias
 * diferentes por motivos diferentes (ver `scoreboardVertical.ts`). O que pode
 * ser comum e a paleta e o tratamento de texto; a forma, nao.
 */

export const COR = {
  fundo: '#0b1220',
  fundoAlt: '#111c30',
  texto: '#f4f7fb',
  textoFraco: '#8fa3bf',
  destaque: '#ffcc33',
  saque: '#31d67a',
  linha: '#1e2d47',
} as const;

export const FONTE = "Inter, 'Segoe UI', Roboto, Arial, sans-serif";

/**
 * Escapa texto para XML.
 *
 * Nome de equipe vem do banco e passa por mao humana: um "Sub-15 & Adulto"
 * quebraria o SVG inteiro, e o burn falharia no fim da partida, quando nao ha
 * como regravar.
 */
export function escapaXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Corta nome comprido para nao estourar a tarja. */
export function encurta(nome: string, max = 14): string {
  const n = nome.trim();
  if (n.length <= max) return n;
  return n.slice(0, max - 1).trimEnd() + '…';
}

/**
 * Linha de base para centrar texto verticalmente em `cy`.
 *
 * Existe para NAO usar `dominant-baseline="central"`. Aquele atributo funciona
 * no resvg (desktop) mas tem suporte irregular em renderizadores de SVG para
 * Android — e o mesmo SVG precisa sair igual nos dois, porque no celular ele e
 * queimado ao vivo e nao ha como conferir depois.
 *
 * A conta: a altura de caixa alta de uma fonte sem serifa fica em torno de 70%
 * do corpo, entao descer metade disso a partir do centro alinha o miolo do
 * texto com `cy`.
 */
export function baseCentral(cy: number, fontSize: number): number {
  return cy + fontSize * 0.35;
}
