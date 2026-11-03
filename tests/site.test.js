'use strict';
// v0.48.0: modo site (src/site/servidor.js + src/site/publico/): segurança do servidor local, conversa em eventos,
// confirmações das ferramentas na página e a página de verdade num Chrome/Chromium (pulada sem navegador).
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-site-'));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;

const test = require('node:test');
const assert = require('node:assert/strict');
const { criarServidorSite, conversarComAgente, CSP } = require('../src/site/servidor');
const prompt = require('../src/ui/prompt');

test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const TOKEN = 'token-de-teste-1234567890abcdef';

async function subir(opcoes = {}) {
  const s = criarServidorSite({ token: TOKEN, ...opcoes });
  await new Promise((r) => s.servidor.listen(0, '127.0.0.1', r));
  const porta = s.servidor.address().port;
  t_fechar.push(() => new Promise((r) => s.servidor.close(r)));
  return { ...s, porta };
}
const t_fechar = [];
test.afterEach(async () => { while (t_fechar.length) await t_fechar.pop()(); });

/** Pedido HTTP cru (para mandar Host/Origin falsos, coisa que o fetch não deixa). */
function pedir(porta, { metodo = 'GET', caminho = '/', headers = {}, corpo } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: porta, method: metodo, path: caminho, headers: { host: `127.0.0.1:${porta}`, ...headers } }, (res) => {
      const partes = [];
      res.on('data', (d) => partes.push(d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, corpo: Buffer.concat(partes).toString('utf8') }));
    });
    req.on('error', reject);
    if (corpo !== undefined) req.write(corpo);
    req.end();
  });
}
const api = (porta, caminho, obj, headers = {}) => pedir(porta, {
  metodo: 'POST', caminho, corpo: JSON.stringify(obj),
  headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...headers },
});
const eventos = (r) => r.corpo.split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('página: só os três arquivos, com CSP fechada, sem moldura, nosniff e no-referrer', async () => {
  const { porta } = await subir({ conversar: async () => ({ texto: 'x', historico: [] }) });
  const r = await pedir(porta);
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /text\/html/);
  assert.equal(r.headers['content-security-policy'], CSP);
  assert.match(CSP, /default-src 'none'/);
  assert.match(CSP, /script-src 'self'/);
  assert.match(CSP, /frame-ancestors 'none'/);
  assert.equal(r.headers['x-frame-options'], 'DENY');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['referrer-policy'], 'no-referrer');
  assert.match(r.corpo, /<canvas id="orbe"/);
  assert.ok(!/<script>/.test(r.corpo) && !/ on[a-z]+="/.test(r.corpo), 'nada de script inline nem onclick (a CSP bloquearia)');
  assert.match((await pedir(porta, { caminho: '/app.js' })).headers['content-type'], /javascript/);
  assert.match((await pedir(porta, { caminho: '/app.css' })).headers['content-type'], /text\/css/);
  for (const c of ['/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/servidor.js', '/publico/app.js', '/api/conversa']) {
    assert.equal((await pedir(porta, { caminho: c })).status, 404, c);
  }
});

