'use strict';
// v0.41.0: provedor para APIs compatíveis com OpenAI COM chave (OpenRouter, OpenAI, DeepSeek...).
// Servidor local imita /chat/completions: confere Authorization, ferramentas, streaming e custo.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const HOME_FALSO = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-openai-'));
process.env.HOME = HOME_FALSO;
process.env.USERPROFILE = HOME_FALSO;
delete process.env.GEMINI_CODE_OPENAI_KEY;
delete process.env.GEMINI_CODE_OPENAI_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const usage = require('../src/usage');
const provider = require('../src/provider');
const openai = require('../src/providers/openai');
const configCommands = require('../src/configCommands');

const CHAVE = 'sk-ficticia-de-teste';
let ultimoPedido = null;
let resposta = () => ({ status: 200, json: {} });

const servidor = http.createServer((req, res) => {
  let corpo = '';
  req.on('data', (d) => { corpo += d; });
  req.on('end', () => {
    ultimoPedido = { url: req.url, headers: req.headers, body: JSON.parse(corpo || '{}') };
    const r = resposta(ultimoPedido);
    if (r.sse) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const ev of r.sse) res.write(`data: ${JSON.stringify(ev)}\n\n`);
      res.end('data: [DONE]\n\n');
      return;
    }
    res.writeHead(r.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(r.json));
  });
});

test.before(() => new Promise((ok) => servidor.listen(0, '127.0.0.1', ok)));
test.after(() => new Promise((ok) => servidor.close(ok)));
const base = () => `http://127.0.0.1:${servidor.address().port}/v1`;

