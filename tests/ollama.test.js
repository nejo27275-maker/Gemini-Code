'use strict';
// Provedor local (src/providers/ollama.js): conversão de formato, streaming
// NDJSON, chamada de ferramenta (inclusive "escrita como texto"), erros claros.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-ollama-'));
process.env.HOME = home;
delete process.env.OLLAMA_HOST;

const ollama = require('../src/providers/ollama');

const TOOLS = [{ name: 'read_file', description: 'lê', parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' } } } }];

function ndjson(linhas) {
  const enc = new TextEncoder();
  let i = 0;
  return {
    ok: true, status: 200,
    body: { getReader: () => ({ read: async () => (i < linhas.length ? { done: false, value: enc.encode(JSON.stringify(linhas[i++]) + '\n') } : { done: true }) }) },
  };
}
const json = (obj, ok = true, status = 200) => ({ ok, status, json: async () => obj });

test('converterHistorico: formato Gemini -> mensagens do Ollama', () => {
  const msgs = ollama.converterHistorico([
    { role: 'user', parts: [{ text: 'leia x' }] },
    { role: 'model', parts: [{ functionCall: { name: 'read_file', args: { path: 'x' } } }] },
    { role: 'user', parts: [{ functionResponse: { name: 'read_file', response: { result: 'conteúdo' } } }] },
    { role: 'model', parts: [{ text: 'pronto' }] },
  ], 'SISTEMA');
  assert.deepEqual(msgs[0], { role: 'system', content: 'SISTEMA' });
  assert.deepEqual(msgs[1], { role: 'user', content: 'leia x' });
  assert.deepEqual(msgs[2].tool_calls, [{ function: { name: 'read_file', arguments: { path: 'x' } } }]);
  assert.deepEqual(msgs[3], { role: 'tool', tool_name: 'read_file', content: 'conteúdo' });
  assert.deepEqual(msgs[4], { role: 'assistant', content: 'pronto' });
});

test('converterTools: tipos em maiúsculo viram JSON Schema minúsculo', () => {
  const [t] = ollama.converterTools(TOOLS);
  assert.equal(t.type, 'function');
  assert.equal(t.function.parameters.type, 'object');
  assert.equal(t.function.parameters.properties.path.type, 'string');
});

test('ajustarAoContexto: corta o meio, mantém system e o mais recente, sem tool órfã', () => {
  const grande = 'x'.repeat(3000);
  const msgs = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: grande },
    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'a', arguments: {} } }] },
    { role: 'tool', tool_name: 'a', content: grande },
    { role: 'user', content: 'pergunta final' },
  ];
  const r = ollama.ajustarAoContexto(msgs, 1000); // orçamento ~2250 chars
  assert.equal(r[0].content, 'sys');
  assert.equal(r.at(-1).content, 'pergunta final');
  assert.ok(r.some((m) => /omitida/.test(m.content || '')));
  assert.notEqual(r.find((m) => m.role !== 'system' && !/omitida/.test(m.content || '')).role, 'tool');
});

test('extrairChamadaEmTexto: só aceita ferramenta que existe e JSON inteiro', () => {
  assert.deepEqual(ollama.extrairChamadaEmTexto('{"name":"read_file","arguments":{"path":"a"}}', TOOLS), { name: 'read_file', args: { path: 'a' } });
  assert.deepEqual(ollama.extrairChamadaEmTexto('```json\n{"name":"read_file","parameters":{"path":"b"}}\n```', TOOLS), { name: 'read_file', args: { path: 'b' } });
  assert.equal(ollama.extrairChamadaEmTexto('{"name":"apaga_tudo","arguments":{}}', TOOLS), null);
  assert.equal(ollama.extrairChamadaEmTexto('use {"name":"read_file"} assim', TOOLS), null);
});

test('chatWithTools em streaming: chama onText por pedaço e devolve o texto', async () => {
  global.fetch = async (url, init) => {
    assert.match(url, /127\.0\.0\.1:11434\/api\/chat$/);
    const body = JSON.parse(init.body);
    assert.equal(body.stream, true);
    assert.equal(body.options.num_ctx, 8192);
    return ndjson([{ message: { content: 'Olá' } }, { message: { content: ', mundo' } }, { done: true, message: { content: '' } }]);
  };
  const pedacos = [];
  const r = await ollama.chatWithTools({ history: [{ role: 'user', parts: [{ text: 'oi' }] }], onText: (t) => pedacos.push(t) });
  assert.deepEqual(pedacos, ['Olá', ', mundo']);
  assert.equal(r.text(), 'Olá, mundo');
  assert.equal(r.functionCalls(), undefined);
});

test('chatWithTools sem streaming: tool_calls viram functionCalls', async () => {
  global.fetch = async () => json({ message: { content: '', tool_calls: [{ function: { name: 'read_file', arguments: { path: 'z' } } }] } });
  const r = await ollama.chatWithTools({ history: [{ role: 'user', parts: [{ text: 'leia z' }] }], tools: TOOLS });
  assert.deepEqual(r.functionCalls(), [{ name: 'read_file', args: { path: 'z' }, id: undefined }]);
  assert.deepEqual(r.rawParts(), [{ functionCall: { name: 'read_file', args: { path: 'z' } } }]);
});

test('chamada de ferramenta escrita como texto é reconhecida', async () => {
  global.fetch = async () => json({ message: { content: '{"name":"read_file","arguments":{"path":"q"}}' } });
  const r = await ollama.chatWithTools({ history: [{ role: 'user', parts: [{ text: 'x' }] }], tools: TOOLS });
  assert.equal(r.functionCalls()[0].name, 'read_file');
  assert.equal(r.text(), '');
});

test('Ollama desligado: erro claro com a dica do ollama serve, marcado como rede', async () => {
  global.fetch = async () => { const e = new TypeError('fetch failed'); e.cause = { code: 'ECONNREFUSED' }; throw e; };
  await assert.rejects(
    () => ollama.chatWithTools({ history: [] }),
    (e) => /ollama serve/.test(e.message) && e.rede === true
  );
});

test('modelo não instalado: manda dar ollama pull', async () => {
  global.fetch = async () => json({ error: "model 'foo' not found" }, false, 404);
  await assert.rejects(() => ollama.chatWithTools({ history: [], modelName: 'foo' }), /ollama pull foo/);
});

test('modelo sem suporte a tools: mensagem explica o que trocar', async () => {
  global.fetch = async () => json({ error: 'registry.ollama.ai/x does not support tools' }, false, 400);
  await assert.rejects(() => ollama.chatWithTools({ history: [], tools: TOOLS }), /não suporta ferramentas/);
});

test('OLLAMA_HOST sem esquema vira http://', () => {
  process.env.OLLAMA_HOST = '192.168.0.5:11434/';
  assert.equal(ollama.baseUrl({}), 'http://192.168.0.5:11434');
  delete process.env.OLLAMA_HOST;
});