test('API: sem token/token errado 401; outro site (Origin) 403; DNS rebinding (Host) 421; sem CORS; só JSON; tamanho', async () => {
  let chamadas = 0;
  const { porta } = await subir({ conversar: async () => { chamadas++; return { texto: 'x', historico: [] }; } });
  assert.equal((await pedir(porta, { metodo: 'POST', caminho: '/api/conversa', corpo: '{"texto":"oi"}', headers: { 'content-type': 'application/json' } })).status, 401);
  assert.equal((await api(porta, '/api/conversa', { texto: 'oi' }, { authorization: 'Bearer errado' })).status, 401);
  assert.equal((await api(porta, '/api/conversa', { texto: 'oi' }, { authorization: `Bearer ${TOKEN}x` })).status, 401);
  assert.equal((await api(porta, '/api/conversa', { texto: 'oi' }, { origin: 'https://site-malicioso.example' })).status, 403);
  assert.equal((await api(porta, '/api/conversa', { texto: 'oi' }, { host: `malicioso.example:${porta}` })).status, 421, 'DNS rebinding: o Host não é o nosso');
  assert.equal((await pedir(porta, { headers: { host: 'malicioso.example' } })).status, 421, 'nem a página é servida para outro Host');
  const pre = await pedir(porta, { metodo: 'OPTIONS', caminho: '/api/conversa', headers: { origin: `http://127.0.0.1:${porta}`, 'access-control-request-method': 'POST' } });
  assert.equal(pre.status, 405);
  assert.equal(pre.headers['access-control-allow-origin'], undefined, 'nunca libera CORS');
  assert.equal((await api(porta, '/api/conversa', { texto: 'oi' }, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await pedir(porta, { metodo: 'POST', caminho: '/api/conversa', corpo: '{quebrado', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` } })).status, 400);
  assert.equal((await api(porta, '/api/conversa', { texto: 'x'.repeat(70 * 1024) })).status, 413);
  assert.equal((await api(porta, '/api/conversa', { texto: '   ' })).status, 400);
  assert.equal((await api(porta, '/api/conversa', { texto: 'x'.repeat(4001) })).status, 400);
  assert.equal((await api(porta, '/api/conversa', [1, 2])).status, 400);
  assert.equal((await api(porta, '/api/nada', {})).status, 404);
  assert.equal(chamadas, 0, 'nenhum pedido barrado chegou ao agente');
  assert.equal((await api(porta, '/api/conversa', { texto: 'oi' }, { host: `localhost:${porta}`, origin: `http://localhost:${porta}` })).status, 200, 'localhost na porta certa vale');
});

test('conversa: eventos em ordem (pensando, ferramenta, parciais, resposta, fim); histórico entre mensagens; limpar', async () => {
  const historicos = [];
  const { porta } = await subir({
    conversar: async (texto, { historico, onText, onFerramenta }) => {
      historicos.push(historico.length);
      onFerramenta('web_fetch');
      onText('Olá, ');
      onText('mundo\u001b[2J');
      return { texto: `resposta a "${texto}"`, historico: [...historico, { role: 'user' }, { role: 'model' }] };
    },
  });
  let r = await api(porta, '/api/conversa', { texto: 'primeira' });
  assert.match(r.headers['content-type'], /application\/x-ndjson/);
  assert.deepEqual(eventos(r).map((e) => e.tipo), ['estado', 'ferramenta', 'parcial', 'parcial', 'resposta', 'fim']);
  assert.equal(eventos(r)[1].nome, 'web_fetch');
  assert.equal(eventos(r)[4].texto, 'resposta a "primeira"');
  await api(porta, '/api/conversa', { texto: 'segunda' });
  assert.deepEqual(historicos, [0, 2], 'a segunda mensagem leva o histórico da primeira');
  assert.equal((await api(porta, '/api/limpar', {})).status, 200);
  await api(porta, '/api/conversa', { texto: 'terceira' });
  assert.deepEqual(historicos, [0, 2, 0]);
});

test('uma conversa por vez (409); erro do agente vira evento de erro, e a próxima funciona', async () => {
  let liberar;
  let vez = 0;
  const { porta } = await subir({
    conversar: async () => {
      vez++;
      if (vez === 1) { await new Promise((r) => { liberar = r; }); return { texto: 'demorada', historico: [] }; }
      if (vez === 2) throw new Error('modelo fora do ar');
      return { texto: 'ok', historico: [] };
    },
  });
  const primeira = api(porta, '/api/conversa', { texto: 'longa' });
  await dormir(80);
  assert.equal((await api(porta, '/api/conversa', { texto: 'outra' })).status, 409);
  assert.equal((await api(porta, '/api/limpar', {})).status, 409);
  liberar();
  assert.equal(eventos(await primeira).find((e) => e.tipo === 'resposta').texto, 'demorada');
  const erro = eventos(await api(porta, '/api/conversa', { texto: 'x' }));
  assert.deepEqual(erro.map((e) => e.tipo), ['estado', 'erro', 'fim']);
  assert.match(erro[1].texto, /modelo fora do ar/);
  assert.equal(eventos(await api(porta, '/api/conversa', { texto: 'y' })).find((e) => e.tipo === 'resposta').texto, 'ok');
});

/** Lê os eventos conforme chegam (para responder uma pergunta no meio da conversa). */
function conversaAoVivo(porta, texto, aoEvento) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: porta, method: 'POST', path: '/api/conversa', headers: { host: `127.0.0.1:${porta}`, 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` } }, (res) => {
      let buf = '';
      const todos = [];
      res.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) { const ev = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); todos.push(ev); aoEvento(ev, req); }
      });
      res.on('end', () => resolve(todos));
      res.on('error', () => resolve(todos)); // a "página" fechou no meio (de propósito, num dos testes)
    });
    req.on('error', () => resolve([]));
    req.end(JSON.stringify({ texto }));
  });
}

test('confirmação de ferramenta na página: a pergunta chega (sem códigos de terminal), "s" volta para o agente', async () => {
  const respostas = [];
  const { porta } = await subir({
    conversar: async () => {
      respostas.push(await prompt.ask('\n[gemini-code/computador] O agente quer digitar: "oi\u001b[2J".\nPermitir? (s/n) '));
      return { texto: respostas[0] === 's' ? 'digitado' : 'cancelado', historico: [] };
    },
  });
  const todos = await conversaAoVivo(porta, 'digita oi', async (ev) => {
    if (ev.tipo !== 'pergunta') return;
    assert.match(ev.texto, /O agente quer digitar: "oi\\x1B\[2J"/, 'o texto passa por paraExibir');
    assert.equal((await api(porta, '/api/confirmar', { id: 'nao-existe', resposta: 's' })).status, 404);
    assert.equal((await api(porta, '/api/confirmar', { id: ev.id, resposta: 's' })).status, 200);
  });
  assert.deepEqual(respostas, ['s']);
  assert.equal(todos.find((e) => e.tipo === 'resposta').texto, 'digitado');
});

test('confirmação sem resposta expira em "não"; página fechada no meio responde "não" na hora', async () => {
  const respostas = [];
  const { porta } = await subir({
    prazoPerguntaMs: 150,
    conversar: async () => {
      respostas.push(await prompt.ask('Permitir? (s/n) '));
      return { texto: 'fim', historico: [] };
    },
  });
  const todos = await conversaAoVivo(porta, 'x', () => {});
  assert.deepEqual(respostas, ['']);
  assert.ok(todos.some((e) => e.tipo === 'pergunta-expirou'));
  // página fecha antes de responder
  const s2 = await subir({
    conversar: async () => { await dormir(150); respostas.push(await prompt.ask('Permitir? (s/n) ')); return { texto: 'fim', historico: [] }; },
  });
  await conversaAoVivo(s2.porta, 'y', (ev, req) => { if (ev.tipo === 'estado') req.destroy(); });
  await dormir(400);
  assert.deepEqual(respostas, ['', ''], 'ninguém para responder = "não", sem esperar o prazo');
});

test('conversarComAgente: o agente de sempre ou um aliado (instruções, ferramentas e alerta de saúde)', async () => {
  const chamadas = [];
  const runOnce = async (texto, opts) => { chamadas.push({ texto, opts }); return { text: 'resposta', history: [...(opts.history || []), 'x'] }; };
  const conv = conversarComAgente({ runOnce });
  const onText = () => {};
  const onFerramenta = () => {};
  const r = await conv('oi', { historico: ['h'], onText, onFerramenta, onAlerta: () => {} });
  assert.deepEqual(r, { texto: 'resposta', historico: ['h', 'x'] });
  assert.equal(chamadas[0].opts.onText, onText);
  assert.equal(chamadas[0].opts.onFerramenta, onFerramenta);
  const pa = require('../src/personalAgents');
  const store = pa.createPersonalAgentStore({ dir: path.join(HOME, 'aliados') });
  store.criar({ name: 'saude', description: 'teste', instructions: 'Você é o assistente de saúde de teste.', tools: 'saude', memory: 'off' });
  const alertas = [];
  const convAliado = conversarComAgente({ aliado: { store, agente: store.carregar('saude') }, runOnce });
  await convAliado('estou com dor no peito forte', { historico: [], onText, onFerramenta, onAlerta: (t) => alertas.push(t) });
  const o = chamadas[1].opts;
  assert.match(o.extraSystemInstruction, /assistente de saúde de teste/);
  assert.ok(o.allowedTools.includes('saude_registrar'));
  assert.equal(alertas.length, 1);
  assert.match(alertas[0], /192/);
});

// ---------------------------------------------------------------------------
// A página de verdade num Chrome/Chromium (o do CI do GitHub ou o desta máquina)
// ---------------------------------------------------------------------------
const { acharNavegador } = require('../src/navegador');
const pular = acharNavegador() ? false : 'nenhum Chrome/Chromium instalado';

test('navegador real: a página sobe sem erro, a esfera desenha e uma mensagem digitada volta respondida', { skip: pular }, async (t) => {
  const { criarFerramenta } = require('../src/tools/browserTools');
  const recebidas = [];
  const s = await subir({ conversar: async (texto) => { recebidas.push(texto); return { texto: `Resposta falsa para: ${texto}`, historico: [] }; } });
  const f = criarFerramenta({ ask: async () => 's', loadConfig: () => ({ navegadorPermitirLocal: true }) });
  t.after(() => f.encerrar());
  let r = await f.execute('browser', { acao: 'abrir', url: s.endereco() });
  assert.match(r, /Toque no microfone para falar/i, 'o script da página rodou (CSP deixou)');
  assert.ok(!r.includes(TOKEN), 'a chave sai da barra de endereço');
  const n = (/\[(\d+)\] campo text "Mensagem para o agente"/.exec(r) || [])[1];
  assert.ok(n, r);
  await f.execute('browser', { acao: 'digitar', elemento: Number(n), texto: 'olá, tudo bem?', enviar: true });
  r = await f.execute('browser', { acao: 'esperar', texto: 'Resposta falsa para: olá, tudo bem?', segundos: 10 });
  assert.match(r, /apareceu na página/);
  assert.deepEqual(recebidas, ['olá, tudo bem?']);
});
