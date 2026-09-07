/** Imprime a ficha de abertura como o cartao do video vai mostrar. */
import { resolveSumulaRef } from '../src/data/convocaClient';
import { fetchAbertura, rotuloPapel } from '../src/data/abertura';

// Sumula de teste POS-125. A anterior (64d9b1a6) e pre-125 e por isso
// esconde a divergencia entre `atualizado_em` e a hora do ultimo rally:
// nela o backfill fez as duas coincidirem. Fixture que esconde bug e
// pior que fixture nenhuma.
const LINK_PADRAO =
  'https://ajbgjlnxfmdqsdzglybd.supabase.co/rest/v1/rpc/sumula_status' +
  '?p_sumula=246cd719-d3e0-4bcc-9f52-91fe288510f7' +
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
