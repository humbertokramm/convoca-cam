import type { Lado, ScoreboardState } from './scoreboard';
import { COR, FONTE, encurta, escapaXml } from './tema';

/**
 * O placar para video vertical (9:16), pensado para Reels e Stories.
 *
 * NAO E O LAYOUT HORIZONTAL REPOSICIONADO. Tres coisas mudam de razao:
 *
 *  1. VAI EM CIMA, e nao embaixo. O Instagram desenha a propria interface sobre
 *     a faixa inferior do Reels — legenda, botoes de curtir e compartilhar. Uma
 *     tarja no canto inferior esquerdo, que e a posicao certa no 16:9, fica
 *     coberta. A area de baixo nao e nossa.
 *  2. E MAIS LARGA em proporcao. No 16:9 a tarja ocupa ~24% da largura; a mesma
 *     largura absoluta num quadro de 1080 ocuparia 43% e pareceria desenhada
 *     para outro video. Aqui ela assume a largura util de proposito.
 *  3. TIPO MAIOR. Vertical e assistido no celular, muitas vezes com o video
 *     ocupando menos que a tela cheia. O tamanho que funciona numa TV nao
 *     funciona ali.
 *
 * AREAS RESERVADAS que este layout respeita (proporcoes do quadro, medidas
 * aproximadas e conservadoras da interface do Instagram):
 *
 *   topo    ~6%  : relogio e status do sistema
 *   base   ~22%  : legenda, audio, botoes de acao
 *   direita ~9%  : coluna de botoes (curtir, comentar, enviar)
 */

export interface VerticalOpts {
  width?: number;
  height?: number;
  opacidade?: number;
}

export function scoreboardVerticalSvg(s: ScoreboardState, opts: VerticalOpts = {}): string {
  const W = opts.width ?? 1080;
  const H = opts.height ?? 1920;
  const opacidade = opts.opacidade ?? 0.9;

  // Proporcional a LARGURA aqui, nao a altura: no vertical e a largura que
  // aperta, e e ela que define se o nome da equipe cabe.
  const u = W / 1080;

  const margemTopo = H * 0.065;
  const margemLado = 40 * u;
  const reservaDireita = W * 0.09;

  const linhaH = 96 * u;
  const barraH = linhaH * 2;
  const y = margemTopo + 34 * u; // espaco para o rotulo do set acima
  const x = margemLado;
  const raio = 14 * u;

  // Colunas de largura FIXA, e a barra e a soma delas — nao a largura util.
  // Esticar a barra ate a margem faria a coluna do nome absorver toda a folga,
  // e sobraria um vao morto entre o nome e os numeros. Uma barra de ~58% da
  // largura parece decidida; uma barra cheia com buraco no meio parece erro.
  const colPontos = 118 * u;
  const colSets = 84 * u;
  const colNome = 420 * u;
  const larguraBarra = colNome + colSets + colPontos;

  // Se um dia o quadro for estreito demais para as fixas, cede a largura util.
  const larguraUtil = Math.min(larguraBarra, W - margemLado - reservaDireita);

  const nomes: Record<Lado, string> = {
    // Cabe mais nome que no horizontal: a barra e proporcionalmente mais larga.
    A: escapaXml(encurta(s.equipes.A, 18)),
    B: escapaXml(encurta(s.equipes.B, 18)),
  };

  const linha = (lado: Lado, i: number): string => {
    const ly = y + i * linhaH;
    const saca = s.saque === lado;
    const fundo = i === 0 ? COR.fundo : COR.fundoAlt;

    return `
    <g>
      <rect x="${x}" y="${ly}" width="${larguraUtil}" height="${linhaH}"
            fill="${fundo}" fill-opacity="${opacidade}"/>
      ${
        saca
          ? `<circle cx="${x + 30 * u}" cy="${ly + linhaH / 2}" r="${10 * u}" fill="${COR.saque}"/>`
          : ''
      }
      <text x="${x + 58 * u}" y="${ly + linhaH / 2}" fill="${COR.texto}"
            font-size="${42 * u}" font-weight="600" dominant-baseline="central"
            font-family="${FONTE}">${nomes[lado]}</text>

      <rect x="${x + colNome}" y="${ly}" width="${colSets}" height="${linhaH}"
            fill="#000000" fill-opacity="${opacidade * 0.5}"/>
      <text x="${x + colNome + colSets / 2}" y="${ly + linhaH / 2}" fill="${COR.textoFraco}"
            font-size="${38 * u}" font-weight="600" text-anchor="middle"
            dominant-baseline="central" font-family="${FONTE}">${s.setsVencidos[lado]}</text>

      <rect x="${x + colNome + colSets}" y="${ly}" width="${colPontos}" height="${linhaH}"
            fill="${COR.destaque}" fill-opacity="${opacidade}"/>
      <text x="${x + colNome + colSets + colPontos / 2}" y="${ly + linhaH / 2}" fill="#101010"
            font-size="${54 * u}" font-weight="700" text-anchor="middle"
            dominant-baseline="central" font-family="${FONTE}">${s.pontos[lado]}</text>
    </g>`;
  };

  const rotuloSet = s.tiebreak ? `SET ${s.setNumero} · TIE-BREAK` : `SET ${s.setNumero}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <clipPath id="tarjaV">
      <rect x="${x}" y="${y}" width="${larguraUtil}" height="${barraH}" rx="${raio}" ry="${raio}"/>
    </clipPath>
  </defs>
  <text x="${x + 4 * u}" y="${y - 14 * u}" fill="${COR.textoFraco}"
        font-size="${28 * u}" font-weight="600" letter-spacing="${2.5 * u}"
        font-family="${FONTE}">${escapaXml(rotuloSet)} · ATÉ ${s.alvo}</text>
  <g clip-path="url(#tarjaV)">
    ${linha('A', 0)}
    ${linha('B', 1)}
    <line x1="${x}" y1="${y + linhaH}" x2="${x + larguraUtil}" y2="${y + linhaH}"
          stroke="${COR.linha}" stroke-width="${2 * u}"/>
  </g>
</svg>`;
}

/** Orientacao da gravacao. Escolhida antes do REC, porque e fisica. */
export type Orientacao = 'paisagem' | 'retrato';

/**
 * Escolhe o layout pela orientacao do quadro.
 *
 * A decisao e por FORMA DO QUADRO e nao por preferencia: um video 9:16 com a
 * tarja de 16:9 fica errado independente da intencao de quem gravou.
 */
export function orientacaoDe(width: number, height: number): Orientacao {
  return height > width ? 'retrato' : 'paisagem';
}
