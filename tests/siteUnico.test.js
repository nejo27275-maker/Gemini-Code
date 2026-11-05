'use strict';
// v0.53.0: um site só — a troca de aliado pela página (/api/aliado), o comando "site" com a lista de aliados de
// verdade, e a página num Chromium de verdade: o seletor de aliado, o microfone (ditar e a resposta falada), o
// "Ouvir" e o vai e volta entre o chat e o modo voz com a mesma conversa.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-siteunico-'));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
delete process.env.GEMINI_API_KEY;

const test = require('node:test');
const assert = require('node:assert/strict');
const site = require('../src/site/servidor');

const TOKEN = 'token-de-teste-site-unico-1234567890';
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const fechar = [];
test.afterEach(async () => { while (fechar.length) await fechar.pop()(); });
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

const chaves = { estado: () => ({ configurada: true, precisa: false, protegida: false }), validar: async () => true, salvar: () => {} };

async function subir(opcoes = {}) {
  const s = site.criarServidorSite({ token: TOKEN, pasta: HOME, chaves, ...opcoes });
  await new Promise((r) => s.servidor.listen(0, '127.0.0.1', r));
  fechar.push(() => new Promise((r) => { s.servidor.closeAllConnections?.(); s.servidor.close(r); }));
  return { ...s, porta: s.servidor.address().port };
}
function pedir(porta, caminho, obj, { token = TOKEN } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: porta, method: 'POST', path: caminho, headers: { host: `127.0.0.1:${porta}`, 'content-type': 'application/json', authorization: `Bearer ${token}` } }, (res) => {
      let corpo = '';
      res.on('data', (d) => { corpo += d; });
      res.on('end', () => resolve({ status: res.statusCode, corpo }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(obj));
  });
}
const json = (r) => JSON.parse(r.corpo);

/** Um "conversar" falso por aliado: responde dizendo quem respondeu, e guarda o pedido. */
function conversarFalso(nome, pedidos, { segurar } = {}) {
  return async (texto, o) => {
    pedidos.push({ nome, texto });
    if (segurar) await segurar;
    const resposta = nome ? `Treino montado para: ${texto}` : `Geral: ${texto}`;
    o.onText(resposta);
    return { texto: resposta, historico: [...o.historico, { role: 'user', parts: [{ text: texto }] }, { role: 'model', parts: [{ text: resposta }] }] };
  };
}
const RLO = String.fromCodePoint(0x202e);
function aliadosFalsos(pedidos, extra = {}) {
  return {
    listar: () => [{ nome: 'treinador', descricao: `treinos e ${RLO}táticas` }, { nome: 'central', descricao: 'x'.repeat(400) }, { nome: '' }, null],
    abrir: (nome) => {
      if (nome === 'central' && extra.centralQuebra) throw new Error(`definição ilegível${RLO}`);
      return { nome, conversar: conversarFalso(nome, pedidos, extra), sugestoes: nome ? ['Monta o treino de amanhã', 'Planeja a semana'] : null };
    },
  };
}

