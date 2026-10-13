'use strict';
// Regressão: config.json antigo (com o modelo padrão antigo congelado em
// disco) não pode mais sobrepor o padrão atual pra sempre.
const test = require('node:test');
const assert = require('node:assert');
const { migrarConfig, DEFAULT_CONFIG, CONFIG_VERSION } = require('../src/config');

test('migrarConfig: modelo padrão antigo (3.1-pro) some do arquivo', () => {
  const { config, mudou, avisos } = migrarConfig({ apiKey: 'K', model: 'gemini-3.1-pro-preview' });
  assert.strictEqual(mudou, true);
  assert.strictEqual('model' in config, false);
  assert.strictEqual(config.apiKey, 'K');
  assert.strictEqual(config.configVersion, CONFIG_VERSION);
  assert.strictEqual(avisos.length, 1);
  assert.match(avisos[0], /gemini-3\.1-pro-preview/);
  assert.match(avisos[0], new RegExp(DEFAULT_CONFIG.model));
});

test('migrarConfig: gemini-2.5-pro gravado pela versão anterior também é resetado', () => {
  const { config } = migrarConfig({ model: 'gemini-2.5-pro' });
  assert.strictEqual('model' in config, false);
});

test('migrarConfig: modelo escolhido pelo usuário (não é padrão antigo) é preservado', () => {
  const { config, avisos } = migrarConfig({ model: 'gemini-3.5-flash' });
  assert.strictEqual(config.model, 'gemini-3.5-flash');
  assert.strictEqual(avisos.length, 0);
});

test('migrarConfig: config já na versão atual não é tocado', () => {
  const entrada = { configVersion: CONFIG_VERSION, model: 'gemini-2.5-pro' };
  const { config, mudou } = migrarConfig(entrada);
  assert.strictEqual(mudou, false);
  assert.strictEqual(config.model, 'gemini-2.5-pro');
});

test('migrarConfig: gemini-2.5-flash (404 pra contas novas) também é resetado', () => {
  const { config, mudou } = migrarConfig({ configVersion: 2, model: 'gemini-2.5-flash' });
  assert.strictEqual(mudou, true);
  assert.strictEqual('model' in config, false);
  assert.strictEqual(config.configVersion, CONFIG_VERSION);
});

test('o padrão atual não está na lista de padrões antigos', () => {
  assert.strictEqual(DEFAULT_CONFIG.model, 'gemini-3.6-flash');
});

test('migrarConfig: fastModel antigo (2.5-flash) também some do arquivo', () => {
  const { config, avisos } = migrarConfig({ configVersion: 3, model: 'gemini-3.6-flash', fastModel: 'gemini-2.5-flash' });
  assert.strictEqual('fastModel' in config, false);
  assert.strictEqual(config.model, 'gemini-3.6-flash');
  assert.strictEqual(config.configVersion, CONFIG_VERSION);
  assert.ok(avisos.some((a) => /fastModel/.test(a)));
});

test('migrarConfig: instalação antiga com Ollama padrão muda para hybrid/llama.cpp no Android', () => {
  const { config, mudou, avisos } = migrarConfig({ configVersion: 4, provider: 'ollama', ollamaModel: 'qwen3:4b-instruct' });
  assert.equal(mudou, true);
  assert.equal(config.provider, 'hybrid');
  assert.ok(avisos.some((aviso) => /llama\.cpp\/hybrid/.test(aviso)));
});
