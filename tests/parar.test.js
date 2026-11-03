'use strict';
// v0.48.1: "Parar" de verdade. runOnce com `signal` (src/agent.js) para no próximo ponto seguro com o histórico
// consistente, e os provedores cortam a conexão e NÃO tentam de novo, nem o outro lado (híbrido), nem o modelo
// reserva, nem sobem o llama.cpp depois do "Parar". O modo site está em tests/site.test.js.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-parar-'));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.GEMINI_CODE_RETRY_MS = '0,0';
delete process.env.GEMINI_CODE_OPENAI_KEY;
delete process.env.GEMINI_CODE_OPENAI_URL;
delete process.env.LLAMACPP_AUTOSTART;
fs.mkdirSync(path.join(HOME, '.gemini-code'), { recursive: true });
const cfgPath = path.join(HOME, '.gemini-code', 'config.json');
const configurar = (extra) => fs.writeFileSync(cfgPath, JSON.stringify({ configVersion: 99, ...extra }));

const test = require('node:test');
const assert = require('node:assert/strict');
const { runOnce, AVISO_INTERROMPIDO } = require('../src/agent');

const fetchOriginal = global.fetch;
test.afterEach(() => { global.fetch = fetchOriginal; });
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const erroAbort = () => Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
const H = (t) => [{ role: 'user', parts: [{ text: t }] }];

function deps(extra = {}) {
  return {
    loadConfig: () => ({ model: 'modelo-fake' }),
    getAllDeclarations: async () => [{ name: 'ferramenta_fake' }],
    buildSystemInstruction: () => 'sistema',
    ...extra,
  };
}
const respostaTexto = (t) => ({ functionCalls: () => [], text: () => t });
const respostaChamadas = (calls) => ({ functionCalls: () => calls, text: () => '', rawParts: () => calls.map((c) => ({ functionCall: c })) });

// ---------------------------------------------------------------------------
// O loop do agente
// ---------------------------------------------------------------------------
test('runOnce já parado: não chama o modelo; o turno fecha com "(interrompido por você)"', async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  let modelo = 0;
  const r = await runOnce('oi', { signal: ctrl.signal, deps: deps({ chatWithTools: async () => { modelo++; return respostaTexto('x'); } }) });
  assert.equal(modelo, 0);
  assert.equal(r.text, AVISO_INTERROMPIDO);
  assert.equal(r.interrompido, true);
  assert.deepEqual(r.history.map((m) => m.role), ['user', 'model']);
  assert.equal(r.history[1].parts[0].text, AVISO_INTERROMPIDO);
});

test('runOnce: parar enquanto o modelo responde volta na hora — o provedor recebe o mesmo signal', async () => {
  // provedor que respeita o signal
  const ctrl = new AbortController();
  let recebido;
  const respeita = (args) => {
    recebido = args.signal;
    return new Promise((_, rejeitar) => args.signal.addEventListener('abort', () => rejeitar(erroAbort()), { once: true }));
  };
  setTimeout(() => ctrl.abort(), 30);
  let r = await runOnce('conta uma história longa', { signal: ctrl.signal, deps: deps({ chatWithTools: respeita }) });
  assert.equal(recebido, ctrl.signal);
  assert.equal(r.interrompido, true);
  // provedor que ignora o signal e nunca responde: mesmo assim o agente para
  const c2 = new AbortController();
  setTimeout(() => c2.abort(), 30);
  const inicio = Date.now();
  r = await runOnce('oi', { signal: c2.signal, deps: deps({ chatWithTools: () => new Promise(() => {}) }) });
  assert.equal(r.interrompido, true);
  assert.ok(Date.now() - inicio < 2000);
});

test('runOnce: parar durante uma ferramenta — a próxima não roda (mas ganha resposta) e o modelo não é chamado de novo', async () => {
  const ctrl = new AbortController();
  let modelo = 0;
  const rodou = [];
  const chatWithTools = async () => { modelo++; return respostaChamadas([{ name: 'a', args: {}, id: 'c1' }, { name: 'b', args: {}, id: 'c2' }]); };
  const execute = async (nome) => { rodou.push(nome); if (nome === 'a') ctrl.abort(); return `ok ${nome}`; };
  const r = await runOnce('faz a e b', { signal: ctrl.signal, deps: deps({ chatWithTools, execute }) });
  assert.deepEqual(rodou, ['a'], 'a ferramenta "b" não rodou');
  assert.equal(modelo, 1, 'o modelo não foi chamado de novo');
  assert.equal(r.interrompido, true);
  // histórico consistente: cada chamada tem a sua resposta (com o id) e o turno fecha com texto do modelo
  assert.deepEqual(r.history.map((m) => m.role), ['user', 'model', 'user', 'model']);
  const respostas = r.history[2].parts.map((p) => p.functionResponse);
  assert.deepEqual(respostas.map((x) => x.id), ['c1', 'c2']);
  assert.equal(respostas[0].response.result, 'ok a');
  assert.match(respostas[1].response.result, /Não rodou: o usuário mandou parar/);
  assert.equal(r.history[3].parts[0].text, AVISO_INTERROMPIDO);
});

test('runOnce sem "Parar": erro do provedor continua erro, e sem signal nada muda nos argumentos', async () => {
  const ctrl = new AbortController();
  await assert.rejects(runOnce('oi', { signal: ctrl.signal, deps: deps({ chatWithTools: async () => { throw new Error('modelo fora do ar'); } }) }), /modelo fora do ar/);
  let args;
  const r = await runOnce('oi', { deps: deps({ chatWithTools: async (a) => { args = a; return respostaTexto('olá'); } }) });
  assert.equal(r.text, 'olá');
  assert.equal(r.interrompido, undefined);
  assert.ok(!('signal' in args));
});

