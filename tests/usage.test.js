'use strict';
// v0.15.0: contagem de tokens, limite por sessão e compactação automática.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-usage-'));
process.env.HOME = home;
fs.mkdirSync(path.join(home, '.gemini-code'), { recursive: true });
fs.writeFileSync(path.join(home, '.gemini-code', 'config.json'), JSON.stringify({ apiKey: 'K', model: 'm-fake', configVersion: 99 }));

const usage = require('../src/usage');
const { chatWithTools } = require('../src/gemini');

const U = (p, t) => ({ promptTokenCount: p, candidatesTokenCount: 5, totalTokenCount: t });

test('registrar soma entrada e saída (saída = total - entrada, inclui pensamento)', () => {
  usage.zerar();
  usage.registrar({ modelo: 'm', uso: U(1000, 1300) });
  usage.registrar({ modelo: 'm', uso: { promptTokenCount: 200, candidatesTokenCount: 50 } }); // sem total: usa candidates
  usage.registrar({ local: true });
  const e = usage.estado();
  assert.deepEqual([e.chamadas, e.locais, e.prompt, e.saida, e.ultimoPrompt], [2, 1, 1200, 350, 200]);
  assert.equal(usage.total(), 1550);
  assert.match(usage.resumo({ limite: 2000 }), /1\.550 \/ 2\.000/);
});

test('entradas inválidas não quebram nem somam lixo', () => {
  usage.zerar();
  usage.registrar({ modelo: 'm' });
  usage.registrar({ modelo: 'm', uso: { promptTokenCount: 'x', totalTokenCount: -5 } });
  assert.equal(usage.total(), 0);
});

test('checarLimite: 0 = sem limite; estourou = erro claro; avisa uma vez a 80%', () => {
  usage.zerar();
  usage.registrar({ modelo: 'm', uso: U(800, 800) });
  assert.doesNotThrow(() => usage.checarLimite(0));
  const orig = console.error; const msgs = [];
  console.error = (m) => msgs.push(m);
  try { usage.checarLimite(1000); usage.checarLimite(1000); } finally { console.error = orig; }
  assert.equal(msgs.length, 1, 'aviso só uma vez');
  usage.registrar({ modelo: 'm', uso: U(300, 300) });
  assert.throws(() => usage.checarLimite(1000), (e) => e.orcamento === true && /Limite de tokens/.test(e.message));
});

test('contextoGrande usa o prompt da última chamada', () => {
  usage.zerar();
  assert.equal(usage.contextoGrande(100), false);
  usage.registrar({ modelo: 'm', uso: U(500, 600) });
  assert.equal(usage.contextoGrande(100), true);
  assert.equal(usage.contextoGrande(0), false, '0 desliga');
});

test('Gemini sem streaming e com streaming registram o usageMetadata real', async () => {
  usage.zerar();
  const orig = global.fetch;
  try {
    global.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ candidates: [{ content: { parts: [{ text: 'oi' }] } }], usageMetadata: U(111, 150) }) });
    await chatWithTools({ history: [{ role: 'user', parts: [{ text: 'x' }] }], tools: [] });
    assert.deepEqual([usage.estado().prompt, usage.estado().saida], [111, 39]);

    const enc = new TextEncoder();
    const sse = [
      'data: {"candidates":[{"content":{"parts":[{"text":"a"}]}}]}\r\n\r\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"b"}]}}],"usageMetadata":{"promptTokenCount":10,"totalTokenCount":30}}\r\n\r\n',
    ];
    global.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, body: { getReader() { let i = 0; return { read: async () => (i < sse.length ? { done: false, value: enc.encode(sse[i++]) } : { done: true }) }; } } });
    await chatWithTools({ history: [{ role: 'user', parts: [{ text: 'x' }] }], tools: [], onText: () => {} });
    assert.deepEqual([usage.estado().chamadas, usage.estado().prompt, usage.estado().saida], [2, 121, 59]);
  } finally { global.fetch = orig; }
});

test('roteador: limite estourado bloqueia a nuvem, mas o modelo local continua livre', async () => {
  const cfgPath = path.join(home, '.gemini-code', 'config.json');
  fs.writeFileSync(cfgPath, JSON.stringify({ apiKey: 'K', model: 'm-fake', configVersion: 99, maxTokensSessao: 100 }));
  usage.zerar();
  usage.registrar({ modelo: 'm', uso: U(150, 150) });
  const provider = require('../src/provider');
  await assert.rejects(provider.chatWithTools({ modelName: '@cloud', history: [{ role: 'user', parts: [{ text: 'oi' }] }], tools: [] }), (e) => e.orcamento === true);
  const r = await provider.chatWithTools({ modelName: '@codeia', history: [{ role: 'user', parts: [{ text: 'oi' }] }], tools: [] });
  assert.ok(r && typeof r.rawParts === 'function');
  assert.ok(usage.estado().locais >= 1);
  fs.writeFileSync(cfgPath, JSON.stringify({ apiKey: 'K', model: 'm-fake', configVersion: 99 }));
});
