/**
 * Queima o placar no video, no desktop.
 *
 * POR QUE AQUI E NAO NO CELULAR. O burn em tempo real nao existe no React
 * Native: nem a VisionCamera 4 nem a 5 escrevem o overlay no arquivo — o
 * `Recorder` grava os frames da camera, e o `FrameRenderer` da v5 desenha numa
 * VIEW. A propria doc dela diz que da para "construir um gravador customizado
 * que aceita Frames", o que e trabalho nativo em Swift/Kotlin.
 *
 * A alternativa seria FFmpeg no aparelho, e esse terreno esta ruim: o
 * FFmpegKit foi aposentado em janeiro/2025 e os binarios sairam dos
 * repositorios em abril/2025. O que restou no npm e uma duzia de forks
 * pessoais sem sucessor claro, e o modo de falha e cruel — `npm install`
 * funciona, o build nativo quebra.
 *
 * Fora que renderizar 90 minutos num celular e lento e esquenta o aparelho.
 * Aqui o ffmpeg e problema resolvido, e o overlay sai em resolucao cheia sem
 * disputar CPU com a captura.
 *
 * COMO. O placar muda poucas dezenas de vezes numa partida — um estado por
 * rally. Rasteriza-se um PNG por ESTADO DISTINTO, monta-se uma trilha de
 * overlay com a duracao de cada um pelo demuxer `concat`, e sobrepoe-se em uma
 * passada. Nada e desenhado por frame.
 *
 *   npx tsx tools/burn.ts --video jogo.mp4 --timeline jogo.json --out final.mp4
 *   npx tsx tools/burn.ts --demo          # gera video e timeline sinteticos
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { Resvg } from '@resvg/resvg-js';

import { chaveEstado, scoreboardParaQuadro, type ScoreboardState } from '../src/overlay';
import { CONTRATO_VERSAO, type Timeline } from '../src/recording/timeline';

const exec = promisify(execFile);

// --------------------------------------------------------------------- args

interface Args {
  video?: string;
  timeline?: string;
  out: string;
  trabalho: string;
  demo: boolean;
  vertical: boolean;
  manterTrabalho: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (nome: string): string | undefined => {
    const i = argv.indexOf(`--${nome}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    video: get('video'),
    timeline: get('timeline'),
    out: get('out') ?? 'final.mp4',
    trabalho: get('trabalho') ?? '.burn',
    demo: argv.includes('--demo'),
    vertical: argv.includes('--vertical'),
    manterTrabalho: argv.includes('--manter'),
  };
}

// ------------------------------------------------------------------ ffprobe

interface Dimensoes {
  width: number;
  height: number;
  fps: number;
  duracaoS: number;
}

async function dimensoes(video: string): Promise<Dimensoes> {
  const { stdout } = await exec('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate:format=duration',
    '-of', 'json',
    video,
  ]);
  const j = JSON.parse(stdout) as {
    streams?: { width?: number; height?: number; r_frame_rate?: string }[];
    format?: { duration?: string };
  };
  const s = j.streams?.[0];
  if (!s?.width || !s.height) throw new Error(`ffprobe nao achou stream de video em ${video}`);

  const [num, den] = (s.r_frame_rate ?? '30/1').split('/').map(Number);
  const fps = den ? (num ?? 30) / den : 30;

  return {
    width: s.width,
    height: s.height,
    fps: Number.isFinite(fps) && fps > 0 ? fps : 30,
    duracaoS: Number(j.format?.duration ?? 0),
  };
}

// ------------------------------------------------------------------ janelas

interface Janela {
  inicioS: number;
  fimS: number;
  /** `null` = nada desenhado (antes do primeiro estado conhecido). */
  estado: ScoreboardState | null;
}

/**
 * Transforma a timeline em faixas de tempo contiguas.
 *
 * Um estado vale do seu instante ate o proximo. Eventos com `videoMs` negativo
 * aconteceram antes do REC: o estado deles e valido, o instante nao — sao
 * grampeados em zero, e o ultimo deles e que vale no primeiro frame.
 */
