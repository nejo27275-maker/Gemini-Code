// tests/interpolate.test.js
// interpolate() é usada pra substituir {{id}} nos prompts de um passo de
// workflow pelo texto de saída de um passo anterior (agents/runner.js).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { interpolate } = require('../src/agents/runner');

test('substitui uma única variável', () => {
  assert.equal(interpolate('Olá {{nome}}!', { nome: 'Mundo' }), 'Olá Mundo!');
});

test('substitui várias variáveis diferentes', () => {
  const out = interpolate('{{a}} e {{b}}', { a: '1', b: '2' });
  assert.equal(out, '1 e 2');
});

test('substitui a mesma variável repetida mais de uma vez', () => {
  assert.equal(interpolate('{{x}}-{{x}}', { x: 'ok' }), 'ok-ok');
});

test('variável ausente no contexto vira string vazia (não quebra)', () => {
  assert.equal(interpolate('valor: {{faltando}}', {}), 'valor: ');
});

test('texto sem nenhum {{...}} volta inalterado', () => {
  assert.equal(interpolate('sem variáveis aqui', { a: '1' }), 'sem variáveis aqui');
});

test('não mexe em chaves simples (só {{duplas}})', () => {
  assert.equal(interpolate('{ não é variável }', {}), '{ não é variável }');
});
