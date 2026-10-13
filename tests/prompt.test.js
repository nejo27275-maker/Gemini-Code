// tests/prompt.test.js
// prompt.js existe pra garantir UMA ÚNICA readline.Interface por processo
// (ver comentário no topo do arquivo — duas interfaces competindo pelo
// mesmo stdin travava a confirmação de run_shell em alguns terminais do
// Termux). O que dá pra testar sem simular entrada de teclado de verdade é
// exatamente essa garantia de singleton e o ciclo de vida (getShared /
// closeShared).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getShared, closeShared } = require('../src/ui/prompt');

test('getShared devolve sempre a mesma instância', () => {
  const a = getShared();
  const b = getShared();
  assert.equal(a, b);
  closeShared();
});

test('depois de closeShared, a próxima getShared cria uma instância nova', () => {
  const a = getShared();
  closeShared();
  const b = getShared();
  assert.notEqual(a, b);
  closeShared();
});

test('closeShared sem nenhuma interface aberta não quebra', () => {
  closeShared();
  assert.doesNotThrow(() => closeShared());
});
