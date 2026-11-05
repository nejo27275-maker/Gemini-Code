'use strict';
// v0.45.1: argumentos de ferramenta vindos como texto JSON (llama.cpp, Ollama, OpenAI-compatível).
const test = require('node:test');
const assert = require('node:assert/strict');
const { lerArgumentos } = require('../src/providers/argumentos');
const tools = require('../src/tools');

test('JSON válido, objeto pronto e vazio', () => {
  assert.deepEqual(lerArgumentos('{"path":"a.txt"}'), { path: 'a.txt' });
  assert.deepEqual(lerArgumentos({ path: 'a.txt' }), { path: 'a.txt' });
  for (const v of [undefined, null, '', '   ']) assert.deepEqual(lerArgumentos(v), {});
});

test('erros comuns de modelo pequeno são consertados: vírgula sobrando e cerca ```json', () => {
  assert.deepEqual(lerArgumentos('{"path":"a.txt",}'), { path: 'a.txt' });
  assert.deepEqual(lerArgumentos('{"todos":[{"content":"x","status":"pending"},],}'), { todos: [{ content: 'x', status: 'pending' }] });
  assert.deepEqual(lerArgumentos('```json\n{"path":"a.txt"}\n```'), { path: 'a.txt' });
  assert.deepEqual(lerArgumentos('{"content":"a,}"}'), { content: 'a,}' }, 'JSON válido não é "consertado"');
});

test('o que não dá para ler vira um erro claro na ferramenta (e ela não roda)', async () => {
  const quebrado = lerArgumentos("{'path': 'a.txt'}");
  assert.equal(typeof quebrado.__argsInvalidos, 'string');
  assert.deepEqual(Object.keys(lerArgumentos('["a"]')), ['__argsInvalidos']);
  assert.deepEqual(Object.keys(lerArgumentos('"texto"')), ['__argsInvalidos']);
  const r = await tools.execute('read_file', quebrado);
  assert.match(r, /^Erro: os argumentos de read_file vieram em JSON inválido e a ferramenta não rodou/);
  assert.match(r, /Recebido: \{'path': 'a\.txt'\}/);
});
