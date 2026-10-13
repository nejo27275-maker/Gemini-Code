'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Carrinho } = require('../src/carrinho');
const { fecharCompra } = require('../src/checkout');

test('total do carrinho', () => {
  const c = new Carrinho().adicionar('caneta', 2.5, 4).adicionar('caderno', 15);
  assert.equal(c.total(), 25);
});

test('checkout com cupom', () => {
  const c = new Carrinho().adicionar('livro', 80);
  const r = fecharCompra(c, 10);
  assert.equal(r.total, 72);
  assert.equal(r.recalcTotal(), 72);
});
