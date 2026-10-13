'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDuracao } = require('../src/duracao');

test('horas e minutos', () => {
  assert.equal(parseDuracao('1h30m'), 5400);
});

test('só segundos', () => {
  assert.equal(parseDuracao('90s'), 90);
});

test('horas', () => {
  assert.equal(parseDuracao('2h'), 7200);
});
