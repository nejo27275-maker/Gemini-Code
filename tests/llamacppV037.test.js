'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-llama37-'));
process.env.HOME = home;
fs.mkdirSync(path.join(home, '.gemini-code'), { recursive: true });
const cfgPath = path.join(home, '.gemini-code', 'config.json');
const escreverCfg = (extra = {}) => fs.writeFileSync(cfgPath, JSON.stringify({
  configVersion: 99, provider: 'llamacpp', apiKey: '', llamaCppUrl: 'http://127.0.0.1:8080', llamaCppModel: 'local-model', ...extra,
}));
escreverCfg();

const local = require('../src/providers/llamacpp');
const servidor = require('../src/localServer');
const provider = require('../src/provider');
const configCommands = require('../src/configCommands');

function sseResponse(eventos, { quebrar = false } = {}) {
  const texto = eventos.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('');
  const bytes = new TextEncoder().encode(texto);
  const pedacos = quebrar ? [bytes.slice(0, 17), bytes.slice(17, 61), bytes.slice(61)] : [bytes];
  let i = 0;
  return { ok: true, status: 200, body: { getReader: () => ({ read: async () => (i < pedacos.length ? { done: false, value: pedacos[i++] } : { done: true }) }) } };
}

test('ferramentas reais + prompt do agente cabem no contexto local (antes passavam de 3 000 tokens)', async () => {
  const tools = await require('../src/tools').getAllDeclarations();
  const sistema = require('../src/agent').buildSystemInstruction();
  const antes = local.estimarTokens(JSON.stringify(local.converterTools(tools))) + local.estimarTokens(sistema);
  assert.ok(antes > 2048, `esperava estourar 2048 sem a correção (deu ${antes})`);

  // 4096 (padrão): cabe em 35% do contexto. 2048: só as essenciais sobram (e continuam todas lá).
  const c4 = local.compactarTools(tools, Math.floor(4096 * 0.35));
  assert.ok(c4.tokens <= Math.floor(4096 * 0.35), `ctx 4096: ferramentas com ${c4.tokens} tokens`);
  const c2 = local.compactarTools(tools, Math.floor(2048 * 0.35));
  assert.ok(c2.removidas.length > 0);
  for (const c of [c4, c2]) {
    for (const essencial of ['read_file', 'write_file', 'edit_file', 'run_shell']) {
      assert.ok(c.tools.some((t) => t.name === essencial), `${essencial} precisa continuar disponível`);
    }
  }
});

test('pedido real ao servidor respeita o contexto (corpo estimado <= ctx - resposta)', async () => {
  escreverCfg({ llamaCppCtx: 2048 });
  const tools = await require('../src/tools').getAllDeclarations();
  const sistema = require('../src/agent').buildSystemInstruction();
  const historico = [];
  for (let i = 0; i < 30; i++) {
    historico.push({ role: 'user', parts: [{ text: `pergunta ${i} ${'x'.repeat(400)}` }] });
    historico.push({ role: 'model', parts: [{ text: `resposta ${i} ${'y'.repeat(400)}` }] });
  }
  historico.push({ role: 'user', parts: [{ text: 'pergunta final' }] });
  const antigo = global.fetch;
  let corpo;
  global.fetch = async (url, op) => { corpo = JSON.parse(op.body); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) }; };
  try {
    await local.chatWithTools({ systemInstruction: sistema, history: historico, tools });
  } finally { global.fetch = antigo; }
  const estimado = local.estimarTokens(JSON.stringify(corpo.messages)) + local.estimarTokens(JSON.stringify(corpo.tools || [])) + corpo.max_tokens;
  assert.ok(estimado <= 2048, `corpo estimado em ${estimado} tokens`);
  assert.equal(corpo.messages.at(-1).content, 'pergunta final');
  assert.equal(corpo.messages[0].role, 'system');
  assert.ok(corpo.max_tokens <= 512, 'resposta limitada a 25% do contexto');
  escreverCfg();
});

test('ajustarAoContexto: mantém o recente, nunca começa com "tool" órfã e trunca mensagem gigante', () => {
  const msgs = [{ role: 'system', content: 'S'.repeat(100) }];
  for (let i = 0; i < 20; i++) msgs.push({ role: 'user', content: `u${i} ${'a'.repeat(200)}` });
  msgs.push({ role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] });
  msgs.push({ role: 'tool', tool_call_id: 'c1', content: 'resultado' });
  const r = local.ajustarAoContexto(msgs, 800);
  assert.equal(r[0].role, 'system');
  assert.match(r[1].content, /omitida/);
  assert.notEqual(r[2].role, 'tool');
  assert.equal(r.at(-1).content, 'resultado');

  const gigante = local.ajustarAoContexto([{ role: 'user', content: 'z'.repeat(50000) }], 1000);
  assert.ok(gigante[0].content.length < 2000);
  assert.match(gigante[0].content, /truncado/);

  const sistemaGrande = local.ajustarAoContexto([{ role: 'system', content: 'k'.repeat(5000) }, { role: 'user', content: 'oi' }], 3000, { maxSistemaChars: 500 });
  assert.ok(sistemaGrande[0].content.length < 700);
  assert.equal(sistemaGrande.at(-1).content, 'oi');
});

