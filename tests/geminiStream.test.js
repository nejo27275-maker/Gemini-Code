'use strict';
// Regressão (Termux, set/2026): o Google separa eventos SSE com \r\n\r\n; o
// parser só achava \n\n e o chat respondia em branco, sem erro.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-stream-'));
process.env.HOME = home;
fs.mkdirSync(path.join(home, '.gemini-code'), { recursive: true });
fs.writeFileSync(
  path.join(home, '.gemini-code', 'config.json'),
  JSON.stringify({ apiKey: 'K', model: 'm-fake', configVersion: 99 })
);
const { chatWithTools } = require('../src/gemini');

function fakeFetch(chunks, { ok = true, status = 200, json } = {}) {
  const enc = new TextEncoder();
  return async () => ({
    ok, status, statusText: 'x',
    json: async () => json || {},
    body: {
      getReader() {
        let i = 0;
        return { read: async () => (i < chunks.length ? { done: false, value: enc.encode(chunks[i++]) } : { done: true }) };
      },
    },
  });
}
const ev = (obj) => 'data: ' + JSON.stringify(obj);
const textoParte = (t) => ({ candidates: [{ content: { parts: [{ text: t }] } }] });

async function rodar(chunks, opts) {
  global.fetch = fakeFetch(chunks, opts);
  const pedacos = [];
  const r = await chatWithTools({ history: [], onText: (t) => pedacos.push(t) });
  return { r, pedacos };
}

test('SSE com CRLF (\\r\\n\\r\\n) entrega o texto', async () => {
  const { r, pedacos } = await rodar([ev(textoParte('Olá')) + '\r\n\r\n', ev(textoParte(' mundo')) + '\r\n\r\n']);
  assert.deepStrictEqual(pedacos, ['Olá', ' mundo']);
  assert.strictEqual(r.text(), 'Olá mundo');
});

test('SSE com LF puro continua funcionando', async () => {
  const { r } = await rodar([ev(textoParte('oi')) + '\n\n']);
  assert.strictEqual(r.text(), 'oi');
});

test('evento cortado no meio, inclusive entre \\r e \\n', async () => {
  const bruto = ev(textoParte('abc')) + '\r\n\r\n' + ev(textoParte('def')) + '\r\n\r\n';
  const meio = bruto.indexOf('\r\n\r\n') + 1; // corta entre o \r e o \n
  const { r } = await rodar([bruto.slice(0, 10), bruto.slice(10, meio), bruto.slice(meio)]);
  assert.strictEqual(r.text(), 'abcdef');
});

test('último evento sem linha em branco no final também é lido', async () => {
  const { r } = await rodar([ev(textoParte('fim'))]);
  assert.strictEqual(r.text(), 'fim');
});

test('functionCall no stream é preservado com id', async () => {
  const fc = { candidates: [{ content: { parts: [{ functionCall: { name: 'read_file', args: { path: 'a' }, id: 'x1' } }] } }] };
  const { r } = await rodar([ev(fc) + '\r\n\r\n']);
  assert.deepStrictEqual(r.functionCalls(), [{ name: 'read_file', args: { path: 'a' }, id: 'x1' }]);
});

test('stream sem nenhum conteúdo vira erro claro (não silêncio)', async () => {
  await assert.rejects(
    () => rodar([ev({ promptFeedback: { blockReason: 'SAFETY' } }) + '\r\n\r\n']),
    /blockReason: SAFETY/
  );
  await assert.rejects(() => rodar([]), /resposta vazia/);
});
