'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-llamacpp-'));
process.env.HOME = home;
fs.mkdirSync(path.join(home, '.gemini-code'), { recursive: true });
fs.writeFileSync(path.join(home, '.gemini-code', 'config.json'), JSON.stringify({
  configVersion: 99, provider: 'llamacpp', apiKey: '', llamaCppUrl: 'http://127.0.0.1:8080', llamaCppModel: 'local-model',
}));
const local = require('../src/providers/llamacpp');

 test('baseUrl normaliza esquema y elimina /v1', () => {
  assert.equal(local.baseUrl({ llamaCppUrl: '127.0.0.1:8080/v1' }), 'http://127.0.0.1:8080');
  assert.equal(local.baseUrl({ llamaCppUrl: 'https://example.test/v1/' }), 'https://example.test');
});

test('converterTools normaliza tipos de JSON Schema', () => {
  const tools = local.converterTools([{ name: 'ler', parameters: { type: 'OBJECT', properties: { p: { type: 'STRING' } } } }]);
  assert.equal(tools[0].function.parameters.type, 'object');
  assert.equal(tools[0].function.parameters.properties.p.type, 'string');
});

test('converte histórico Gemini em mensagens OpenAI-compatible preservando chamada/retorno de ferramenta', () => {
  const messages = local.converterHistorico([
    { role: 'user', parts: [{ text: 'Leia o arquivo.' }] },
    { role: 'model', parts: [{ functionCall: { name: 'read_file', args: { path: 'a.txt' }, id: 'call_abc' } }] },
    { role: 'user', parts: [{ functionResponse: { name: 'read_file', id: 'call_abc', response: { result: 'conteúdo' } } }] },
  ], 'Sistema');
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[1].content, 'Leia o arquivo.');
  assert.equal(messages[2].tool_calls[0].id, 'call_abc');
  assert.equal(messages[3].tool_call_id, 'call_abc');
  assert.equal(messages[3].content, 'conteúdo');
});

test('chatWithTools chama endpoint local e retorna texto e functionCall no formato interno', async () => {
  const oldFetch = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url: String(url), body: JSON.parse(options.body) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: {
      content: 'Vou ler o arquivo.',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } }],
    } }] }) };
  };
  try {
    const result = await local.chatWithTools({ history: [{ role: 'user', parts: [{ text: 'Leia a.txt' }] }], tools: [{ name: 'read_file', parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' } } } }] });
    assert.equal(request.url, 'http://127.0.0.1:8080/v1/chat/completions');
    assert.equal(request.body.messages.at(-1).content, 'Leia a.txt');
    assert.equal(request.body.tools[0].function.name, 'read_file');
    assert.match(result.text(), /Vou ler/);
    assert.equal(result.functionCalls()[0].name, 'read_file');
    assert.equal(result.functionCalls()[0].id, 'call_1');
    assert.deepEqual(result.functionCalls()[0].args, { path: 'a.txt' });
  } finally {
    global.fetch = oldFetch;
  }
});