test('troca de aliado: a lista vai limpa na página, a troca começa uma conversa nova e a próxima mensagem vai para o novo', async () => {
  const pedidos = [];
  const s = await subir({ conversar: conversarFalso(null, pedidos), aliados: aliadosFalsos(pedidos) });
  let h = json(await pedir(s.porta, '/api/historico', {}));
  assert.equal(h.aliado, null);
  assert.deepEqual(h.aliados.map((a) => a.nome), ['treinador', 'central'], 'sem nome vazio nem entrada quebrada');
  assert.equal(h.aliados[0].descricao, 'treinos e táticas', 'sem caractere que inverte o texto');
  assert.equal(h.aliados[1].descricao.length, 140);
  await pedir(s.porta, '/api/conversa', { texto: 'oi' });
  assert.equal(json(await pedir(s.porta, '/api/historico', {})).mensagens.length, 2);

  const r = await pedir(s.porta, '/api/aliado', { nome: 'treinador' });
  assert.equal(r.status, 200);
  assert.deepEqual(json(r), { ok: true, aliado: 'treinador', sugestoes: ['Monta o treino de amanhã', 'Planeja a semana'] });
  h = json(await pedir(s.porta, '/api/historico', {}));
  assert.equal(h.aliado, 'treinador');
  assert.deepEqual(h.mensagens, [], 'a conversa de um não vai para o outro');
  assert.deepEqual(h.sugestoes, ['Monta o treino de amanhã', 'Planeja a semana']);
  await pedir(s.porta, '/api/conversa', { texto: 'monta o treino' });
  assert.deepEqual(pedidos.map((p) => p.nome), [null, 'treinador'], 'a mensagem foi para o aliado novo');

  // de volta ao geral (null ou ""): sem sugestões do aliado
  assert.deepEqual(json(await pedir(s.porta, '/api/aliado', { nome: '' })), { ok: true, aliado: null, sugestoes: [] });
  assert.equal(json(await pedir(s.porta, '/api/historico', {})).sugestoes, undefined);
});

test('troca de aliado: só um que existe, nunca no meio de uma resposta, e um aliado quebrado não troca nada', async () => {
  const pedidos = [];
  let soltar;
  const segurar = new Promise((r) => { soltar = r; });
  const s = await subir({ conversar: conversarFalso(null, pedidos, { segurar }), aliados: aliadosFalsos(pedidos, { centralQuebra: true }) });
  assert.equal((await pedir(s.porta, '/api/aliado', { nome: 'naoexiste' })).status, 404);
  assert.equal((await pedir(s.porta, '/api/aliado', { nome: 123 })).status, 400);
  assert.equal((await pedir(s.porta, '/api/aliado', { nome: 'x'.repeat(81) })).status, 400);
  const quebrado = await pedir(s.porta, '/api/aliado', { nome: 'central' });
  assert.equal(quebrado.status, 400);
  assert.match(json(quebrado).erro, /definição ilegível/);
  assert.ok(!json(quebrado).erro.includes(RLO));
  assert.equal(json(await pedir(s.porta, '/api/historico', {})).aliado, null, 'continua com quem estava');
  // no meio de uma resposta, não
  const conversa = pedir(s.porta, '/api/conversa', { texto: 'demora' });
  while (!pedidos.length) await dormir(10);
  const ocupado = await pedir(s.porta, '/api/aliado', { nome: 'treinador' });
  assert.equal(ocupado.status, 409);
  soltar();
  await conversa;
  assert.equal((await pedir(s.porta, '/api/aliado', { nome: 'treinador' })).status, 200);
  // sem a chave da sessão, nada
  assert.equal((await pedir(s.porta, '/api/aliado', { nome: null }, { token: 'outra-chave-qualquer-123456' })).status, 401);
});

test('sem a troca ligada (servidor antigo, testes): /api/aliado responde que não existe e o histórico não lista aliados', async () => {
  const s = await subir({ conversar: conversarFalso(null, []), aliado: 'treinador' });
  assert.equal((await pedir(s.porta, '/api/aliado', { nome: null })).status, 404);
  const h = json(await pedir(s.porta, '/api/historico', {}));
  assert.equal(h.aliados, undefined);
  assert.equal(h.aliado, 'treinador');
});

