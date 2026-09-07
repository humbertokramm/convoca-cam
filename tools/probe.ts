/**
 * Sonda ao vivo: valida o cliente contra a sumula real e imprime os eventos
 * conforme a mesa pontua. Use durante um jogo de teste para descobrir os
 * valores de `estado` que ainda nao conhecemos.
 *
 *   npm run probe -- "<link ou uuid>" [segundos]
 */
import { resolveSumulaRef, buildStatusUrl } from '../src/data/convocaClient';
import { watchSumula } from '../src/data/watchSumula';
import { derivePhase, classifyEstado, totalPontos } from '../src/core/phase';

const LINK_PADRAO =
  'https://ajbgjlnxfmdqsdzglybd.supabase.co/rest/v1/rpc/sumula_status' +
  '?p_sumula=64d9b1a6-d6e4-48d2-885c-57172261cc08' +
  '&apikey=sb_publishable_pFXmymWCo-c1h9RsSJGBfw_qmqs5lcd';

const link = process.argv[2] ?? LINK_PADRAO;
const segundos = Number(process.argv[3] ?? 20);

const ref = resolveSumulaRef(link);
console.log('sumula :', ref.sumulaId);
console.log('host   :', ref.host);
console.log('url    :', buildStatusUrl(ref));
console.log('-'.repeat(70));

const t0 = Date.now();
const rel = (at: number) => `+${((at - t0) / 1000).toFixed(1)}s`.padStart(7);

const h = watchSumula(
  ref,
  {
    onSnapshot(snap, fase) {
      const s = snap.status;
      const set = s.set_atual;
      const placar = set ? `${set.pontos.A}x${set.pontos.B} (set ${set.numero}/alvo ${set.alvo})` : 'sem set';
      // Idade do dado: tempo desde a ultima alteracao no servidor. Alto quando
      // nada acontece; no instante de uma mudanca vira a latencia do polling.
      const idade = snap.serverAt ? `${((snap.observedAt - snap.serverAt) / 1000).toFixed(1)}s` : 'n/d';
      console.log(
        `${rel(snap.observedAt)} v${String(s.versao).padEnd(4)} [${fase}] ` +
          `${s.equipes.A} ${placar} ${s.equipes.B} | sets ${s.sets_vencidos.A}-${s.sets_vencidos.B} ` +
          `| saque ${set?.saque ?? '-'} | idade ${idade}`,
      );
    },
    onEvent(ev) {
      console.log(`${rel(ev.at)}   >> ${ev.tipo.toUpperCase()} ${JSON.stringify(ev)}`);
    },
    onError(err, n) {
      console.error(`${rel(Date.now())}   !! erro #${n}: ${err.message}`);
    },
    onEstadoNovo(estado) {
      console.warn(`\n  *** ESTADO NOVO: "${estado}" -> classifyEstado=${classifyEstado(estado)}`);
      console.warn('  *** anote e adicione em src/core/phase.ts\n');
    },
  },
  { intervaloLiveMs: 1500, intervaloIdleMs: 3000 },
);

setTimeout(() => {
  h.stop();
  const s = h.atual()?.status;
  console.log('-'.repeat(70));
  if (s) {
    console.log(`fim da sonda. estado="${s.estado}" fase=${derivePhase(s)} pontos=${totalPontos(s)} versao=${s.versao}`);
  } else {
    console.log('fim da sonda. nenhum snapshot obtido.');
  }
}, segundos * 1000);
