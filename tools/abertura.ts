/** Imprime a ficha de abertura como o cartao do video vai mostrar. */
import { resolveSumulaRef } from '../src/data/convocaClient';
import { fetchAbertura, rotuloPapel } from '../src/data/abertura';

const LINK_PADRAO =
  'https://ajbgjlnxfmdqsdzglybd.supabase.co/rest/v1/rpc/sumula_status' +
  '?p_sumula=64d9b1a6-d6e4-48d2-885c-57172261cc08' +
  '&apikey=sb_publishable_pFXmymWCo-c1h9RsSJGBfw_qmqs5lcd';

async function main() {
const ref = resolveSumulaRef(process.argv[2] ?? LINK_PADRAO);
const ab = await fetchAbertura(ref);

console.log(`\n  ${ab.titulo.toUpperCase()}`);
console.log(`  ${ab.sistema} | melhor de ${ab.formato.melhor_de} | ` +
            `${ab.formato.pontos_set} pts (decisivo ${ab.formato.pontos_tiebreak})\n`);

for (const lado of ['A', 'B'] as const) {
  const eq = ab.equipes[lado];
  if (!eq) { console.log(`  [${lado}] (sem equipe)\n`); continue; }
  console.log(`  ${lado} — ${eq.nome}  (${eq.atletas.length} atletas)`);
  const linha = eq.atletas
    .map((a) => `${a.numero ?? '--'} ${a.nome}${a.capitao ? ' (C)' : ''}${a.libero ? ' (L)' : ''}`)
    .join('  ·  ');
  console.log(`     ${linha}\n`);
}

if (ab.oficiais.length) {
  console.log('  Arbitragem');
  for (const o of ab.oficiais) console.log(`     ${rotuloPapel(o.papel).padEnd(12)} ${o.nome}`);
} else {
  console.log('  Arbitragem: nenhum oficial cadastrado nesta sumula.');
}
console.log();
}

main().catch((e) => {
  console.error('erro:', e?.message ?? e);
  process.exit(1);
});
