'use strict';
// v0.30.0: espera opcional (e segura) do 429 por minuto.
const test = require('node:test');
const assert = require('node:assert');
const { fetchComRetry } = require('../src/gemini');

const r429 = (msg, headers = {}) => ({
  ok: false, status: 429,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  clone() { return { json: async () => ({ error: { message: msg, status: 'RESOURCE_EXHAUSTED' } }) }; },
});
const ok = { ok: true, status: 200 };

function setup(opts) {
  const avisos = []; const sonos = [];
  return { avisos, sonos, o: { esperas: [0], aviso: (m) => avisos.push(m), dormir: async (ms) => { sonos.push(ms); }, ...opts } };
}

test('429 com "retry in 12s" e teto 60: espera 13s e repete uma vez', async () => {
  let n = 0;
  global.fetch = async () => (++n === 1 ? r429('Please retry in 12s') : ok);
  const { o, sonos, avisos } = setup({ esperar429Max: 60 });
  const res = await fetchComRetry('u', {}, o);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(n, 2);
  assert.deepStrictEqual(sonos, [13000]);
  assert.match(avisos[0], /cota por minuto/);
});

test('desligado por padrão (teto 0): 429 é devolvido sem repetir', async () => {
  let n = 0;
  global.fetch = async () => { n++; return r429('Please retry in 5s'); };
  const { o } = setup({ esperar429Max: 0 });
  const res = await fetchComRetry('u', {}, o);
  assert.strictEqual(res.status, 429);
  assert.strictEqual(n, 1);
});

test('espera maior que o teto, "limit: 0" e 429 sem tempo: não repetem', async () => {
  for (const [msg, h] of [['Please retry in 120s', {}], ['quota limit: 0 Please retry in 5s', {}], ['cota excedida', {}]]) {
    let n = 0;
    global.fetch = async () => { n++; return r429(msg, h); };
    const { o } = setup({ esperar429Max: 60 });
    const res = await fetchComRetry('u', {}, o);
    assert.strictEqual(res.status, 429, msg);
    assert.strictEqual(n, 1, msg);
  }
});

test('só repete UMA vez: segundo 429 é devolvido', async () => {
  let n = 0;
  global.fetch = async () => { n++; return r429('Please retry in 3s'); };
  const { o } = setup({ esperar429Max: 60 });
  const res = await fetchComRetry('u', {}, o);
  assert.strictEqual(res.status, 429);
  assert.strictEqual(n, 2);
});

test('usa o cabeçalho Retry-After e não consome as tentativas do 503', async () => {
  const seq = [r429('x', { 'retry-after': '7' }), { ok: false, status: 503 }, ok];
  let n = 0;
  global.fetch = async () => seq[n++];
  const { o, sonos } = setup({ esperar429Max: 60, esperas: [0] });
  const res = await fetchComRetry('u', {}, o);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(sonos[0], 8000);
});
