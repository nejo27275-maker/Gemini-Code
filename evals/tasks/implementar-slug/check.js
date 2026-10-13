'use strict';
// Verificador oculto. Uso: node check.js <workspace>
const assert = require('node:assert/strict');
const path = require('path');

const mod = require(path.join(process.argv[2], 'src', 'texto.js'));
assert.equal(typeof mod.slugify, 'function', 'slugify precisa ser exportada');
const casos = [
  ['Ação Rápida!  2026', 'acao-rapida-2026'],
  ['Olá, Mundo', 'ola-mundo'],
  ['  --já existe--  ', 'ja-existe'],
  ['Coração & Pão de Açúcar', 'coracao-pao-de-acucar'],
  ['ÉRAMOS 3', 'eramos-3'],
  ['snake_case e camelCase', 'snake-case-e-camelcase'],
  ['!!!', ''],
  ['', ''],
];
for (const [entrada, esperado] of casos) assert.equal(mod.slugify(entrada), esperado, `slugify(${JSON.stringify(entrada)})`);
assert.equal(mod.capitalizar('olá mundo'), 'Olá Mundo', 'capitalizar continua funcionando');
console.log('ok');
