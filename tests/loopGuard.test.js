'use strict';
// v0.32.0: o agente corta o modelo repetindo a mesma chamada com o mesmo resultado.
const test = require('node:test');
const assert = require('node:assert/strict');
const loopGuard = require('../src/loopGuard');
const { runOnce } = require('../src/agent');

test('avisa na 3ª repetição idêntica e manda parar na 5ª', () => {
  const g = loopGuard.criar();
  const r = [1, 2, 3, 4, 5].map(() => g.registrar('read_file', { path: 'a.txt' }, 'conteúdo'));
  assert.equal(r[0].aviso, null);
  assert.equal(r[1].aviso, null);
  assert.match(r[2].aviso, /3 vezes/);
  assert.equal(r[2].parar, false);
  assert.equal(r[4].parar, true);
});

test('resultado diferente zera a contagem; ordem das chaves dos args não importa', () => {
  const g = loopGuard.criar();
  for (let i = 0; i < 10; i++) assert.equal(g.registrar('run_shell', { cmd: 'status' }, `saída ${i}`).aviso, null);
  const g2 = loopGuard.criar();
  g2.registrar('x', { a: 1, b: 2 }, 'r'); g2.registrar('x', { b: 2, a: 1 }, 'r');
  assert.match(g2.registrar('x', { a: 1, b: 2 }, 'r').aviso, /3 vezes/);
});

test('chamadas diferentes não se misturam', () => {
  const g = loopGuard.criar();
  for (let i = 0; i < 4; i++) {
    assert.equal(g.registrar('read_file', { path: `f${i}` }, 'ok').aviso, null);
  }
});

test('runOnce encerra o turno quando o modelo repete a mesma chamada 5 vezes', async () => {
  let chamadas = 0; let execs = 0;
  const chatWithTools = async () => {
    chamadas++;
    const c = [{ name: 'read_file', args: { path: 'a' }, id: `i${chamadas}` }];
    return { functionCalls: () => c, text: () => '', rawParts: () => c.map((x) => ({ functionCall: x })) };
  };
  const execute = async () => { execs++; return 'sempre igual'; };
  const { text, history } = await runOnce('leia', { deps: { loadConfig: () => ({}), getAllDeclarations: async () => [], buildSystemInstruction: () => 's', chatWithTools, execute } });
  assert.match(text, /\[loop\]/);
  assert.equal(execs, 5);
  assert.equal(chamadas, 5);
  assert.deepEqual(history.at(-1).role, 'model');
});

test('aviso aparece no resultado devolvido ao modelo na 3ª repetição', async () => {
  let n = 0; const vistos = [];
  const chatWithTools = async ({ history }) => {
    n++;
    if (n === 5) return { functionCalls: () => [], text: () => 'fim' };
    vistos.push(history.at(-1));
    const c = [{ name: 'list_dir', args: { path: '.' }, id: `i${n}` }];
    return { functionCalls: () => c, text: () => '', rawParts: () => c.map((x) => ({ functionCall: x })) };
  };
  await runOnce('x', { deps: { loadConfig: () => ({}), getAllDeclarations: async () => [], buildSystemInstruction: () => 's', chatWithTools, execute: async () => 'igual' } });
  const ultimo = JSON.stringify(vistos.at(-1));
  assert.match(ultimo, /3 vezes/);
});