test('extrairChamadasEmTexto: <tool_call> do Qwen e JSON puro; ferramenta inexistente é ignorada', () => {
  const tools = [{ name: 'read_file' }, { name: 'run_shell' }];
  const a = local.extrairChamadasEmTexto('vou ler\n<tool_call>\n{"name":"read_file","arguments":{"path":"a.txt"}}\n</tool_call>', tools);
  assert.deepEqual(a, [{ name: 'read_file', args: { path: 'a.txt' } }]);
  const b = local.extrairChamadasEmTexto('```json\n{"name":"run_shell","arguments":"{\\"command\\":\\"ls\\"}"}\n```', tools);
  assert.deepEqual(b, [{ name: 'run_shell', args: { command: 'ls' } }]);
  assert.equal(local.extrairChamadasEmTexto('{"name":"apagar_tudo","arguments":{}}', tools), null);
  assert.equal(local.extrairChamadasEmTexto('só texto', tools), null);
});

test('streaming: texto sai em pedaços e tool_calls fragmentados são remontados (SSE cortado no meio)', async () => {
  const antigo = global.fetch;
  let corpo;
  global.fetch = async (url, op) => {
    corpo = JSON.parse(op.body);
    return sseResponse([
      { choices: [{ delta: { content: 'Vou ' } }] },
      { choices: [{ delta: { content: 'ler.' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_9', function: { name: 'read_', arguments: '{"pa' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'file', arguments: 'th":"a.txt"}' } }] } }] },
      '[DONE]',
    ], { quebrar: true });
  };
  const pedacos = [];
  try {
    const r = await local.chatWithTools({ history: [{ role: 'user', parts: [{ text: 'leia' }] }], tools: [{ name: 'read_file', description: 'lê', parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' } } } }], onText: (t) => pedacos.push(t) });
    assert.equal(corpo.stream, true);
    assert.deepEqual(pedacos, ['Vou ', 'ler.']);
    assert.equal(r.text(), 'Vou ler.');
    assert.deepEqual(r.functionCalls(), [{ name: 'read_file', args: { path: 'a.txt' }, id: 'call_9' }]);
  } finally { global.fetch = antigo; }
});

// v0.43.4: sem onText (run, cowork, subagentes, workflows) o pedido ia com stream:false e o timeout de
// INATIVIDADE virava limite da geração inteira. Servidor HTTP real que imita o llama-server: com stream, um
// pedaço a cada 120 ms; sem stream, tudo de uma vez no fim. Timeout de 300 ms, geração de ~720 ms.
test('sem onText, geração mais longa que o timeout de inatividade termina (servidor HTTP real)', async (t) => {
  const http = require('node:http');
  const pedacos = ['Gerando ', 'devagar ', 'mas ', 'sem ', 'parar.'];
  const pedidos = [];
  const srv = http.createServer((req, res) => {
    let bruto = '';
    req.on('data', (c) => { bruto += c; });
    req.on('end', () => {
      const corpo = JSON.parse(bruto);
      pedidos.push(corpo);
      if (!corpo.stream) {
        setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: pedacos.join('') } }] })); }, (pedacos.length + 1) * 120);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      let i = 0;
      const tique = setInterval(() => {
        if (i < pedacos.length) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: pedacos[i++] } }] })}\n\n`);
        else { clearInterval(tique); res.end('data: [DONE]\n\n'); }
      }, 120);
    });
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  t.after(() => { escreverCfg(); return new Promise((ok) => srv.close(ok)); });
  escreverCfg({ llamaCppUrl: `http://127.0.0.1:${srv.address().port}`, llamaCppTimeoutMs: 300 });

  const r = await local.chatWithTools({ history: [{ role: 'user', parts: [{ text: 'conte' }] }], tools: [] });
  assert.equal(pedidos[0].stream, true);
  assert.equal(r.text(), 'Gerando devagar mas sem parar.');
});

test('enableStreaming:false: o servidor ainda manda em pedaços, mas o texto só é entregue inteiro no fim', async () => {
  const antigo = global.fetch;
  let corpo;
  global.fetch = async (url, op) => { corpo = JSON.parse(op.body); return sseResponse([{ choices: [{ delta: { content: 'em ' } }] }, { choices: [{ delta: { content: 'partes' } }] }, '[DONE]']); };
  escreverCfg({ enableStreaming: false });
  const entregue = [];
  try {
    const r = await local.chatWithTools({ history: [{ role: 'user', parts: [{ text: 'oi' }] }], tools: [], onText: (t) => entregue.push(t) });
    assert.equal(corpo.stream, true);
    assert.deepEqual(entregue, ['em partes']);
    assert.equal(r.text(), 'em partes');
  } finally { global.fetch = antigo; escreverCfg(); }
});

test('servidor que ignora o stream e responde JSON inteiro: o texto não se perde', async () => {
  const antigo = global.fetch;
  global.fetch = async () => ({
    ok: true, status: 200,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null) },
    body: { getReader: () => { throw new Error('não devia ler como SSE'); } },
    json: async () => ({ choices: [{ message: { content: 'inteira' } }] }),
  });
  try {
    const r = await local.chatWithTools({ history: [{ role: 'user', parts: [{ text: 'oi' }] }], tools: [] });
    assert.equal(r.text(), 'inteira');
  } finally { global.fetch = antigo; }
});

