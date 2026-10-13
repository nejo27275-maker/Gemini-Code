'use strict';
// Colar um prompt de várias linhas no chat tem que virar UMA mensagem
// (antes só a primeira linha chegava; o resto era descartado).
const test = require('node:test');
const assert = require('node:assert');
const readline = require('readline');
const { PassThrough } = require('stream');
const { perguntarColando } = require('../src/ui/prompt');

function novoRl() {
  const input = new PassThrough();
  const output = new PassThrough();
  const rl = readline.createInterface({ input, output });
  return { rl, input, fim: () => rl.close() };
}

test('colagem de várias linhas (numa leva só) chega como uma mensagem', async () => {
  const { rl, input, fim } = novoRl();
  const p = new Promise((res) => perguntarColando(rl, '> ', res, 30));
  input.write('linha 1\nlinha 2\n\nlinha 4\n');
  assert.strictEqual(await p, 'linha 1\nlinha 2\n\nlinha 4');
  fim();
});

test('linha única continua sendo uma linha só', async () => {
  const { rl, input, fim } = novoRl();
  const p = new Promise((res) => perguntarColando(rl, '> ', res, 30));
  input.write('oi\n');
  assert.strictEqual(await p, 'oi');
  fim();
});

test('linha digitada depois da janela vira a PRÓXIMA pergunta, não é engolida', async () => {
  const { rl, input, fim } = novoRl();
  const p1 = new Promise((res) => perguntarColando(rl, '> ', res, 20));
  input.write('primeira\n');
  assert.strictEqual(await p1, 'primeira');
  const p2 = new Promise((res) => perguntarColando(rl, '> ', res, 20));
  input.write('segunda\n');
  assert.strictEqual(await p2, 'segunda');
  fim();
});

test('última linha colada SEM \\n (fica no buffer da readline) entra na mensagem e o buffer é limpo', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const rl = readline.createInterface({ input, output, terminal: true });
  const p = new Promise((res) => perguntarColando(rl, '> ', res, 30));
  input.write('linha 1\nlinha 2\núltima sem enter');
  const msg = await p;
  assert.strictEqual(msg, 'linha 1\nlinha 2\núltima sem enter');
  assert.strictEqual(rl.line, '', 'buffer da readline tem que ficar vazio');
  rl.close();
});