const FERRAMENTAS = [{ name: 'read_file', description: 'Lê arquivo', parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' } }, required: ['path'] } }];
const HISTORICO = [
  { role: 'user', parts: [{ text: 'leia a.txt' }] },
  { role: 'model', parts: [{ functionCall: { name: 'read_file', args: { path: 'a.txt' }, id: 'call_1' } }] },
  { role: 'user', parts: [{ functionResponse: { name: 'read_file', id: 'call_1', response: { result: 'conteúdo A' } } }] },
];

test('manda Authorization, modelo, ferramentas e histórico no formato OpenAI; lê tool_calls', async () => {
  config.saveConfig({ openaiBaseUrl: base(), openaiApiKey: CHAVE, openaiModel: 'fornecedor/modelo-forte' });
  resposta = () => ({ status: 200, json: {
    choices: [{ message: { content: null, tool_calls: [{ id: 'call_2', type: 'function', function: { name: 'read_file', arguments: '{"path":"b.txt"}' } }] } }],
    usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
  } });
  usage.zerar();
  const r = await openai.chatWithTools({ systemInstruction: 'sistema', history: HISTORICO, tools: FERRAMENTAS });
  assert.equal(ultimoPedido.url, '/v1/chat/completions');
  assert.equal(ultimoPedido.headers.authorization, `Bearer ${CHAVE}`);
  assert.equal(ultimoPedido.body.model, 'fornecedor/modelo-forte');
  assert.equal(ultimoPedido.body.tools[0].function.parameters.type, 'object');
  assert.deepEqual(ultimoPedido.body.messages.map((m) => m.role), ['system', 'user', 'assistant', 'tool']);
  assert.equal(ultimoPedido.body.messages[3].tool_call_id, 'call_1');
  assert.deepEqual(r.functionCalls(), [{ name: 'read_file', args: { path: 'b.txt' }, id: 'call_2' }]);
  // Custo de nuvem: conta no /custo (não como chamada local).
  assert.equal(usage.total(), 150);
  assert.equal(usage.estado().locais, 0);
});

test('streaming: junta texto e tool_calls em pedaços e registra o usage do último pedaço', async () => {
  resposta = () => ({ sse: [
    { choices: [{ delta: { content: 'Vou ' } }] },
    { choices: [{ delta: { content: 'ler.' } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c9', function: { name: 'read_', arguments: '{"pa' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'file', arguments: 'th":"c.txt"}' } }] } }] },
    { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
  ] });
  usage.zerar();
  const pedacos = [];
  const r = await openai.chatWithTools({ history: HISTORICO.slice(0, 1), tools: FERRAMENTAS, onText: (t) => pedacos.push(t) });
  assert.equal(ultimoPedido.body.stream, true);
  assert.deepEqual(ultimoPedido.body.stream_options, { include_usage: true });
  assert.equal(pedacos.join(''), 'Vou ler.');
  assert.deepEqual(r.functionCalls(), [{ name: 'read_file', args: { path: 'c.txt' }, id: 'c9' }]);
  assert.equal(usage.total(), 15);
});

test('erros: 401 explica a chave; 429/5xx são transitórios; sem chave é recuperável', async () => {
  resposta = () => ({ status: 401, json: { error: { message: 'invalid api key' } } });
  await assert.rejects(openai.chatWithTools({ history: HISTORICO.slice(0, 1), tools: [] }), /set-openai-key/);
  resposta = () => ({ status: 429, json: { error: { message: 'rate limited' } } });
  await assert.rejects(openai.chatWithTools({ history: HISTORICO.slice(0, 1), tools: [] }), (e) => e.transitorio === true);
  config.saveConfig({ openaiApiKey: '' });
  await assert.rejects(openai.chatWithTools({ history: HISTORICO.slice(0, 1), tools: [] }), (e) => e.rede === true && /set-openai-key/.test(e.message));
  config.saveConfig({ openaiApiKey: CHAVE });
});

test('roteador: provider openai, @openai, openai:MODELO e hybridCloud openai', () => {
  const cfg = { ...config.DEFAULT_CONFIG, provider: 'openai', openaiModel: 'm1', openaiApiKey: CHAVE };
  assert.deepEqual(provider.escolher({ cfg, history: [] }).provider, 'openai');
  assert.equal(provider.escolher({ cfg: { ...cfg, provider: 'gemini' }, modelName: '@openai', history: [] }).model, 'm1');
  assert.equal(provider.escolher({ cfg, modelName: 'openai:outro/modelo', history: [] }).model, 'outro/modelo');
  const hibrido = { ...cfg, provider: 'hybrid', hybridCloud: 'openai', apiKey: '' };
  const pesado = [{ role: 'user', parts: [{ text: 'refatore a arquitetura do projeto' }] }];
  assert.equal(provider.escolher({ cfg: hibrido, history: pesado }).provider, 'openai');
  assert.equal(provider.escolher({ cfg: hibrido, history: [{ role: 'user', parts: [{ text: 'oi' }] }] }).provider, 'llamacpp');
  assert.equal(provider.escolher({ cfg: { ...hibrido, openaiApiKey: '' }, history: pesado }).provider, 'llamacpp', 'sem chave fica local');
  assert.equal(provider.escolher({ cfg: { ...hibrido, hybridCloud: 'gemini', apiKey: 'g' }, history: pesado }).provider, 'gemini');
});

test('ponta a ponta: loop do agente com provider=openai lê arquivo e devolve o resultado ao modelo', async () => {
  const projeto = fs.mkdtempSync(path.join(HOME_FALSO, 'proj-'));
  fs.writeFileSync(path.join(projeto, 'nota.txt'), 'segredo-do-teste-42');
  config.saveConfig({ provider: 'openai', openaiBaseUrl: base(), openaiApiKey: CHAVE, openaiModel: 'm-forte' });
  const pedidos = [];
  resposta = (p) => {
    pedidos.push(p.body);
    return pedidos.length === 1
      ? { status: 200, json: { choices: [{ message: { content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: path.join(projeto, 'nota.txt') }) } }] } }] } }
      : { status: 200, json: { choices: [{ message: { content: 'O arquivo diz segredo-do-teste-42.' } }] } };
  };
  const { runOnce } = require('../src/agent');
  // O log "→ usando ferramenta" do agente no stdout fazia o parser do node --test falhar sob carga
  // ("Unable to deserialize cloned data": 10 de 16 execuções paralelas; 0 de 16 sem o log). O log
  // não é o que se testa aqui, então fica mudo só durante esta chamada.
  const logOriginal = console.log;
  console.log = () => {};
  let r;
  try { r = await runOnce('o que diz nota.txt?', { deps: { buildSystemInstruction: () => 'sistema' } }); } finally { console.log = logOriginal; }
  assert.equal(r.text, 'O arquivo diz segredo-do-teste-42.');
  const tool = pedidos[1].messages.find((m) => m.role === 'tool');
  assert.equal(tool.tool_call_id, 't1');
  assert.equal(tool.content, 'segredo-do-teste-42');
  config.saveConfig({ provider: 'hybrid' });
});

test('config: set-openai-key/model/url/hybrid-cloud e provider openai', () => {
  const salvos = [];
  const salvar = (p) => salvos.push(p);
  assert.match(configCommands.aplicar('set-openai-key', ['sk-x'], salvar), /salva/);
  assert.match(configCommands.aplicar('set-openai-key', [], salvar), /^Uso/);
  assert.match(configCommands.aplicar('set-openai-model', ['anthropic/claude-sonnet-4.5'], salvar), /Modelo/);
  assert.match(configCommands.aplicar('set-openai-url', ['ftp://x'], salvar), /inválido/);
  assert.match(configCommands.aplicar('set-hybrid-cloud', ['openai'], salvar), /openai/);
  assert.match(configCommands.aplicar('set-hybrid-cloud', ['outra'], salvar), /^Uso/);
  assert.match(configCommands.aplicar('set-provider', ['openai'], salvar), /openai/);
  assert.deepEqual(salvos, [{ openaiApiKey: 'sk-x' }, { openaiModel: 'anthropic/claude-sonnet-4.5' }, { hybridCloud: 'openai' }, { provider: 'openai' }]);
});