// ---------------------------------------------------------------------------
// Os provedores
// ---------------------------------------------------------------------------
test('gemini: depois do "Parar" não tenta de novo — nem por falha de rede, nem depois de esperar o 503', async () => {
  const { fetchComRetry } = require('../src/gemini');
  const opcoes = { esperas: [0, 0, 0], aviso: () => {} };
  const ctrl = new AbortController();
  let n = 0;
  global.fetch = async () => { n++; ctrl.abort(); throw erroAbort(); };
  await assert.rejects(fetchComRetry('u', { signal: ctrl.signal }, opcoes), /aborted/);
  assert.equal(n, 1, 'uma falha por "Parar" não é repetida');
  const c2 = new AbortController();
  n = 0;
  global.fetch = async () => { n++; return { ok: false, status: 503 }; };
  await assert.rejects(fetchComRetry('u', { signal: c2.signal }, { ...opcoes, dormir: async () => c2.abort() }), /parado pelo usuário/);
  assert.equal(n, 1, 'parou durante a espera: não manda de novo');
});

test('gemini: depois do "Parar" o modelo reserva não é chamado', async () => {
  configurar({ apiKey: 'K', provider: 'gemini', model: 'principal', fallbackModel: 'reserva', enableStreaming: false });
  const gemini = require('../src/gemini');
  const ctrl = new AbortController();
  const urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    if (urls.length === 3) ctrl.abort(); // o usuário para durante a última tentativa
    return { ok: false, status: 503, statusText: 'Service Unavailable', json: async () => ({}), headers: { get: () => null } };
  };
  await assert.rejects(gemini.chatWithTools({ history: H('oi'), tools: [], systemInstruction: 's', signal: ctrl.signal }));
  assert.ok(urls.length >= 1 && urls.every((u) => u.includes('/principal:')), urls.join('\n'));
  // sem "Parar", o reserva continua valendo (comportamento de antes)
  urls.length = 0;
  global.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).includes('/reserva:')) return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'do reserva' }] } }] }) };
    return { ok: false, status: 503, statusText: 'Service Unavailable', json: async () => ({}), headers: { get: () => null } };
  };
  const r = await gemini.chatWithTools({ history: H('oi'), tools: [], systemInstruction: 's' });
  assert.equal(r.text(), 'do reserva');
});

test('roteador híbrido: depois do "Parar" não tenta o outro lado, e o llama.cpp não é ligado', async () => {
  configurar({ apiKey: 'K', provider: 'hybrid', model: 'nuvem' });
  const { chatWithTools } = require('../src/provider');
  const localServer = require('../src/localServer');
  const iniciarOriginal = localServer.iniciar;
  let ligou = false;
  localServer.iniciar = async () => { ligou = true; return { ok: false, mensagem: 'não deveria ligar' }; };
  process.env.LLAMACPP_AUTOSTART = '1';
  const urls = [];
  global.fetch = async (url, init) => {
    urls.push(String(url));
    if (init && init.signal && init.signal.aborted) throw erroAbort();
    throw new TypeError('fetch failed');
  };
  try {
    const ctrl = new AbortController();
    ctrl.abort();
    await assert.rejects(chatWithTools({ history: H('oi'), tools: [], signal: ctrl.signal }));
    assert.equal(ligou, false, 'não sobe o servidor local depois do "Parar"');
    assert.ok(urls.length === 1 && /127\.0\.0\.1:8080/.test(urls[0]), `só a chamada local, sem nuvem: ${urls.join(', ')}`);
  } finally {
    localServer.iniciar = iniciarOriginal;
    delete process.env.LLAMACPP_AUTOSTART;
  }
});

test('openai: o "Parar" corta a conexão no meio da resposta', async () => {
  let fechou = false;
  const srv = http.createServer((req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const pedaco = (t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`;
    res.write(pedaco('Era uma vez '));
    const tique = setInterval(() => res.write(pedaco('blá ')), 50);
    res.on('close', () => { clearInterval(tique); fechou = true; });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    configurar({ provider: 'openai', openaiBaseUrl: `http://127.0.0.1:${srv.address().port}/v1`, openaiApiKey: 'sk-teste', openaiModel: 'modelo' });
    const openai = require('../src/providers/openai');
    const ctrl = new AbortController();
    const pedacos = [];
    const inicio = Date.now();
    await assert.rejects(openai.chatWithTools({
      systemInstruction: 's', history: H('oi'), tools: [], signal: ctrl.signal,
      onText: (t) => { pedacos.push(t); if (pedacos.length === 2) ctrl.abort(); },
    }));
    assert.ok(Date.now() - inicio < 3000);
    for (let i = 0; i < 40 && !fechou; i++) await dormir(25);
    assert.equal(fechou, true, 'o servidor viu a conexão cair (parou de gerar)');
  } finally {
    srv.closeAllConnections?.();
    await new Promise((r) => srv.close(r));
  }
});

test('ollama: o signal vai junto no pedido', async () => {
  configurar({ provider: 'ollama', ollamaModel: 'local' });
  const ollama = require('../src/providers/ollama');
  const ctrl = new AbortController();
  let visto;
  global.fetch = async (url, init) => { visto = init.signal; throw erroAbort(); };
  await assert.rejects(ollama.chatWithTools({ history: H('oi'), tools: [], signal: ctrl.signal }));
  assert.equal(visto, ctrl.signal);
});
