'use strict';
// Verificador oculto. Uso: node check.js <workspace>
const assert = require('node:assert/strict');
const path = require('path');

const { formatarBRL } = require(path.join(process.argv[2], 'src', 'moeda.js'));
// Comportamento que já existia e não pode mudar.
for (const [v, esperado] of [[0, 'R$ 0,00'], [5, 'R$ 5,00'], [1234.5, 'R$ 1.234,50'], [1234567.891, 'R$ 1.234.567,89'], [999.999, 'R$ 1.000,00'], [0.1, 'R$ 0,10']]) {
  assert.equal(formatarBRL(v), esperado, `formatarBRL(${v}) (comportamento antigo)`);
}
// Comportamento novo.
for (const [v, esperado] of [[-1234.56, '-R$ 1.234,56'], [-0.5, '-R$ 0,50'], [-1000000, '-R$ 1.000.000,00'], [-0.004, 'R$ 0,00']]) {
  assert.equal(formatarBRL(v), esperado, `formatarBRL(${v})`);
}
console.log('ok');
