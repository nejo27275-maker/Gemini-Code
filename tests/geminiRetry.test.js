'use strict';
// 503 "high demand" (visto no Termux com gemini-3.6-flash) é temporário:
// deve tentar de novo sozinho, e só desistir depois de esgotar as tentativas.
const test = require('node:test');
const assert = require('node:assert');
const { fetchComRetry, erroDaApi } = require('../src/gemini');

const semEspera = { esperas: [0, 0, 0], aviso: () => {} };

test('503 seguido de 200: tenta de novo e devolve o sucesso', async () => {
  let chamadas = 0;
  global.fetch = async () => (++chamadas < 3 ? { ok: false, status: 503 } : { ok: true, status: 200 });
  const res = await fetchComRetry('u', {}, semEspera);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(chamadas, 3);
});

test('503 sempre: desiste depois de 1 + 3 tentativas e devolve o 503', async () => {
  let chamadas = 0;
  global.fetch = async () => { chamadas++; return { ok: false, status: 503 }; };
  const res = await fetchComRetry('u', {}, semEspera);
  assert.strictEqual(res.status, 503);
  assert.strictEqual(chamadas, 4);
});

test('429 e 404 NÃO são repetidos (não são transitórios)', async () => {
  for (const status of [429, 404, 403]) {
    let chamadas = 0;
    global.fetch = async () => { chamadas++; return { ok: false, status }; };
    const res = await fetchComRetry('u', {}, semEspera);
    assert.strictEqual(res.status, status);
    assert.strictEqual(chamadas, 1);
  }
});

test('erro de rede: 1 nova tentativa e depois propaga', async () => {
  let chamadas = 0;
  global.fetch = async () => { chamadas++; throw new Error('fetch failed'); };
  await assert.rejects(() => fetchComRetry('u', {}, semEspera), /fetch failed/);
  assert.strictEqual(chamadas, 2);
});

test('avisa o usuário a cada nova tentativa', async () => {
  const avisos = [];
  let chamadas = 0;
  global.fetch = async () => (++chamadas < 2 ? { ok: false, status: 503 } : { ok: true, status: 200 });
  await fetchComRetry('u', {}, { esperas: [0], aviso: (m) => avisos.push(m) });
  assert.strictEqual(avisos.length, 1);
  assert.match(avisos[0], /HTTP 503/);
});

test('erroDaApi explica o 503 como temporário', () => {
  const e = erroDaApi({ status: 503, data: { error: { status: 'UNAVAILABLE', message: 'high demand' } }, model: 'm', contexto: 'x' });
  assert.match(e.message, /temporário/);
  assert.match(e.message, /NÃO é problema da sua conta/);
  assert.match(e.message, /high demand/);
});