test('o comando "site" de verdade: um link só, os aliados do usuário na página e a troca para o treinador', { timeout: 60000 }, async (t) => {
  const store = require('../src/personalAgents').createPersonalAgentStore({ dir: path.join(HOME, '.gemini-code', 'aliados') });
  await require('../src/futebolCommands').executar(['aliado'], { aliados: store });
  const proj = fs.mkdtempSync(path.join(HOME, 'proj-'));
  const filho = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'gemini-code.js'), 'site', '--porta', '0'], {
    cwd: proj, env: { ...process.env, HOME, USERPROFILE: HOME, NO_COLOR: '1', FORCE_COLOR: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { try { filho.kill('SIGKILL'); } catch { /* já saiu */ } });
  let saida = '';
  filho.stdout.on('data', (d) => { saida += d; });
  filho.stderr.on('data', (d) => { saida += d; });
  const fim = Date.now() + 30000;
  const link = () => /http:\/\/127\.0\.0\.1:(\d+)\/chat#t=([A-Za-z0-9_-]+)/.exec(saida);
  while (!link() && Date.now() < fim) await dormir(100);
  const m = link();
  assert.ok(m, `o site subiu: ${saida}`);
  assert.match(saida, /Site do Gemini Code/);
  assert.match(saida, /Modo voz/);
  assert.match(saida, /Direto na esfera: http:\/\/127\.0\.0\.1:\d+\/#t=/);
  const [, porta, token] = m;
  const h = json(await pedir(Number(porta), '/api/historico', {}, { token }));
  assert.deepEqual(h.aliados.map((a) => a.nome), ['treinador']);
  assert.match(h.aliados[0].descricao, /treinador de futebol/);
  const r = json(await pedir(Number(porta), '/api/aliado', { nome: 'treinador' }, { token }));
  assert.equal(r.aliado, 'treinador');
  assert.deepEqual(r.sugestoes, require('../src/futebol').INICIADORES.slice(0, 4));
});

// ---------------------------------------------------------------------------
// A página de verdade num Chromium
// ---------------------------------------------------------------------------
const { Navegador, acharNavegador } = require('../src/navegador');
const pular = acharNavegador() ? false : 'nenhum Chrome/Chromium instalado';

// O reconhecimento e a síntese de voz do Chrome precisam de microfone, alto-falante e internet: no teste, falsos que
// ditam uma frase e guardam o que seria falado (no mundo da própria página, antes dos scripts dela).
const FALSOS_DE_VOZ = `
window.__falas = []; window.__canceladas = 0; window.__iniciados = 0;
window.SpeechRecognition = class {
  start() {
    window.__iniciados++;
    setTimeout(() => {
      if (window.__erroDoMic) { this.onerror && this.onerror({ error: window.__erroDoMic }); this.onend && this.onend(); return; }
      this.onstart && this.onstart();
      const r = [{ transcript: 'monta o treino de amanhã' }]; r.isFinal = true;
      this.onresult && this.onresult({ resultIndex: 0, results: [r] });
      setTimeout(() => this.onend && this.onend(), 40);
    }, 40);
  }
  stop() {} abort() {}
};
if (window.speechSynthesis) {
  window.speechSynthesis.speak = (u) => { window.__falas.push(u.text); setTimeout(() => u.dispatchEvent(new Event('end')), 300); };
  window.speechSynthesis.cancel = () => { window.__canceladas++; };
}
if (navigator.permissions && navigator.permissions.query) {
  const consultar = navigator.permissions.query.bind(navigator.permissions);
  navigator.permissions.query = (d) => (d && d.name === 'microphone' && window.__permissaoMic ? Promise.resolve({ state: window.__permissaoMic }) : consultar(d));
}`;

test('mensagens do microfone: cada erro com o seu caminho; "service-not-allowed" não manda permitir o microfone', () => {
  const vm = require('vm');
  const ctx = { window: {}, URL, TextDecoder, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'site', 'publico', 'comum.js'), 'utf8'), ctx);
  const m = ctx.window.GeminiSite.mensagemDeErroDeVoz;
  assert.match(m('not-allowed').texto, /Permissões › Microfone › Permitir/);
  assert.match(m('not-allowed').texto, /Configurações do Android › Apps › Chrome/, 'e o caso do Chrome sem a permissão do Android');
  assert.match(m('service-not-allowed').texto, /^Não é o microfone/);
  assert.doesNotMatch(m('service-not-allowed').texto, /Permitir/);
  assert.match(m('audio-capture').texto, /outro app/);
  assert.equal(m('no-speech').grave, false, '"não ouvi nada" não é um alarme');
  assert.equal(m('aborted'), null, 'nós mesmos paramos: nada a dizer');
  assert.match(m('bad-grammar').texto, /\(bad-grammar\)/);
  assert.equal(ctx.window.GeminiSite.podeFalar(), false, 'sem a síntese, não quebra');
});

