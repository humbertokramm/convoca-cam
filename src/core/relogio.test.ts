import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AncoraDeRelogio, amostraDoHeaderDate } from './relogio';

/**
 * Cenario: relogio do aparelho 5000ms ADIANTADO em relacao ao servidor.
 * Uma amostra e simulada dando o instante real do servidor e a latencia.
 */
const OFFSET_REAL = 5000;

function amostraSimulada(servidorReal: number, latenciaIda: number, latenciaVolta: number) {
  return {
    enviadoEm: servidorReal + OFFSET_REAL - latenciaIda,
    recebidoEm: servidorReal + OFFSET_REAL + latenciaVolta,
    servidorEm: servidorReal,
    fonte: 'agora' as const,
  };
}

test('uma amostra ja cerca o offset real', () => {
  const a = new AncoraDeRelogio();
  assert.ok(a.amostra(amostraSimulada(1_000_000, 40, 60)));

  const e = a.estado();
  assert.ok(Math.abs(e.offsetMs - OFFSET_REAL) <= e.incertezaMs,
    `offset ${e.offsetMs} deveria estar a ${e.incertezaMs}ms de ${OFFSET_REAL}`);
  assert.ok(e.incertezaMs < 60);
});

test('amostras sucessivas apertam o intervalo', () => {
  const a = new AncoraDeRelogio();
  a.amostra(amostraSimulada(1_000_000, 300, 300));
  const largo = a.estado().incertezaMs;

  a.amostra(amostraSimulada(1_010_000, 5, 5));
  const apertado = a.estado().incertezaMs;

  assert.ok(apertado < largo, `${apertado} deveria ser menor que ${largo}`);
  assert.ok(Math.abs(a.estado().offsetMs - OFFSET_REAL) < 10);
});

test('header Date, com 1s de granularidade, ainda resolve deriva grande', () => {
  const a = new AncoraDeRelogio();
  // Servidor em 1_000_000; o header so informa o segundo cheio (1_000_000 e
  // multiplo de 1000, entao truncar nao perde nada aqui).
  a.amostra({
    enviadoEm: 1_000_000 + OFFSET_REAL - 50,
    recebidoEm: 1_000_000 + OFFSET_REAL + 50,
    servidorEm: 1_000_000,
    fonte: 'date-header',
  });

  const e = a.estado();
  // Nao cravamos os 5000, mas cercamos dentro de ~1s — suficiente para nao
  // deslocar o video em minutos.
  assert.ok(e.incertezaMs <= 600, `incerteza ${e.incertezaMs}`);
  assert.ok(Math.abs(e.offsetMs - OFFSET_REAL) <= e.incertezaMs);
});

test('paraServidor converte o instante do REC', () => {
  const a = new AncoraDeRelogio();
  a.amostra(amostraSimulada(1_000_000, 5, 5));

  // REC apertado quando o aparelho marcava 1_005_000 (= servidor 1_000_000).
  const t0Servidor = a.paraServidor(1_000_000 + OFFSET_REAL);
  assert.ok(Math.abs(t0Servidor - 1_000_000) < 10, `t0Servidor=${t0Servidor}`);
});

test('sem amostra, paraServidor devolve o valor cru em vez de falhar', () => {
  const a = new AncoraDeRelogio();
  assert.equal(a.pronta, false);
  assert.equal(a.paraServidor(123_456), 123_456);
  assert.equal(a.estado().incertezaMs, Number.POSITIVE_INFINITY);
});

test('salto de relogio reinicia o intervalo em vez de travar', () => {
  const a = new AncoraDeRelogio();
  a.amostra(amostraSimulada(1_000_000, 5, 5));
  const antes = a.estado();
  assert.ok(Math.abs(antes.offsetMs - OFFSET_REAL) < 10);

  // O usuario corrige o relogio: agora o aparelho esta ATRASADO 2000ms.
  const novoOffset = -2000;
  assert.ok(a.amostra({
    enviadoEm: 1_020_000 + novoOffset - 5,
    recebidoEm: 1_020_000 + novoOffset + 5,
    servidorEm: 1_020_000,
    fonte: 'agora',
  }));

  const depois = a.estado();
  assert.equal(depois.reinicios, 1);
  assert.equal(depois.amostras, 1);
  assert.ok(Math.abs(depois.offsetMs - novoOffset) < 10, `offset ${depois.offsetMs}`);
});

test('RTT negativo e descartado', () => {
  const a = new AncoraDeRelogio();
  assert.equal(
    a.amostra({ enviadoEm: 5000, recebidoEm: 4000, servidorEm: 1000, fonte: 'agora' }),
    false,
  );
  assert.equal(a.pronta, false);
});

test('amostraDoHeaderDate le o header e ignora o que nao da para parsear', () => {
  const resOk = { headers: { get: () => 'Sun, 06 Sep 2026 20:07:51 GMT' } };
  const am = amostraDoHeaderDate(resOk, 1000, 1100);
  assert.ok(am);
  assert.equal(am.fonte, 'date-header');
  assert.equal(am.servidorEm, Date.parse('Sun, 06 Sep 2026 20:07:51 GMT'));

  assert.equal(amostraDoHeaderDate({ headers: { get: () => null } }, 1000, 1100), null);
  assert.equal(amostraDoHeaderDate({ headers: { get: () => 'nao é data' } }, 1000, 1100), null);
});