test('texto com <tool_call> vira functionCall e não vaza a tag', async () => {
  const antigo = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Lendo.\n<tool_call>{"name":"read_file","arguments":{"path":"x"}}</tool_call>' } }] }) });
  try {
    const r = await local.chatWithTools({ history: [{ role: 'user', parts: [{ text: 'oi' }] }], tools: [{ name: 'read_file', parameters: { type: 'OBJECT', properties: {} } }] });
    assert.equal(r.text(), 'Lendo.');
    assert.equal(r.functionCalls()[0].name, 'read_file');
    assert.deepEqual(r.functionCalls()[0].args, { path: 'x' });
  } finally { global.fetch = antigo; }
});

test('servidor travado: estoura o tempo e vira erro recuperável (rede) em vez de pendurar', async () => {
  escreverCfg({ llamaCppTimeoutMs: 80 });
  const antigo = global.fetch;
  global.fetch = (url, op) => new Promise((_, rej) => { op.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
  try {
    await assert.rejects(local.chatWithTools({ history: [{ role: 'user', parts: [{ text: 'oi' }] }], tools: [] }), (e) => { assert.match(e.message, /sem resposta/); assert.equal(e.rede, true); assert.equal(provider.erroRecuperavel(e), true); return true; });
  } finally { global.fetch = antigo; escreverCfg(); }
});

test('contexto estourado no servidor: mensagem clara e erro recuperável para o híbrido cair na nuvem', async () => {
  const antigo = global.fetch;
  global.fetch = async () => ({ ok: false, status: 400, statusText: 'Bad Request', json: async () => ({ error: { code: 400, type: 'exceed_context_size_error', message: 'the request exceeds the available context size' } }) });
  try {
    await assert.rejects(local.chatWithTools({ history: [{ role: 'user', parts: [{ text: 'oi' }] }], tools: [] }), (e) => { assert.equal(e.contexto, true); assert.match(e.message, /\/compact/); assert.equal(provider.erroRecuperavel(e), true); return true; });
  } finally { global.fetch = antigo; }
});

test('HTTP 500 pedindo --jinja traz a dica; falha de rede continua com erro "rede"', async () => {
  const antigo = global.fetch;
  global.fetch = async () => ({ ok: false, status: 500, statusText: 'x', json: async () => ({ error: { message: 'tools param requires --jinja flag' } }) });
  try {
    await assert.rejects(local.chatWithTools({ history: [{ role: 'user', parts: [{ text: 'oi' }] }], tools: [] }), /--jinja/);
    global.fetch = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); };
    await assert.rejects(local.chatWithTools({ history: [{ role: 'user', parts: [{ text: 'oi' }] }], tools: [] }), (e) => { assert.equal(e.rede, true); assert.match(e.message, /llamacpp start/); return true; });
  } finally { global.fetch = antigo; }
});

test('status distingue pronto, carregando (503) e offline', async () => {
  const antigo = global.fetch;
  try {
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
    assert.equal((await local.status()).estado, 'pronto');
    global.fetch = async () => ({ ok: false, status: 503, json: async () => ({ error: { message: 'Loading model' } }) });
    const c = await local.status();
    assert.equal(c.estado, 'carregando'); assert.equal(c.ok, false);
    global.fetch = async () => { throw new Error('fetch failed'); };
    assert.equal((await local.status()).estado, 'offline');
  } finally { global.fetch = antigo; }
});

