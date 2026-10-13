'use strict';
// Modelo reserva (fallbackModel) quando o principal fica em 503, e o comando
// "models" (listarModelos).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-fallback-'));
process.env.HOME = home;
process.env.GEMINI_CODE_RETRY_MS = '0,0'; // sem esperar nos testes
fs.mkdirSync(path.join(home, '.gemini-code'), { recursive: true });
const cfgPath = path.join(home, '.gemini-code', 'config.json');
const escreverCfg = (extra) =>
  fs.writeFileSync(cfgPath, JSON.stringify({ apiKey: 'K', model: 'principal', configVersion: 99, ...extra }));

const { chatWithTools, listarModelos } = require('../src/gemini');

const ok = (texto) => ({
  ok: true, status: 200, statusText: 'OK',
  json: async () => ({ candidates: [{ content: { parts: [{ text: texto }] } }] }),
});
const erro = (status, message = 'high demand') => ({
  ok: false, status, statusText: 'x',
  json: async () => ({ error: { code: status, status: 'UNAVAILABLE', message } }),
});

test('principal em 503 + fallbackModel definido: usa o reserva', async () => {
  escreverCfg({ fallbackModel: 'reserva' });
  const urls = [];
  global.fetch = async (url) => {
    urls.push(url);
    return url.includes('/principal:') ? erro(503) : ok('veio do reserva');
  };
  const orig = console.error; console.error = () => {};
  try {
    const r = await chatWithTools({ history: [] });
    assert.strictEqual(r.text(), 'veio do reserva');
  } finally { console.error = orig; }
  assert.ok(urls.some((u) => u.includes('/reserva:')));
});

test('sem fallbackModel: o 503 vira erro (não inventa modelo)', async () => {
  escreverCfg({});
  global.fetch = async () => erro(503);
  const orig = console.error; console.error = () => {};
  try {
    await assert.rejects(() => chatWithTools({ history: [] }), /temporário/);
  } finally { console.error = orig; }
});

test('erro NÃO transitório (404) não aciona o reserva', async () => {
  escreverCfg({ fallbackModel: 'reserva' });
  const urls = [];
  global.fetch = async (url) => { urls.push(url); return erro(404, 'not found'); };
  await assert.rejects(() => chatWithTools({ history: [] }), /modelo não encontrado/);
  assert.ok(!urls.some((u) => u.includes('/reserva:')));
});

test('429 de cota não repete chamada nem aciona modelo reserva', async () => {
  escreverCfg({ fallbackModel: 'reserva' });
  const urls = [];
  global.fetch = async (url) => {
    urls.push(url);
    return {
      ok: false, status: 429, statusText: 'Too Many Requests',
      headers: { get: () => null },
      json: async () => ({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message:
        'Quota exceeded for metric: generate_content_free_tier_requests, limit: 5, model: principal. Please retry in 8.2s.' } }),
    };
  };
  await assert.rejects(() => chatWithTools({ history: [] }), /aguardar aproximadamente 9 segundo/);
  assert.equal(urls.length, 1, '429 deve parar depois de uma única chamada');
  assert.ok(urls[0].includes('/principal:'), 'usa o modelo Gemini configurado');
  assert.ok(!urls.some((url) => url.includes('/reserva:')), 'não troca de modelo automaticamente por cota');
});

test('listarModelos: só gemini com generateContent, ordenado', async () => {
  escreverCfg({});
  global.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({
      models: [
        { name: 'models/gemini-b', displayName: 'B', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/imagen-4', supportedGenerationMethods: ['predict'] },
        { name: 'models/gemini-a', displayName: 'A', supportedGenerationMethods: ['generateContent', 'countTokens'] },
      ],
    }),
  });
  const lista = await listarModelos();
  assert.deepStrictEqual(lista.map((m) => m.name), ['gemini-a', 'gemini-b']);
  assert.strictEqual(lista[0].displayName, 'A');
});
