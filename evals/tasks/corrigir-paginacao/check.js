'use strict';
// Verificador oculto (fica fora do workspace do agente). Uso: node check.js <workspace>
const assert = require('node:assert/strict');
const path = require('path');

const { paginar } = require(path.join(process.argv[2], 'src', 'paginar.js'));
const itens = Array.from({ length: 25 }, (_, i) => i + 1);

assert.deepEqual(paginar(itens, 1, 10), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'página 1');
assert.deepEqual(paginar(itens, 2, 10), [11, 12, 13, 14, 15, 16, 17, 18, 19, 20], 'página 2');
assert.deepEqual(paginar(itens, 3, 10), [21, 22, 23, 24, 25], 'última página incompleta');
assert.deepEqual(paginar(itens, 4, 10), [], 'página depois do fim');
assert.deepEqual(paginar([], 1, 5), [], 'lista vazia');
for (const [p, t] of [[0, 10], [-1, 10], [1, 0], [1.5, 10], [1, 2.5]]) {
  assert.throws(() => paginar(itens, p, t), RangeError, `paginar(itens, ${p}, ${t}) deve lançar RangeError`);
}
console.log('ok');
