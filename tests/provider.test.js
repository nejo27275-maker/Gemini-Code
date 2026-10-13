'use strict';
// Roteador (src/provider.js): escolha nuvem/local e fallback nos dois sentidos.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-provider-'));
process.env.HOME = home;
process.env.GEMINI_CODE_RETRY_MS = '0,0';
fs.mkdirSync(path.join(home, '.gemini-code'), { recursive: true });
const cfgPath = path.join(home, '.gemini-code', 'config.json');
const cfg = (extra) => fs.writeFileSync(cfgPath, JSON.stringify({ configVersion: 99, apiKey: 'K', ...extra }));

const { escolher, pedidoPesado, chatWithTools } = require('../src/provider');
const H = (t) => [{ role: 'user', parts: [{ text: t }] }];
const base = { provider: 'hybrid', model: 'nuvem', ollamaModel: 'local', apiKey: 'K' };

test('escolha explícita manda: @local, @cloud, ollama:X, nome de modelo', () => {
  assert.equal(escolher({ cfg: base, modelName: '@local', history: [] }).provider, 'llamacpp');
  assert.equal(escolher({ cfg: base, modelName: '@cloud', history: [] }).provider, 'gemini');
  const o = escolher({ cfg: base, modelName: 'ollama:qwen3:8b', history: [] });
  assert.deepEqual([o.provider, o.model], ['ollama', 'qwen3:8b']);
  assert.equal(escolher({ cfg: base, modelName: 'gemini-x', history: [] }).model, 'gemini-x');
});

test('configuração padrão usa llama.cpp no modo híbrido', () => {
  const { DEFAULT_CONFIG } = require('../src/config');
  assert.equal(DEFAULT_CONFIG.provider, 'hybrid');
  const escolhido = escolher({ cfg: { ...DEFAULT_CONFIG, apiKey: 'K' }, history: H('oi') });
  assert.equal(escolhido.provider, 'llamacpp');
});

test('pergunta livre sem provedor salvo usa o LLM geral local via llama.cpp', async () => {
  fs.writeFileSync(cfgPath, JSON.stringify({ configVersion: 99, apiKey: '' }));
  const originalHost = process.env.OLLAMA_HOST;
  delete process.env.OLLAMA_HOST;
  let request;
  global.fetch = async (url, options) => {
    request = { url: String(url), body: JSON.parse(options.body) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Estrelas de nêutrons são restos densos de estrelas.' } }] }) };
  };
  try {
    const pergunta = 'Explique como se formam as estrelas de nêutrons';
    const resposta = await chatWithTools({ history: H(pergunta), tools: [] });
    assert.match(request.url, /127\.0\.0\.1:8080\/v1\/chat\/completions/);
    assert.equal(request.body.model, 'local-model');
    assert.equal(request.body.messages.at(-1).content, pergunta);
    assert.match(resposta.text(), /restos densos/);
  } finally {
    if (originalHost === undefined) delete process.env.OLLAMA_HOST;
    else process.env.OLLAMA_HOST = originalHost;
  }
});

test('provider gemini/ollama fixos', () => {
  assert.equal(escolher({ cfg: { ...base, provider: 'gemini' }, history: H('oi') }).provider, 'gemini');
  assert.equal(escolher({ cfg: { ...base, provider: 'ollama' }, history: H('refatore tudo') }).provider, 'ollama');
});

test('hybrid: simples vai pro local, pesado pra nuvem', () => {
  assert.equal(escolher({ cfg: base, history: H('lista os arquivos') }).provider, 'llamacpp');
  assert.equal(escolher({ cfg: base, history: H('refatore o módulo de auth') }).provider, 'gemini');
  assert.equal(escolher({ cfg: base, history: H('x'.repeat(700)) }).provider, 'gemini');
});

test('hybrid sem API key: sempre local', () => {
  assert.equal(escolher({ cfg: { ...base, apiKey: '' }, history: H('refatore tudo') }).provider, 'llamacpp');
});

test('a complexidade olha o texto do usuário, não o resultado de ferramenta', () => {
  const h = [
    ...H('lista os arquivos'),
    { role: 'user', parts: [{ functionResponse: { name: 'a', response: { result: 'refatore arquitetura '.repeat(50) } } }] },
  ];
  assert.equal(pedidoPesado(h, base), false);
});

test('hybrid: nuvem cai (sem internet) e volta resposta do local', async () => {
  cfg({ provider: 'hybrid', model: 'nuvem', ollamaModel: 'local' });
  const urls = [];
  global.fetch = async (url) => {
    urls.push(url);
    if (url.includes('googleapis')) throw new TypeError('fetch failed');
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'resposta local' } }] }) };
  };
  const orig = console.error; console.error = () => {};
  try {
    const r = await chatWithTools({ history: H('refatore isso') }); // pesado -> tenta nuvem primeiro
    assert.equal(r.text(), 'resposta local');
  } finally { console.error = orig; }
  assert.ok(urls.some((u) => u.includes('googleapis')));
  assert.ok(urls.some((u) => u.includes('/v1/chat/completions')));
});

test('hybrid: local desligado e resposta vem da nuvem', async () => {
  cfg({ provider: 'hybrid', model: 'nuvem', ollamaModel: 'local' });
  global.fetch = async (url) => {
    if (url.includes('/v1/chat/completions')) { const e = new TypeError('fetch failed'); e.cause = { code: 'ECONNREFUSED' }; throw e; }
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'resposta nuvem' }] } }] }) };
  };
  const orig = console.error; console.error = () => {};
  try {
    const r = await chatWithTools({ history: H('lista os arquivos') }); // simples -> tenta local primeiro
    assert.equal(r.text(), 'resposta nuvem');
  } finally { console.error = orig; }
});

test('provider gemini fixo NÃO cai pro local sozinho', async () => {
  cfg({ provider: 'gemini', model: 'nuvem' });
  global.fetch = async () => { throw new TypeError('fetch failed'); };
  const orig = console.error; console.error = () => {};
  try {
    await assert.rejects(() => chatWithTools({ history: H('oi') }));
  } finally { console.error = orig; }
});

test('erro de auth (não recuperável) não troca de lado', async () => {
  cfg({ provider: 'hybrid', model: 'nuvem', ollamaModel: 'local' });
  let chamouLocal = false;
  global.fetch = async (url) => {
    if (url.includes('/v1/chat/completions')) { chamouLocal = true; return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'x' } }] }) }; }
    return { ok: false, status: 403, statusText: 'x', json: async () => ({ error: { message: 'no' } }) };
  };
  await assert.rejects(() => chatWithTools({ history: H('refatore isso') }), /chave recusada/);
  assert.equal(chamouLocal, false);
});
