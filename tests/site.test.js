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

test('páginas: só os nossos arquivos (voz e chat), com CSP fechada, sem moldura, nosniff e no-referrer', async () => {
  const { porta } = await subir({ conversar: async () => ({ texto: 'x', historico: [] }) });
  assert.match(CSP, /default-src 'none'/);
  assert.match(CSP, /script-src 'self'/);
  assert.match(CSP, /frame-ancestors 'none'/);
  for (const [caminho, marca] of [['/', /<canvas id="orbe"/], ['/chat', /<ol id="mensagens"/]]) {
    const r = await pedir(porta, { caminho });
    assert.equal(r.status, 200, caminho);
    assert.match(r.headers['content-type'], /text\/html/);
    assert.equal(r.headers['content-security-policy'], CSP);
    assert.equal(r.headers['x-frame-options'], 'DENY');
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['referrer-policy'], 'no-referrer');
    assert.match(r.corpo, marca);
    assert.ok(!/<script>/.test(r.corpo) && !/ on[a-z]+="/.test(r.corpo) && !/ style="/.test(r.corpo), `${caminho}: nada de script/estilo inline nem onclick (a CSP bloquearia)`);
    assert.match(r.corpo, /<script src="\/comum\.js"><\/script>/, `${caminho}: usa o comum.js`);
  }
  assert.doesNotMatch((await pedir(porta, { caminho: '/chat' })).corpo, /orbe|esfera/i, 'a versão chat não tem nada da esfera');
  for (const c of ['/app.js', '/chat.js', '/comum.js']) assert.match((await pedir(porta, { caminho: c })).headers['content-type'], /javascript/, c);
  for (const c of ['/app.css', '/chat.css']) assert.match((await pedir(porta, { caminho: c })).headers['content-type'], /text\/css/, c);
  for (const c of ['/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/servidor.js', '/publico/app.js', '/api/conversa', '/chat/', '/chat.html', '/index.html']) {
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
  assert.equal((await api(porta, '/api/conversa', { texto: 'x'.repeat(16001) })).status, 400);
  assert.equal((await pedir(porta, { metodo: 'POST', caminho: '/api/historico', corpo: '{}', headers: { 'content-type': 'application/json' } })).status, 401, 'o histórico também exige a chave');
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
// v0.48.1: "Parar" de verdade
// ---------------------------------------------------------------------------
/** Agente falso que trabalha até alguém mandar parar. */
const ateParar = (vistos) => async (texto, { historico, signal }) => {
  vistos.push(signal);
  if (texto !== 'longa') return { texto: 'ok', historico: [...historico, 'turno'] };
  await new Promise((r) => signal.addEventListener('abort', r, { once: true }));
  return { texto: '(interrompido por você)', historico: [...historico, 'parado'], interrompido: true };
};

test('Parar: /api/parar para a conversa no meio, a resposta vem marcada e a próxima mensagem funciona', async () => {
  const vistos = [];
  const { porta } = await subir({ conversar: ateParar(vistos) });
  assert.deepEqual(JSON.parse((await api(porta, '/api/parar', {})).corpo), { ok: true, parando: false }, 'sem conversa, nada a parar');
  const conversa = api(porta, '/api/conversa', { texto: 'longa' });
  await dormir(80);
  assert.equal((await pedir(porta, { metodo: 'POST', caminho: '/api/parar', corpo: '{}', headers: { 'content-type': 'application/json' } })).status, 401, 'parar também exige a chave');
  assert.equal(vistos[0].aborted, false);
  assert.deepEqual(JSON.parse((await api(porta, '/api/parar', {})).corpo), { ok: true, parando: true });
  const evs = eventos(await conversa);
  assert.deepEqual(evs.map((e) => e.tipo), ['estado', 'resposta', 'fim']);
  assert.equal(evs[1].interrompido, true);
  assert.equal(vistos[0].aborted, true);
  const depois = eventos(await api(porta, '/api/conversa', { texto: 'outra' }));
  const resposta = depois.find((e) => e.tipo === 'resposta');
  assert.equal(resposta.texto, 'ok');
  assert.equal(resposta.interrompido, undefined);
  assert.equal(vistos[1].aborted, false, 'cada conversa tem o seu "Parar"');
});

test('Parar: a página fechou no meio — o agente é parado e o servidor fica livre', async () => {
  const vistos = [];
  const { porta } = await subir({ conversar: ateParar(vistos) });
  await conversaAoVivo(porta, 'longa', (ev, req) => { if (ev.tipo === 'estado') req.destroy(); });
  for (let i = 0; i < 40 && !(vistos[0] && vistos[0].aborted); i++) await dormir(25);
  assert.equal(vistos[0].aborted, true, 'ninguém olhando: o agente para');
  for (let i = 0; i < 40; i++) {
    const r = await api(porta, '/api/conversa', { texto: 'outra' });
    if (r.status === 200) { assert.equal(eventos(r).find((e) => e.tipo === 'resposta').texto, 'ok'); return; }
    await dormir(25);
  }
  assert.fail('o servidor continuou ocupado depois de parar');
});

test('Parar: com uma pergunta aberta, ela vira "não" na hora; perguntas depois do "Parar" nem aparecem', async () => {
  const respostas = [];
  const { porta } = await subir({
    prazoPerguntaMs: 60000,
    conversar: async () => {
      respostas.push(await prompt.ask('Permitir A? (s/n) '));
      respostas.push(await prompt.ask('Permitir B? (s/n) '));
      return { texto: 'fim', historico: [] };
    },
  });
  const inicio = Date.now();
  const todos = await conversaAoVivo(porta, 'x', async (ev) => { if (ev.tipo === 'pergunta') await api(porta, '/api/parar', {}); });
  assert.deepEqual(respostas, ['', '']);
  assert.equal(todos.filter((e) => e.tipo === 'pergunta').length, 1, 'a 2ª pergunta não chegou à página');
  assert.ok(Date.now() - inicio < 10000, 'não esperou o prazo de 60 s');
});

test('Parar: conversarComAgente repassa o signal ao agente e marca a resposta interrompida', async () => {
  const ctrl = new AbortController();
  let visto;
  const runOnce = async (texto, opts) => { visto = opts.signal; return { text: '(interrompido por você)', history: ['h'], interrompido: true }; };
  const r = await conversarComAgente({ runOnce })('oi', { historico: [], onText() {}, onFerramenta() {}, onAlerta() {}, signal: ctrl.signal });
  assert.equal(visto, ctrl.signal);
  assert.deepEqual(r, { texto: '(interrompido por você)', historico: ['h'], interrompido: true });
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

test('navegador real: enquanto o agente trabalha o microfone vira "Parar", e parar funciona', { skip: pular }, async (t) => {
  const { criarFerramenta } = require('../src/tools/browserTools');
  const vistos = [];
  const s = await subir({ conversar: ateParar(vistos) });
  const f = criarFerramenta({ ask: async () => 's', loadConfig: () => ({ navegadorPermitirLocal: true }) });
  t.after(() => f.encerrar());
  let r = await f.execute('browser', { acao: 'abrir', url: s.endereco() });
  assert.match(r, /\[\d+\] botão "Falar \(espaço\)"/, r);
  const campo = (/\[(\d+)\] campo text "Mensagem para o agente"/.exec(r) || [])[1];
  await f.execute('browser', { acao: 'digitar', elemento: Number(campo), texto: 'longa', enviar: true });
  r = await f.execute('browser', { acao: 'esperar', texto: 'Pensando', segundos: 10 });
  const parar = (/\[(\d+)\] botão "Parar \(Esc\)"/.exec(r) || [])[1];
  assert.ok(parar, `o botão vira "Parar": ${r}`);
  await f.execute('browser', { acao: 'clicar', elemento: Number(parar) });
  r = await f.execute('browser', { acao: 'esperar', texto: 'Parado', segundos: 10 });
  assert.match(r, /"Parado" apareceu na página/, r);
  assert.equal(vistos[0].aborted, true, 'o servidor parou o agente');
  assert.match(r, /\[\d+\] botão "Falar \(espaço\)"/, 'o botão volta a ser o microfone');
});

// ---------------------------------------------------------------------------
// v0.49.0: versão chat, histórico ao recarregar e o Markdown seguro (comum.js)
// ---------------------------------------------------------------------------
const { paraExibicao, AVISO_INTERROMPIDO } = require('../src/site/servidor');

test('histórico para a página: falas, respostas e ferramentas; nada de resultado de ferramenta, pensamento ou hook', () => {
  assert.equal(AVISO_INTERROMPIDO, require('../src/agent').AVISO_INTERROMPIDO, 'o mesmo aviso do agente');
  const h = [
    { role: 'user', parts: [{ text: 'oi\n\n[contexto adicionado por hook do usuário]\nsegredo do hook' }] },
    { role: 'model', parts: [{ text: 'Vou ver.' }, { functionCall: { name: 'read_file', args: {} } }] },
    { role: 'user', parts: [{ functionResponse: { name: 'read_file', response: { result: 'conteúdo do arquivo' } } }] },
    { role: 'model', parts: [{ text: 'pensando alto', thought: true }, { functionCall: { name: 'browser', args: {} } }, { functionCall: { name: 'read_file', args: {} } }] },
    { role: 'user', parts: [{ functionResponse: { name: 'browser', response: {} } }, { functionResponse: { name: 'read_file', response: {} } }] },
    { role: 'user', parts: [{ text: '[hook Stop do usuário] A tarefa ainda não terminou' }] },
    { role: 'model', parts: [{ text: 'Pronto: o arquivo diz **oi**.‮' }] },
    { role: 'user', parts: [{ text: '[...histórico do meio da conversa foi omitido para economizar contexto...]' }] },
    { role: 'user', parts: [{ text: 'faz outra coisa' }] },
    { role: 'model', parts: [{ text: AVISO_INTERROMPIDO }] },
    null, { role: 'model' }, { role: 'user', parts: [{ text: '   ' }] },
  ];
  const m = paraExibicao(h);
  assert.deepEqual(m, [
    { quem: 'voce', texto: 'oi' },
    { quem: 'agente', texto: 'Vou ver.\n\nPronto: o arquivo diz **oi**.', ferramentas: ['read_file', 'browser'] },
    { quem: 'aviso', texto: 'O meio desta conversa foi resumido para caber.' },
    { quem: 'voce', texto: 'faz outra coisa' },
    { quem: 'agente', texto: '', interrompido: true },
  ]);
  assert.ok(!JSON.stringify(m).includes('conteúdo do arquivo') && !JSON.stringify(m).includes('pensando alto') && !JSON.stringify(m).includes('segredo do hook'));
  assert.equal(paraExibicao(Array.from({ length: 500 }, (_, i) => ({ role: 'user', parts: [{ text: `m${i}` }] }))).length, 200, 'só as últimas 200');
  assert.deepEqual(paraExibicao(undefined), []);
});

test('/api/historico: a conversa volta para a página (e diz se ainda está respondendo e com qual aliado)', async () => {
  let liberar;
  const { porta } = await subir({
    aliado: 'central‮',
    conversar: async (texto, { historico }) => {
      if (texto === 'longa') await new Promise((r) => { liberar = r; });
      return { texto: `resposta a ${texto}`, historico: [...historico, { role: 'user', parts: [{ text: texto }] }, { role: 'model', parts: [{ text: `resposta a ${texto}` }] }] };
    },
  });
  const vazio = JSON.parse((await api(porta, '/api/historico', {})).corpo);
  assert.deepEqual(vazio, { mensagens: [], ocupado: false, aliado: 'central' }, 'controle de direção (que reordena o texto) sai');
  await api(porta, '/api/conversa', { texto: 'primeira' });
  const longa = api(porta, '/api/conversa', { texto: 'longa' });
  await dormir(60);
  const durante = JSON.parse((await api(porta, '/api/historico', {})).corpo);
  assert.equal(durante.ocupado, true);
  assert.deepEqual(durante.mensagens, [{ quem: 'voce', texto: 'primeira' }, { quem: 'agente', texto: 'resposta a primeira' }]);
  liberar();
  await longa;
  const depois = JSON.parse((await api(porta, '/api/historico', {})).corpo);
  assert.equal(depois.ocupado, false);
  assert.equal(depois.mensagens.length, 4);
  await api(porta, '/api/limpar', {});
  assert.deepEqual(JSON.parse((await api(porta, '/api/historico', {})).corpo).mensagens, []);
});

/** Carrega comum.js (o script da página) num contexto isolado, sem navegador: só as funções puras. */
function carregarComum() {
  const vm = require('vm');
  const ctx = { window: {}, URL, TextDecoder, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'site', 'publico', 'comum.js'), 'utf8'), ctx);
  return ctx.window.GeminiSite;
}
/** Todos os nós (blocos e inline) de uma análise, para conferir que só existem tipos conhecidos. */
function nos(blocos) {
  const out = [];
  const inl = (xs) => { for (const x of xs || []) { out.push(x.t); inl(x.filhos); } };
  for (const b of blocos) {
    out.push(b.tipo);
    inl(b.inline);
    if (b.blocos) out.push(...nos(b.blocos));
    for (const it of b.itens || []) inl(it.inline);
    for (const c of b.cabecalho || []) inl(c);
    for (const l of b.linhas || []) for (const c of l) inl(c);
  }
  return out;
}

test('Markdown seguro: blocos e ênfases do dia a dia', () => {
  const { analisarMarkdown: md } = carregarComum();
  const simples = (x) => JSON.parse(JSON.stringify(x)); // os objetos vêm de outro contexto (vm)
  assert.deepEqual(simples(md('# Título\n\nUm **negrito**, um *itálico*, ~~riscado~~ e `código`.\nNova linha.')), [
    { tipo: 'titulo', nivel: 1, inline: [{ t: 'texto', v: 'Título' }] },
    { tipo: 'paragrafo', inline: [
      { t: 'texto', v: 'Um ' }, { t: 'negrito', filhos: [{ t: 'texto', v: 'negrito' }] }, { t: 'texto', v: ', um ' },
      { t: 'italico', filhos: [{ t: 'texto', v: 'itálico' }] }, { t: 'texto', v: ', ' }, { t: 'riscado', filhos: [{ t: 'texto', v: 'riscado' }] },
      { t: 'texto', v: ' e ' }, { t: 'codigo', v: 'código' }, { t: 'texto', v: '.' }, { t: 'quebra' }, { t: 'texto', v: 'Nova linha.' },
    ] },
  ]);
  // nome_com_sublinhado e 2 * 3 * 4 não viram itálico; \* escapa; *** é negrito + itálico
  assert.deepEqual(simples(md('use nome_da_variavel e 2 * 3 * 4 e \\*literal\\*')[0].inline), [{ t: 'texto', v: 'use nome_da_variavel e 2 * 3 * 4 e *literal*' }]);
  assert.deepEqual(simples(md('***forte***')[0].inline), [{ t: 'negrito', filhos: [{ t: 'italico', filhos: [{ t: 'texto', v: 'forte' }] }] }]);
  // código: cercado, com a língua; ainda aberto (a resposta chegando) também vira código; nada dentro é interpretado
  assert.deepEqual(simples(md('```js\nconst a = **1**;\n```\ndepois')), [
    { tipo: 'codigo', lingua: 'js', texto: 'const a = **1**;', aberto: false },
    { tipo: 'paragrafo', inline: [{ t: 'texto', v: 'depois' }] },
  ]);
  assert.deepEqual(simples(md('~~~\nmeio')), [{ tipo: 'codigo', lingua: '', texto: 'meio', aberto: true }]);
  // listas: ordenada com sublista e continuação; tarefas; numeração que não começa em 1
  const l = simples(md('Passos:\n1. um\n2. dois\n   - dois-a\n   continua\n\n3. três\n\n- [x] feito\n- [ ] falta\n\n5. cinco'));
  assert.deepEqual(l.map((b) => b.tipo), ['paragrafo', 'lista', 'lista', 'lista']);
  assert.deepEqual(l[1].itens.map((i) => [i.nivel, i.ordenada, i.numero]), [[0, true, 1], [0, true, 2], [1, false, 0], [0, true, 3]]);
  assert.deepEqual(l[1].itens[2].inline, [{ t: 'texto', v: 'dois-a' }, { t: 'quebra' }, { t: 'texto', v: 'continua' }]);
  assert.deepEqual(l[2].itens.map((i) => i.marcado), [true, false]);
  assert.equal(l[3].itens[0].numero, 5);
  // tabela com alinhamento; citação; régua
  const t = simples(md('| A | B | C |\n|:--|:-:|--:|\n| 1 | `x\\|y` | **3** |\n\n> citação\n> > dentro\n\n---'));
  assert.deepEqual(t.map((b) => b.tipo), ['tabela', 'citacao', 'regua']);
  assert.deepEqual(t[0].alinhamentos, ['', 'centro', 'direita']);
  assert.deepEqual(t[0].linhas[0][1], [{ t: 'codigo', v: 'x\\|y' }]);
  assert.deepEqual(t[1].blocos.map((b) => b.tipo), ['paragrafo', 'citacao']);
});

test('Markdown seguro: links só http/https, domínio de verdade à mostra, e nada vira HTML', () => {
  const { analisarMarkdown: md, linkSeguro } = carregarComum();
  const simples = (x) => JSON.parse(JSON.stringify(x));
  assert.deepEqual(simples(md('[site](https://exemplo.com/a_(b)) e https://x.com/caminho. Fim')[0].inline), [
    { t: 'link', href: 'https://exemplo.com/a_(b)', nu: false, filhos: [{ t: 'texto', v: 'site' }] },
    { t: 'texto', v: ' e ' },
    { t: 'link', href: 'https://x.com/caminho', nu: true, filhos: [{ t: 'texto', v: 'https://x.com/caminho' }] },
    { t: 'texto', v: '. Fim' },
  ]);
  // javascript:, data:, file: e afins: fica só o texto, sem link
  for (const perigoso of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<b>x</b>', 'file:///etc/passwd', 'vbscript:x', '//evil.example/x']) {
    const r = simples(md(`[clique](${perigoso})`)[0].inline);
    assert.ok(!r.some((n) => n.t === 'link'), perigoso);
    assert.equal(linkSeguro(perigoso), '', perigoso);
  }
  assert.equal(linkSeguro('https://banco.example@evil.example/'), 'https://banco.example@evil.example/', 'aceito, mas a página mostra o domínio de verdade');
  // imagem: não carrega nada de fora — vira link com o texto alternativo
  assert.deepEqual(simples(md('![gato](https://img.example/g.png)')[0].inline), [{ t: 'link', href: 'https://img.example/g.png', nu: false, filhos: [{ t: 'texto', v: 'gato' }] }]);
  // HTML e scripts ficam como texto puro (um endereço https solto no meio vira link comum, e só ele)
  const hostil = simples(md('<script>alert(1)</script> <img src=x onerror=alert(1)> <a href="javascript:x">a</a>\n\n<iframe src="https://x"></iframe>'));
  assert.ok(nos(hostil).every((t) => ['paragrafo', 'texto', 'quebra', 'link'].includes(t)), JSON.stringify(nos(hostil)));
  assert.equal(hostil[0].inline.length, 1, 'o primeiro parágrafo é um texto só, tal e qual');
  assert.equal(hostil[0].inline[0].v, '<script>alert(1)</script> <img src=x onerror=alert(1)> <a href="javascript:x">a</a>');
  assert.deepEqual(hostil[1].inline.filter((n) => n.t === 'link').map((n) => n.href), ['https://x/']);
  const tipos = new Set(['paragrafo', 'titulo', 'regua', 'codigo', 'citacao', 'lista', 'tabela', 'texto', 'quebra', 'negrito', 'italico', 'riscado', 'link']);
  assert.ok(nos(md('# a\n- b\n> c\n```\nd\n```\n|e|f|\n|-|-|\n|g|h|\n**i** *j* ~~k~~ `l` [m](https://n.o)')).every((t) => tipos.has(t)));
});

test('Markdown seguro: texto hostil ou enorme não trava a página', () => {
  const { analisarMarkdown: md } = carregarComum();
  const casos = [
    '*a '.repeat(30000), '**a '.repeat(30000), '_'.repeat(100000), '`'.repeat(50000), '['.repeat(50000) + ']('.repeat(20000),
    '> '.repeat(5000) + 'x', '- '.repeat(20000), '|'.repeat(50000) + '\n|-|\n', 'https://'.repeat(20000), '*'.repeat(100000),
    Array.from({ length: 20000 }, (_, i) => `${' '.repeat(i % 12)}- item ${i}`).join('\n'), '~~a '.repeat(30000),
  ];
  for (const c of casos) {
    const inicio = Date.now();
    md(c);
    assert.ok(Date.now() - inicio < 2000, `demorou ${Date.now() - inicio} ms: ${c.slice(0, 20)}...`);
  }
  // além de 200 mil caracteres, o resto entra como texto simples
  const grande = md('a'.repeat(250000));
  assert.equal(grande.length, 2);
  assert.equal(grande[1].inline[0].v.length, 50000);
});

test('navegador real: a versão chat — Markdown, ferramenta, permissão no meio, recarregar e parar', { skip: pular }, async (t) => {
  const { criarFerramenta } = require('../src/tools/browserTools');
  const respostas = [];
  const sinais = [];
  const s = await subir({
    conversar: async (texto, { historico, onText, onFerramenta, signal }) => {
      sinais.push(signal);
      if (texto === 'longa') {
        onText('Procurando');
        await new Promise((r) => signal.addEventListener('abort', r, { once: true }));
        return { texto: '(interrompido por você)', historico, interrompido: true };
      }
      onFerramenta('web_fetch');
      onText('Lista de **compras**:\n\n- arroz\n- feijão\n\n```bash\necho pronto\n```');
      respostas.push(await prompt.ask('O agente quer abrir o app da loja. Permitir? (s/n) '));
      onText('Depois da permissão.');
      const final = 'Lista de **compras**:\n\n- arroz\n- feijão\n\n```bash\necho pronto\n```\n\nDepois da permissão.';
      return { texto: final, historico: [...historico, { role: 'user', parts: [{ text: texto }] }, { role: 'model', parts: [{ text: final }] }] };
    },
  });
  const f = criarFerramenta({ ask: async () => 's', loadConfig: () => ({ navegadorPermitirLocal: true }) });
  t.after(() => f.encerrar());
  const numero = (r, re) => Number((re.exec(r) || [])[1]);
  let r = await f.execute('browser', { acao: 'abrir', url: s.endereco('/chat') });
  assert.match(r, /Como posso ajudar\?/, 'a página de chat subiu (CSP deixou o script rodar)');
  assert.ok(!r.includes(TOKEN), 'a chave sai da barra de endereço');
  await f.execute('browser', { acao: 'digitar', elemento: numero(r, /\[(\d+)\] campo texto "Mensagem para o agente"/), texto: 'faz a lista' });
  await f.execute('browser', { acao: 'clicar', elemento: numero(r, /\[(\d+)\] botão "Enviar"/) });
  r = await f.execute('browser', { acao: 'esperar', texto: 'O agente pede a sua permissão', segundos: 10 });
  assert.match(r, /Lista de compras:/, 'o Markdown virou formatação (sem os asteriscos)');
  assert.match(r, /\[\d+\] botão "Copiar"/, 'o bloco de código tem o botão de copiar');
  assert.match(r, /web_fetch/);
  await f.execute('browser', { acao: 'clicar', elemento: numero(r, /\[(\d+)\] botão "Permitir"/) });
  r = await f.execute('browser', { acao: 'esperar', texto: 'Depois da permissão.', segundos: 10 });
  assert.match(r, /Você permitiu\./);
  assert.deepEqual(respostas, ['s']);
  // recarregar: a conversa volta
  await f.execute('browser', { acao: 'abrir', url: `http://127.0.0.1:${s.porta}/chat` });
  r = await f.execute('browser', { acao: 'esperar', texto: 'Depois da permissão.', segundos: 10 });
  assert.match(r, /faz a lista/);
  // parar no meio
  await f.execute('browser', { acao: 'digitar', elemento: numero(r, /\[(\d+)\] campo texto "Mensagem para o agente"/), texto: 'longa' });
  await f.execute('browser', { acao: 'clicar', elemento: numero(r, /\[(\d+)\] botão "Enviar"/) });
  r = await f.execute('browser', { acao: 'esperar', texto: 'Procurando', segundos: 10 });
  await f.execute('browser', { acao: 'clicar', elemento: numero(r, /\[(\d+)\] botão "Parar a resposta \(Esc\)"/) });
  r = await f.execute('browser', { acao: 'esperar', texto: 'Você parou a resposta.', segundos: 10 });
  assert.match(r, /"Você parou a resposta\." apareceu/);
  assert.equal(sinais.at(-1).aborted, true, 'o servidor parou o agente');
});

test('versão chat: contraste das cores (WCAG AA, 4,5:1) nos temas claro e escuro', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'site', 'publico', 'chat.css'), 'utf8');
  const bloco = (ini) => { const i = css.indexOf(ini); return css.slice(i, css.indexOf('}', css.indexOf('{', i) + 1)); };
  const vars = (txt) => Object.fromEntries([...txt.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
  const claro = vars(bloco(':root {'));
  const iEscuro = css.indexOf('@media (prefers-color-scheme: dark)');
  const escuro = { ...claro, ...vars(css.slice(iEscuro, css.indexOf('}\n}', iEscuro))) };
  const lum = (h) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const razao = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  // texto sobre fundo, como aparecem na página (a resposta do agente fica direto sobre o --fundo)
  const pares = [['texto', 'fundo'], ['texto', 'superficie'], ['texto-2', 'fundo'], ['texto-2', 'superficie'], ['texto-2', 'superficie-2'],
    ['acento', 'fundo'], ['acento', 'superficie'], ['acento-texto', 'acento'], ['voce-texto', 'voce'], ['aviso-texto', 'aviso-fundo'],
    ['erro-texto', 'erro-fundo'], ['codigo-texto', 'codigo-fundo'], ['texto', 'codigo-inline']];
  for (const [tema, v] of [['claro', claro], ['escuro', escuro]]) {
    for (const [f, b] of pares) {
      assert.ok(v[f] && v[b], `${tema}: faltam as cores --${f}/--${b}`);
      assert.ok(razao(v[f], v[b]) >= 4.5, `${tema}: --${f} sobre --${b} tem ${razao(v[f], v[b]).toFixed(2)}:1 (mínimo 4,5:1)`);
    }
  }
});