test('navegador real: o erro do microfone aparece na tela, um de cada vez, e microfone já bloqueado nem tenta', { skip: pular, timeout: 120000 }, async (t) => {
  const s = await subir({ conversar: conversarFalso(null, []), aliados: aliadosFalsos([]) });
  const nav = new Navegador({ executavel: acharNavegador(), permitirLocal: true, navegacaoBarrada: () => null });
  await nav.iniciar();
  t.after(() => nav.fechar());
  const pagina = async (expr) => {
    const r = await nav.enviar('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  await nav.enviar('Page.addScriptToEvaluateOnNewDocument', { source: FALSOS_DE_VOZ });
  await nav.abrir(s.endereco('/chat'));
  assert.ok(await nav.esperarTexto('Como posso ajudar?', 10000));
  await pagina("window.__erroDoMic = 'not-allowed'; document.getElementById('btn-mic').click()");
  assert.ok(await nav.esperarTexto('Microfone bloqueado', 10000), 'o aviso aparece na conversa (antes só o leitor de tela ouvia)');
  assert.match(await pagina("document.querySelector('.msg-alerta').textContent"), /Permissões › Microfone › Permitir/);
  await pagina("window.__erroDoMic = 'service-not-allowed'; document.getElementById('btn-mic').click()");
  assert.ok(await nav.esperarTexto('Reconhecimento de voz indisponível', 10000));
  assert.equal(await pagina("document.querySelectorAll('.msg-alerta').length"), 1, 'o aviso novo entra no lugar do anterior');
  // já bloqueado para o site: explica sem nem tentar ouvir
  const antes = await pagina('window.__iniciados');
  await pagina("window.__erroDoMic = null; window.__permissaoMic = 'denied'; document.getElementById('btn-mic').click()");
  assert.ok(await nav.esperarTexto('Microfone bloqueado', 10000));
  assert.equal(await pagina('window.__iniciados'), antes, 'não tentou ouvir');
  // "não ouvi nada" é só um lembrete na bandeja, não um alarme na conversa
  await pagina("window.__permissaoMic = null; window.__erroDoMic = 'no-speech'; document.getElementById('btn-mic').click()");
  assert.ok(await nav.esperarTexto('fale perto dele', 10000));
  assert.equal(await pagina("document.querySelectorAll('.msg-alerta').length"), 0, 'o aviso grave anterior saiu quando tentou de novo');
  // a página de voz usa as mesmas mensagens
  await nav.eEsperar(() => pagina("document.getElementById('btn-modo-voz').click()"));
  await pagina("window.__erroDoMic = 'service-not-allowed'; document.getElementById('btn-mic').click()");
  assert.ok(await nav.esperarTexto('Não é o microfone', 10000), 'na esfera também');
});

test('navegador real: trocar de aliado no topo, ditar pelo microfone (a resposta vem falada), "Ouvir", e ir e voltar do modo voz', { skip: pular, timeout: 120000 }, async (t) => {
  const pedidos = [];
  const s = await subir({ conversar: conversarFalso(null, pedidos), aliados: aliadosFalsos(pedidos) });
  const nav = new Navegador({ executavel: acharNavegador(), permitirLocal: true, navegacaoBarrada: () => null });
  await nav.iniciar();
  t.after(() => nav.fechar());
  const pagina = async (expr) => {
    const r = await nav.enviar('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  const esperar = async (expr, ms = 10000) => {
    const ate = Date.now() + ms;
    while (Date.now() < ate) { try { if (await pagina(expr)) return true; } catch { /* trocando de página */ } await dormir(100); }
    return false;
  };
  await nav.enviar('Page.addScriptToEvaluateOnNewDocument', { source: FALSOS_DE_VOZ });
  await nav.abrir(s.endereco('/chat'));
  assert.ok(await nav.esperarTexto('Como posso ajudar?', 10000));
  // o seletor de aliado no topo
  assert.ok(await esperar("!document.getElementById('aliado-caixa').hidden"), 'o seletor apareceu');
  assert.deepEqual(await pagina("[...document.querySelectorAll('#sel-aliado option')].map((o) => o.textContent)"), ['Agente geral', 'treinador', 'central']);
  await pagina("(() => { const s = document.getElementById('sel-aliado'); s.value = 'treinador'; s.dispatchEvent(new Event('change')); })()");
  assert.ok(await nav.esperarTexto('Monta o treino de amanhã', 10000), 'as sugestões do treinador');
  assert.equal(await pagina("document.getElementById('sel-aliado').value"), 'treinador');
  // o microfone: dita, manda sozinho, e a resposta vem falada
  assert.equal(await pagina("document.getElementById('btn-mic').hidden"), false, 'com reconhecimento de voz, o microfone aparece');
  await pagina("document.getElementById('btn-mic').click()");
  assert.ok(await nav.esperarTexto('Treino montado para: monta o treino de amanhã', 10000));
  assert.deepEqual(pedidos, [{ nome: 'treinador', texto: 'monta o treino de amanhã' }]);
  assert.ok(await esperar("window.__falas.join(' ').includes('Treino montado para')"), 'a resposta foi falada');
  // "Ouvir": a fala automática usou o mesmo botão; quando ela acaba, ele solta. Tocar fala de novo; tocar de novo para.
  assert.ok(await esperar("document.querySelector('.acao-ouvir') && document.querySelector('.acao-ouvir').getAttribute('aria-pressed') === 'false'"), 'a fala automática terminou');
  await pagina("document.querySelector('.acao-ouvir').click()");
  assert.equal(await pagina("document.querySelector('.acao-ouvir').getAttribute('aria-pressed')"), 'true');
  assert.equal(await pagina("document.querySelector('.acao-ouvir').textContent"), 'Parar de ouvir');
  assert.equal(await pagina('window.__falas.length'), 2);
  const canceladas = await pagina('window.__canceladas');
  await pagina("document.querySelector('.acao-ouvir').click()");
  assert.equal(await pagina("document.querySelector('.acao-ouvir').getAttribute('aria-pressed')"), 'false', 'parou');
  assert.ok(await pagina('window.__canceladas') > canceladas, 'a fala foi cancelada de verdade');
  assert.equal(await pagina('window.__falas.length'), 2, 'parar não fala de novo');
  // o modo voz: a esfera, com a mesma conversa e o mesmo aliado
  await nav.eEsperar(() => pagina("document.getElementById('btn-modo-voz').click()"));
  assert.ok(await esperar("location.pathname === '/' && !!document.getElementById('orbe')"), 'abriu o modo voz');
  assert.ok(await nav.esperarTexto('aliado treinador', 10000), 'a esfera sabe com quem você fala');
  assert.ok(await esperar("document.getElementById('historico-lista').textContent.includes('Treino montado para')"), 'a mesma conversa');
  assert.equal(await pagina('location.hash'), '', 'a chave saiu da barra de endereço');
  // e de volta ao chat
  await nav.eEsperar(() => pagina("document.getElementById('btn-chat').click()"));
  assert.ok(await esperar("location.pathname === '/chat'"));
  assert.ok(await nav.esperarTexto('Treino montado para: monta o treino de amanhã', 10000), 'a conversa continua no chat');
  assert.equal(await pagina("document.getElementById('sel-aliado').value"), 'treinador');
});
