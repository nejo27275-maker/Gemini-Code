'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { aplicar, urlValida } = require('../src/configCommands');

function fake() { const salvo = []; return { salvo, save: (p) => { salvo.push(p); return true; } }; }

test('setters de modelo salvam o campo certo e devolvem a mensagem', () => {
  const f = fake();
  assert.match(aplicar('set-model', ['gemini-x'], f.save), /Modelo principal definido: gemini-x/);
  assert.match(aplicar('set-fast-model', ['f'], f.save), /rápido/);
  assert.match(aplicar('set-ollama-model', ['q'], f.save), /Modelo local/);
  assert.match(aplicar('set-llamacpp-path', ['/storage/emulated/0/Download/modelo.gguf'], f.save), /Arquivo GGUF local definido/);
  assert.deepStrictEqual(f.salvo, [{ model: 'gemini-x' }, { fastModel: 'f' }, { ollamaModel: 'q' }, { llamaCppModelPath: '/storage/emulated/0/Download/modelo.gguf' }]);
});

test('sem argumento: mostra o uso e não salva', () => {
  const f = fake();
  assert.match(aplicar('set-model', [], f.save), /^Uso:/);
  assert.match(aplicar('set-llamacpp-url', [], f.save), /^Uso:/);
  assert.match(aplicar('set-llamacpp-path', [], f.save), /^Uso:/);
  assert.strictEqual(f.salvo.length, 0);
});

test('URL inválida é recusada; válida é salva', () => {
  const f = fake();
  assert.match(aplicar('set-llamacpp-url', ['localhost 8080'], f.save), /inválido/);
  assert.match(aplicar('set-ollama-url', ['ftp://x'], f.save), /inválido/);
  assert.strictEqual(f.salvo.length, 0);
  assert.match(aplicar('set-llamacpp-url', ['http://127.0.0.1:8080'], f.save), /llama\.cpp definido/);
  assert.deepStrictEqual(f.salvo, [{ llamaCppUrl: 'http://127.0.0.1:8080' }]);
  assert.ok(urlValida('https://a.b') && !urlValida('') && !urlValida(null));
});

test('provedor, reserva e espera de cota', () => {
  const f = fake();
  assert.match(aplicar('set-provider', ['nada'], f.save), /^Uso:/);
  assert.match(aplicar('set-provider', ['llamacpp'], f.save), /Provedor definido: llamacpp/);
  assert.match(aplicar('set-fallback-model', [], f.save), /desligado/);
  assert.match(aplicar('set-wait-quota', ['60'], f.save), /até 60s/);
  assert.match(aplicar('set-wait-quota', ['0'], f.save), /desligada/);
  assert.match(aplicar('set-wait-quota', ['301'], f.save), /^Uso:/);
  assert.match(aplicar('set-wait-quota', [], f.save), /^Uso:/);
  assert.deepStrictEqual(f.salvo.map((x) => Object.keys(x)[0]), ['provider', 'fallbackModel', 'esperarCotaSegundos', 'esperarCotaSegundos']);
});

test('subcomando que não é daqui devolve null', () => {
  assert.strictEqual(aplicar('set-key', ['x'], () => {}), null);
  assert.strictEqual(aplicar('show', [], () => {}), null);
});