test('localServer: argumentos com --jinja, só sobe em endereço local e usa o modelo/ctx pedidos', async () => {
  const args = servidor.montarArgs({ modelo: '/m.gguf', ctx: 4096, host: '127.0.0.1', port: 8080, threads: 4 });
  assert.ok(args.includes('--jinja'));
  assert.deepEqual(args.slice(0, 4), ['--model', '/m.gguf', '--ctx-size', '4096']);
  assert.deepEqual(servidor.enderecoLocal('http://localhost:9000'), { host: '127.0.0.1', port: 9000 });
  assert.equal(servidor.enderecoLocal('http://192.168.0.5:8080'), null);

  const remoto = await servidor.iniciar({ url: 'http://192.168.0.5:8080', ctx: 4096, status: async () => ({ ok: false }) });
  assert.equal(remoto.ok, false);
  assert.match(remoto.mensagem, /não é desta máquina/);

  const ja = await servidor.iniciar({ url: 'http://127.0.0.1:8080', ctx: 4096, status: async () => ({ ok: true }) });
  assert.equal(ja.ja, true);

  const semBinario = await servidor.iniciar({ url: 'http://127.0.0.1:8080', ctx: 4096, status: async () => ({ ok: false, estado: 'offline' }), env: { HOME: home } });
  assert.equal(semBinario.ok, false);
  assert.match(semBinario.mensagem, /termux-install/);
});

test('localServer: caminho GGUF persistido tem precedência sobre o legado; env ainda pode sobrescrever', () => {
  const escolhido = '/storage/emulated/0/Download/Qwen3-1.7B-Q4_K_M.gguf';
  assert.equal(servidor.caminhos({ HOME: home }, { llamaCppModelPath: escolhido }).modelo, escolhido);
  assert.equal(servidor.caminhos({ HOME: home, LLAMA_MODEL_PATH: '/tmp/override.gguf' }, { llamaCppModelPath: escolhido }).modelo, '/tmp/override.gguf');
});

test('localServer: com binário e modelo falsos, inicia com spawn destacado, grava PID e espera ficar pronto', async () => {
  const bin = path.join(home, 'fake-llama-server'); fs.writeFileSync(bin, '#!/bin/sh\n', { mode: 0o755 });
  const gguf = path.join(home, 'm.gguf'); fs.writeFileSync(gguf, 'x');
  let chamado;
  let prontoEm = 0;
  const spawnFalso = (cmd, argv, opts) => { chamado = { cmd, argv, opts }; return { pid: process.pid, on() {}, unref() {} }; };
  const r = await servidor.iniciar({
    url: 'http://127.0.0.1:8080', ctx: 3000, esperaMs: 5000, spawnFn: spawnFalso,
    status: async () => ({ ok: ++prontoEm > 2, estado: 'carregando' }),
    env: { HOME: home, LLAMA_SERVER_BIN: bin, LLAMA_MODEL_PATH: gguf, LLAMA_THREADS: '2' },
  });
  assert.equal(r.ok, true);
  assert.equal(chamado.cmd, bin);
  assert.equal(chamado.opts.detached, true);
  assert.ok(chamado.argv.includes('--jinja'));
  assert.equal(chamado.argv[chamado.argv.indexOf('--ctx-size') + 1], '3000');
  assert.equal(chamado.argv[chamado.argv.indexOf('--threads') + 1], '2');
  assert.equal(servidor.lerPid(), process.pid);
  fs.unlinkSync(servidor.pidPath());
});

test('config: set-llamacpp-ctx e set-llamacpp-autostart validam a entrada', () => {
  const salvo = {};
  const salvar = (o) => Object.assign(salvo, o);
  assert.match(configCommands.aplicar('set-llamacpp-ctx', ['10'], salvar), /Uso/);
  assert.match(configCommands.aplicar('set-llamacpp-ctx', ['abc'], salvar), /Uso/);
  assert.deepEqual(salvo, {});
  assert.match(configCommands.aplicar('set-llamacpp-ctx', ['8192'], salvar), /8192/);
  assert.equal(salvo.llamaCppCtx, 8192);
  assert.match(configCommands.aplicar('set-llamacpp-autostart', ['talvez'], salvar), /Uso/);
  configCommands.aplicar('set-llamacpp-autostart', ['on'], salvar);
  assert.equal(salvo.llamaCppAutoStart, true);
});

test('roteador: histórico grande para o contexto do llama.cpp (não do Ollama) manda para a nuvem', () => {
  const cfg = { llamaCppCtx: 2048, ollamaNumCtx: 8192, hybridComplexityChars: 600 };
  const grande = [{ role: 'user', parts: [{ text: 'oi' }] }, { role: 'model', parts: [{ text: 'a'.repeat(7000) }] }, { role: 'user', parts: [{ text: 'ok' }] }];
  assert.equal(provider.pedidoPesado(grande, cfg), true);
  assert.equal(provider.pedidoPesado([{ role: 'user', parts: [{ text: 'oi' }] }], cfg), false);
});
