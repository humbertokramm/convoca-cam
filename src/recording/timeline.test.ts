import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTRATO_VERSAO,
  TimelineBuilder,
  carimbosComparaveis,
  ordenaCarimbos,
} from './timeline';
import { AncoraDeRelogio } from '../core/relogio';
import type { MatchEvent } from '../data/watchSumula';
import type { ScoreboardState } from '../overlay/scoreboard';

/** Estado de placar qualquer: estes testes so olham para tempo e carimbo. */
const EST: ScoreboardState = {
  equipes: { A: 'Unificado', B: 'Base' },
  setsVencidos: { A: 0, B: 0 },
  pontos: { A: 1, B: 0 },
  saque: 'A',
  setNumero: 1,
  alvo: 25,
  tiebreak: false,
};

/** Atalho: evento de ponto com os carimbos que importam. */
function ponto(at: number, serverAt: number | null, versao: number, a = 1, b = 0): MatchEvent {
  return { tipo: 'ponto', lado: 'A', set: 1, a, b, at, serverAt, versao };
}

// Cenario de referencia: aparelho 5000ms ADIANTADO. A gravacao comeca quando o
// APARELHO marca 105000 — ou seja, hora de servidor 100000.
const OFFSET = 5000;
const T0_APARELHO = 105_000;
const T0_SERVIDOR = 100_000;

/** Ancora ja calibrada, com latencia desprezivel. */
function ancoraCalibrada(): AncoraDeRelogio {
  const a = new AncoraDeRelogio();
  a.amostra({
    enviadoEm: 50_000 + OFFSET - 1,
    recebidoEm: 50_000 + OFFSET + 1,
    servidorEm: 50_000,
    fonte: 'agora',
  });
  return a;
}

test('t0 e convertido para hora de servidor na construcao', () => {
  const b = new TimelineBuilder('s1', T0_APARELHO, ancoraCalibrada());
  assert.ok(Math.abs(b.inicioServidor - T0_SERVIDOR) < 5, `t0=${b.inicioServidor}`);
});

test('videoMs usa a hora do servidor, nao a da observacao', () => {
  const b = new TimelineBuilder('s1', T0_APARELHO, ancoraCalibrada());

  // O ponto aconteceu no servidor em 110000. Observamos 1400ms depois.
  const serverAt = 110_000;
  const observado = serverAt + OFFSET + 1400;
  const item = b.registra(ponto(observado, serverAt, 9), EST);

  // 110000 - 100000, exato: os dois lados vem do relogio do servidor.
  assert.ok(Math.abs(item.videoMs - 10_000) < 5, `videoMs=${item.videoMs}`);

  // Sem isso, o overlay entraria 1,4s tarde (o atraso do polling).
  assert.equal(observado - T0_APARELHO, 11_400);
});

test('sem serverAt, converte a observacao do aparelho', () => {
  const b = new TimelineBuilder('s1', T0_APARELHO, ancoraCalibrada());
  // Aparelho marcou 117000 -> servidor 112000 -> video 12000.
  const item = b.registra(ponto(117_000, null, 1), EST);
  assert.ok(Math.abs(item.videoMs - 12_000) < 5, `videoMs=${item.videoMs}`);
});

test('sem ancora calibrada, nao falha: assume os relogios iguais', () => {
  const b = new TimelineBuilder('s1', T0_APARELHO, new AncoraDeRelogio());
  assert.equal(b.inicioServidor, T0_APARELHO);
  // O video sai deslocado pelo desvio real, mas sai. Melhor que nao gravar.
  const item = b.registra(ponto(117_000, null, 1), EST);
  assert.equal(item.videoMs, 12_000);
});

test('evento anterior ao REC fica negativo, nao e recortado', () => {
  const b = new TimelineBuilder('s1', T0_APARELHO, ancoraCalibrada());
  const item = b.registra(ponto(95_000, 90_000, 3), EST);
  assert.ok(Math.abs(item.videoMs - -10_000) < 5, `videoMs=${item.videoMs}`);
});

test('build ordena por tempo de video e carimba o estado da ancora', () => {
  const b = new TimelineBuilder('s1', T0_APARELHO, ancoraCalibrada());
  b.registra(ponto(135_000, 130_000, 12), EST); // video 30000
  b.registra(ponto(120_000, 115_000, 11), EST); // video 15000

  const t = b.build();
  assert.deepEqual(
    t.eventos.map((e) => Math.round(e.videoMs / 1000)),
    [15, 30],
  );
  assert.equal(t.contrato, CONTRATO_VERSAO);
  assert.equal(t.sumulaId, 's1');
  assert.ok(t.relogio.incertezaMs < 5, `incerteza=${t.relogio.incertezaMs}`);
  assert.equal(t.relogio.amostras, 1);
});

test('carimbos de sumulas diferentes nao sao comparaveis', () => {
  const r = carimbosComparaveis(
    { sumulaId: 's1', contrato: CONTRATO_VERSAO },
    { sumulaId: 's2', contrato: CONTRATO_VERSAO },
  );
  assert.deepEqual(r, { comparavel: false, motivo: 'sumula_diferente' });
});

test('carimbo de outra era do contrato nao e comparavel', () => {
  const r = carimbosComparaveis(
    { sumulaId: 's1', contrato: CONTRATO_VERSAO },
    // Carimbo anterior a 125: numero plausivel, significado diferente.
    { sumulaId: 's1', contrato: 'rallies-091' as never },
  );
  assert.deepEqual(r, { comparavel: false, motivo: 'contrato_diferente' });
});

test('ordena: dentro da mesma era, versao manda', () => {
  const a = { versao: 8, serverAt: 5_000, contrato: CONTRATO_VERSAO };
  const b = { versao: 9, serverAt: 5_000, contrato: CONTRATO_VERSAO };
  assert.ok(ordenaCarimbos(a, b)! < 0);
});

test('ordena: entre eras diferentes, o relogio desempata', () => {
  const antigo = { versao: 8, serverAt: 1_000, contrato: 'rallies-091' as never };
  const novo = { versao: 8, serverAt: 9_000, contrato: CONTRATO_VERSAO };
  assert.ok(ordenaCarimbos(antigo, novo)! < 0);
});

test('ordena: devolve null quando nao da para afirmar nada', () => {
  const a = { versao: 8, serverAt: null, contrato: 'rallies-091' as never };
  const b = { versao: 8, serverAt: null, contrato: CONTRATO_VERSAO };
  assert.equal(ordenaCarimbos(a, b), null);
});