export function janelasDe(t: Timeline, duracaoS: number): Janela[] {
  const pontos = t.eventos
    .map((e) => ({ s: Math.max(0, e.videoMs / 1000), estado: e.estado }))
    .sort((a, b) => a.s - b.s);

  // Mesmo instante depois do grampeamento: o ultimo ganha.
  const unicos: typeof pontos = [];
  for (const p of pontos) {
    const ultimo = unicos[unicos.length - 1];
    if (ultimo && ultimo.s === p.s) unicos[unicos.length - 1] = p;
    else unicos.push(p);
  }

  const janelas: Janela[] = [];
  if (unicos.length === 0 || (unicos[0] && unicos[0].s > 0)) {
    janelas.push({ inicioS: 0, fimS: unicos[0]?.s ?? duracaoS, estado: null });
  }
  for (let i = 0; i < unicos.length; i += 1) {
    const atual = unicos[i]!;
    janelas.push({
      inicioS: atual.s,
      fimS: unicos[i + 1]?.s ?? duracaoS,
      estado: atual.estado,
    });
  }
  return janelas.filter((j) => j.fimS > j.inicioS);
}

// --------------------------------------------------------------- rasterizar

const SVG_VAZIO = (w: number, h: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"></svg>`;

async function rasterizaEstados(
  janelas: Janela[],
  dim: Dimensoes,
  dir: string,
): Promise<Map<string, string>> {
  const arquivos = new Map<string, string>();
  let n = 0;

  for (const j of janelas) {
    const chave = j.estado ? chaveEstado(j.estado) : '__vazio__';
    if (arquivos.has(chave)) continue;

    // O layout sai da forma do quadro, nao de configuracao: 9:16 recebe a
    // tarja de topo (a base pertence a interface do Instagram), 16:9 recebe a
    // tarja inferior classica.
    const svg = j.estado
      ? scoreboardParaQuadro(j.estado, dim.width, dim.height)
      : SVG_VAZIO(dim.width, dim.height);

    const png = new Resvg(svg, { fitTo: { mode: 'width', value: dim.width } }).render().asPng();
    const nome = join(dir, `st_${String(n).padStart(4, '0')}.png`);
    await writeFile(nome, png);
    arquivos.set(chave, nome);
    n += 1;
  }
  return arquivos;
}

// ---------------------------------------------------------------- concat

/**
 * Lista do demuxer `concat`.
 *
 * O demuxer exige que o ULTIMO arquivo apareca duas vezes — a duracao vem
 * depois do `file`, e sem a repeticao o ultimo trecho sai com um frame.
 */
function listaConcat(janelas: Janela[], arquivos: Map<string, string>): string {
  const linhas: string[] = [];
  let ultimo = '';

  for (const j of janelas) {
    const chave = j.estado ? chaveEstado(j.estado) : '__vazio__';
    const arq = arquivos.get(chave)!;
    // Caminho absoluto com barra normal: o concat no Windows engasga com `\`.
    ultimo = resolve(arq).replace(/\\/g, '/');
    linhas.push(`file '${ultimo}'`);
    linhas.push(`duration ${(j.fimS - j.inicioS).toFixed(3)}`);
  }
  if (ultimo) linhas.push(`file '${ultimo}'`);
  return linhas.join('\n') + '\n';
}

// -------------------------------------------------------------------- burn

export async function burn(video: string, timeline: Timeline, out: string, trabalho: string) {
  if (timeline.contrato !== CONTRATO_VERSAO) {
    // Nao e erro fatal: o placar em si continua valido. Mas os carimbos de
    // `versao` nao sao comparaveis com os de agora, e quem for auditar
    // depois precisa saber.
    console.warn(
      `  aviso: timeline gravada no contrato "${timeline.contrato}", ` +
        `este binario conhece "${CONTRATO_VERSAO}". Carimbos de versao nao sao comparaveis.`,
    );
  }

  const dim = await dimensoes(video);
  console.log(`  video    : ${dim.width}x${dim.height} @ ${dim.fps.toFixed(2)}fps, ${dim.duracaoS.toFixed(1)}s`);

  const janelas = janelasDe(timeline, dim.duracaoS);
  await mkdir(trabalho, { recursive: true });

  const arquivos = await rasterizaEstados(janelas, dim, trabalho);
  console.log(`  janelas  : ${janelas.length}`);
  console.log(`  PNGs     : ${arquivos.size} (um por estado distinto)`);

  const lista = join(trabalho, 'overlay.txt');
  await writeFile(lista, listaConcat(janelas, arquivos), 'utf8');

  await exec(
    'ffmpeg',
    [
      '-y',
      '-i', video,
      '-f', 'concat', '-safe', '0', '-i', lista,
      '-filter_complex',
      // `fps` normaliza a trilha de imagens para a cadencia do video; sem isso
      // o overlay entra em degraus. `shortest=1` corta pela duracao do video.
      `[1:v]fps=${dim.fps.toFixed(4)},format=rgba[ov];[0:v][ov]overlay=0:0:shortest=1:format=auto[v]`,
      '-map', '[v]',
      '-map', '0:a?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'copy',
      '-movflags', '+faststart',
      out,
    ],
    { maxBuffer: 1 << 26 },
  );

  console.log(`  saida    : ${out}`);
}

// -------------------------------------------------------------------- demo

/** Simula uma partida curta para provar o pipeline sem celular. */
function timelineDemo(): Timeline {
  const equipes = { A: 'Unificado', B: 'Base' };
  const eventos: Timeline['eventos'] = [];

  let a = 0;
  let b = 0;
  let saque: 'A' | 'B' = 'A';
  let versao = 2;
  let t = 1000; // primeiro ponto 1s depois do REC

  // 14 rallies em ~28s, alternando de forma plausivel.
  for (let i = 0; i < 14; i += 1) {
    const paraA = i % 3 !== 2;
    if (paraA) a += 1;
    else b += 1;
    saque = paraA ? 'A' : 'B';
    versao += 1;

    const estado: ScoreboardState = {
      equipes,
      setsVencidos: { A: 0, B: 0 },
      pontos: { A: a, B: b },
      saque,
      setNumero: 1,
      alvo: 25,
      tiebreak: false,
    };

    eventos.push({
      videoMs: t,
      versao,
      serverAt: null,
      precisao: 'rally',
      estado,
      evento: { tipo: 'ponto', lado: paraA ? 'A' : 'B', set: 1, a, b, at: t, serverAt: null, versao },
    });
    t += 2000;
  }

  return {
    sumulaId: '64d9b1a6-d6e4-48d2-885c-57172261cc08',
    contrato: CONTRATO_VERSAO,
    gravacaoIniciadaEm: 0,
    relogio: { offsetMs: 0, incertezaMs: 0, amostras: 0, reinicios: 0 },
    eventos,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let video = args.video;
  let timeline: Timeline;

  if (args.demo) {
    await mkdir(args.trabalho, { recursive: true });
    video = join(args.trabalho, 'demo_camera.mp4');
    console.log('  gerando video de teste...');
    await exec('ffmpeg', [
      '-y',
      '-f', 'lavfi', '-i',
      `testsrc2=size=${args.vertical ? '1080x1920' : '1280x720'}:rate=30:duration=30`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      video,
    ]);
    timeline = timelineDemo();
    await writeFile(join(args.trabalho, 'demo_timeline.json'), JSON.stringify(timeline, null, 2), 'utf8');
  } else {
    if (!video || !args.timeline) {
      console.error('uso: --video <mp4> --timeline <json> [--out final.mp4]   ou   --demo');
      process.exit(2);
    }
    timeline = JSON.parse(await readFile(args.timeline, 'utf8')) as Timeline;
  }

  await burn(video!, timeline, args.out, args.trabalho);

  if (!args.manterTrabalho && !args.demo) await rm(args.trabalho, { recursive: true, force: true });
}

// `burn` e importado por tools/refazer.ts. Sem esta guarda, o simples import
// executaria o CLI e abortaria com "uso: ..." antes do chamador rodar.
const invocadoDireto = /[\\/]burn\.(ts|js|mjs|cjs)$/.test(process.argv[1] ?? '');

if (invocadoDireto) {
  main().catch((e: unknown) => {
    const err = e as { message?: string; stderr?: string };
    console.error('erro:', err?.message ?? e);
    if (err?.stderr) console.error(String(err.stderr).split('\n').slice(-12).join('\n'));
    process.exit(1);
  });
}
