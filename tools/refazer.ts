/**
 * Reconstroi a timeline depois da partida e (opcionalmente) queima o video.
 *
 * E o caminho de producao quando o celular ficou offline durante o jogo, ou
 * quando se quer refazer o overlay com outro layout sem regravar nada.
 *
 *   npx tsx tools/refazer.ts --link <url|uuid> --t0 <iso|epoch_ms>
 *   npx tsx tools/refazer.ts --link ... --t0 ... --video jogo.mp4 --out final.mp4
 *
 * `--t0` e o instante do PRIMEIRO FRAME no relogio do servidor. O app grava
 * isso ao apertar REC; para testar na mao, use o ISO de um pouco antes do
 * primeiro ponto.
 */
import { writeFile } from 'node:fs/promises';

import { resolveSumulaRef } from '../src/data/convocaClient';
import { buscaDadosBrutos, montaEventos, reconstruirTimeline } from '../src/recording/reconstruir';
import { burn } from './burn';

// Sumula de teste POS-125. A anterior (64d9b1a6) e pre-125 e por isso
// esconde a divergencia entre `atualizado_em` e a hora do ultimo rally:
// nela o backfill fez as duas coincidirem. Fixture que esconde bug e
// pior que fixture nenhuma.
const LINK_PADRAO =
  'https://ajbgjlnxfmdqsdzglybd.supabase.co/rest/v1/rpc/sumula_status' +
  '?p_sumula=246cd719-d3e0-4bcc-9f52-91fe288510f7' +
  '&apikey=sb_publishable_pFXmymWCo-c1h9RsSJGBfw_qmqs5lcd';

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function parseT0(v: string | undefined, primeiroRally: number | null): number {
  if (v) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 1e12) return n; // epoch ms
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
    throw new Error(`--t0 nao entendido: ${v}`);
  }
  if (primeiroRally == null) throw new Error('sem rallies: informe --t0 explicitamente.');
  // Sem --t0, assume que o REC comecou 10s antes do primeiro ponto. Serve para
  // inspecionar; nao serve para o video final.
  console.log('  (sem --t0: assumindo REC 10s antes do primeiro ponto)');
  return primeiroRally - 10_000;
}

async function main() {
  const ref = resolveSumulaRef(arg('link') ?? LINK_PADRAO);
  const brutos = await buscaDadosBrutos(ref);
  const { timeline, status } = brutos;

  console.log(`  sumula   : ${ref.sumulaId}`);
  console.log(`  equipes  : ${status.equipes.A} x ${status.equipes.B}`);
  console.log(`  formato  : melhor de ${status.formato.melhor_de}, ` +
              `${status.formato.pontos_set} pts (decisivo ${status.formato.pontos_tiebreak})`);
  // A 126 ja devolve so os rallies que contam: nao ha cursor a aplicar aqui.
  console.log(`  rallies  : ${timeline.rallies.length} validos (filtrados pelo cursor na 126)`);
  console.log(`  sets     : ${timeline.sets.map((x) => `${x.numero}:saque ${x.saque_inicial ?? '-'}`).join(' | ')}`);

  const primeiro = timeline.rallies.length
    ? Math.min(...timeline.rallies.map((r) => Date.parse(r.criado_em)))
    : null;
  const t0 = parseT0(arg('t0'), primeiro);
  console.log(`  t0       : ${new Date(t0).toISOString()} (relogio do servidor)`);

  const eventos = montaEventos(brutos, t0);
  console.log(`  eventos  : ${eventos.length}`);
  console.log();

  for (const e of eventos.slice(0, 20)) {
    const st = e.estado;
    const seg = (e.videoMs / 1000).toFixed(2).padStart(8);
    console.log(
      `  ${seg}s  ${st.equipes.A} ${String(st.pontos.A).padStart(2)} x ` +
        `${String(st.pontos.B).padEnd(2)} ${st.equipes.B}  ` +
        `set ${st.setNumero} (ate ${st.alvo})  saque ${st.saque ?? '-'}  ` +
        `[${e.evento.tipo}/${e.precisao}]`,
    );
  }
  if (eventos.length > 20) console.log(`  ... e mais ${eventos.length - 20}`);

  const saidaJson = arg('json');
  if (saidaJson) {
    const t = await reconstruirTimeline(ref, t0);
    await writeFile(saidaJson, JSON.stringify(t, null, 2), 'utf8');
    console.log(`\n  timeline : ${saidaJson}`);
  }

  const video = arg('video');
  if (video) {
    const t = await reconstruirTimeline(ref, t0);
    console.log();
    await burn(video, t, arg('out') ?? 'final.mp4', arg('trabalho') ?? '.burn');
  }
}

main().catch((e: unknown) => {
  console.error('erro:', (e as Error)?.message ?? e);
  process.exit(1);
});
