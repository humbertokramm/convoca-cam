/**
 * O placar de volei, em SVG.
 *
 * SVG e nao desenho direto por dois motivos: e uma funcao pura de string, logo
 * testavel sem tela nem GPU; e o mesmo arquivo serve para o HUD do celular e
 * para o burn no desktop, sem duas implementacoes do mesmo layout divergirem.
 *
 * O placar muda poucas dezenas de vezes numa partida — um estado por rally.
 * Isso e o que torna o burn barato: rasteriza-se um PNG por ESTADO, nao por
 * frame, e o ffmpeg sobrepoe cada um durante a sua janela de tempo.
 */

import { COR, FONTE, encurta, escapaXml } from './tema';

// Reexportados porque `scoreboard` era o endereco original deles.
export { escapaXml, encurta };

export type Lado = 'A' | 'B';

export interface ScoreboardState {
  equipes: Record<Lado, string>;
  setsVencidos: Record<Lado, number>;
  pontos: Record<Lado, number>;
  /** Quem esta com o saque. `null` antes do primeiro rally do set. */
  saque: Lado | null;
  setNumero: number;
  /** Pontuacao que fecha este set: 25, ou 15 no decisivo. */
  alvo: number;
  tiebreak: boolean;
}

export interface ScoreboardOpts {
  /** Largura do quadro de video. O placar escala junto. */
  width?: number;
  height?: number;
  /** Opacidade do fundo da tarja. */
  opacidade?: number;
}

/**
 * A tarja do placar, ancorada no canto inferior esquerdo.
 *
 * O SVG tem o tamanho do quadro inteiro e e transparente fora da tarja, para o
 * ffmpeg sobrepor em 0,0 sem calcular deslocamento.
 */
export function scoreboardSvg(s: ScoreboardState, opts: ScoreboardOpts = {}): string {
  const W = opts.width ?? 1920;
  const H = opts.height ?? 1080;
  const opacidade = opts.opacidade ?? 0.88;

  // Tudo em proporcao a altura, para o layout sobreviver a 720p e 4K.
  const u = H / 1080;
  const barraH = 108 * u;
  const x = 64 * u;
  const y = H - barraH - 64 * u;

  const colNome = 300 * u;
  const colSets = 74 * u;
  const colPontos = 104 * u;
  const larguraTotal = colNome + colSets + colPontos;

  const linhaH = barraH / 2;
  const raio = 10 * u;

  const nomeA = escapaXml(encurta(s.equipes.A));
  const nomeB = escapaXml(encurta(s.equipes.B));

  /** Uma das duas linhas da tarja. */
  const linha = (lado: Lado, i: number): string => {
    const ly = y + i * linhaH;
    const nome = lado === 'A' ? nomeA : nomeB;
    const saca = s.saque === lado;
    const fundo = i === 0 ? COR.fundo : COR.fundoAlt;

    return `
    <g>
      <rect x="${x}" y="${ly}" width="${larguraTotal}" height="${linhaH}"
            fill="${fundo}" fill-opacity="${opacidade}"/>
      ${
        saca
          ? `<circle cx="${x + 22 * u}" cy="${ly + linhaH / 2}" r="${7 * u}" fill="${COR.saque}"/>`
          : ''
      }
      <text x="${x + 42 * u}" y="${ly + linhaH / 2}" fill="${COR.texto}"
            font-size="${30 * u}" font-weight="600" dominant-baseline="central"
            font-family="${FONTE}">${nome}</text>

      <rect x="${x + colNome}" y="${ly}" width="${colSets}" height="${linhaH}"
            fill="#000000" fill-opacity="${opacidade * 0.5}"/>
      <text x="${x + colNome + colSets / 2}" y="${ly + linhaH / 2}" fill="${COR.textoFraco}"
            font-size="${28 * u}" font-weight="600" text-anchor="middle" dominant-baseline="central"
            font-family="${FONTE}">${s.setsVencidos[lado]}</text>

      <rect x="${x + colNome + colSets}" y="${ly}" width="${colPontos}" height="${linhaH}"
            fill="${COR.destaque}" fill-opacity="${opacidade}"/>
      <text x="${x + colNome + colSets + colPontos / 2}" y="${ly + linhaH / 2}" fill="#101010"
            font-size="${40 * u}" font-weight="700" text-anchor="middle" dominant-baseline="central"
            font-family="${FONTE}">${s.pontos[lado]}</text>
    </g>`;
  };

  const rotuloSet = s.tiebreak ? `SET ${s.setNumero} · TIE-BREAK` : `SET ${s.setNumero}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <clipPath id="tarja">
      <rect x="${x}" y="${y}" width="${larguraTotal}" height="${barraH}" rx="${raio}" ry="${raio}"/>
    </clipPath>
  </defs>
  <g clip-path="url(#tarja)">
    ${linha('A', 0)}
    ${linha('B', 1)}
    <line x1="${x}" y1="${y + linhaH}" x2="${x + larguraTotal}" y2="${y + linhaH}"
          stroke="${COR.linha}" stroke-width="${1.5 * u}"/>
  </g>
  <text x="${x}" y="${y - 14 * u}" fill="${COR.textoFraco}"
        font-size="${22 * u}" font-weight="600" letter-spacing="${2 * u}"
        font-family="${FONTE}">${escapaXml(rotuloSet)} · ATÉ ${s.alvo}</text>
</svg>`;
}

/**
 * Chave que identifica um estado visual.
 *
 * Dois momentos com a mesma chave produzem PNG identico, entao o burn rasteriza
 * uma vez e reaproveita. Numa partida de tres sets isso derruba centenas de
 * momentos para poucas dezenas de arquivos.
 */
export function chaveEstado(s: ScoreboardState): string {
  return [
    s.equipes.A, s.equipes.B,
    s.setsVencidos.A, s.setsVencidos.B,
    s.pontos.A, s.pontos.B,
    s.saque ?? '-',
    s.setNumero, s.alvo, s.tiebreak ? 't' : 'n',
  ].join('|');
}
