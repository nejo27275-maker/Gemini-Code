'use strict';
// v0.53.0: um site só — a troca de aliado pela página (/api/aliado), o comando "site" com a lista de aliados de
// verdade, e a página num Chromium de verdade: o seletor de aliado, o microfone (ditar e a resposta falada), o
// "Ouvir" e o vai e volta entre o chat e o modo voz com a mesma conversa. v0.53.2: o pedido de verdade do microfone
// (cada recusa com o seu caminho) e ouvir pelo Termux:API (/api/ouvir) quando o navegador não deixa.
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
// ditam uma frase e guardam o que seria falado (no mundo da própria página, antes dos scripts dela). v0.53.2: o pedido
// padrão do microfone (getUserMedia) também é falso — __erroGum = [nome, mensagem] faz o navegador recusar.
const FALSOS_DE_VOZ = `
window.__falas = []; window.__canceladas = 0; window.__iniciados = 0; window.__gum = 0; window.__soltos = 0;
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
}
if (navigator.mediaDevices) {
  navigator.mediaDevices.getUserMedia = () => {
    window.__gum++;
    if (window.__erroGum) return Promise.reject(new DOMException(window.__erroGum[1], window.__erroGum[0]));
    return Promise.resolve({ getTracks: () => [{ stop() { window.__soltos++; } }] });
  };
}`;

test('mensagens do microfone: cada erro com o seu caminho; "service-not-allowed" não manda permitir o microfone', () => {
  const vm = require('vm');
  const ctx = { window: {}, URL, TextDecoder, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'site', 'publico', 'comum.js'), 'utf8'), ctx);
  const G = ctx.window.GeminiSite;
  const m = G.mensagemDeErroDeVoz;
  assert.match(m('not-allowed').texto, /Permissões › Microfone › Permitir/);
  assert.match(m('not-allowed').texto, /Configurações do Android › Apps › Chrome/, 'e o caso do Chrome sem a permissão do Android');
  // v0.53.2: quando o ícone do endereço diz que o site "não tem permissões", o bloqueio é do Chrome inteiro
  assert.match(m('not-allowed', { site: '127.0.0.1:8765' }).texto, /Configurações do site › Microfone/);
  assert.match(m('not-allowed', { site: '127.0.0.1:8765' }).texto, /tire 127\.0\.0\.1:8765 dos bloqueados/);
  assert.match(m('not-allowed').texto, /este site/, 'sem location (fora do navegador), não quebra');
  assert.match(m('mic-sistema').titulo, /Android não deu o microfone ao Chrome/);
  assert.match(m('mic-fechado').texto, /toque no microfone de novo/);
  assert.match(m('reconhecedor-recusou').texto, /Apps › Google › Permissões › Microfone/);
  assert.match(m('service-not-allowed').texto, /^Não é o microfone/);
  assert.doesNotMatch(m('service-not-allowed').texto, /Permitir/);
  assert.match(m('audio-capture').texto, /outro app/);
  assert.equal(m('no-speech').grave, false, '"não ouvi nada" não é um alarme');
  assert.equal(m('aborted'), null, 'nós mesmos paramos: nada a dizer');
  assert.match(m('bad-grammar').texto, /\(bad-grammar\)/);
  assert.equal(G.podeFalar(), false, 'sem a síntese, não quebra');
  // o motivo que o getUserMedia dá vira o caminho certo
  const erro = (name, message) => ({ name, message });
  assert.equal(G.codigoDoErroDeMicrofone(erro('NotAllowedError', 'Permission denied')), 'not-allowed');
  assert.equal(G.codigoDoErroDeMicrofone(erro('NotAllowedError', 'Permission denied by system')), 'mic-sistema');
  assert.equal(G.codigoDoErroDeMicrofone(erro('NotAllowedError', 'Permission dismissed')), 'mic-fechado');
  assert.equal(G.codigoDoErroDeMicrofone(erro('NotFoundError', 'Requested device not found')), 'mic-ausente');
  assert.equal(G.codigoDoErroDeMicrofone(erro('NotReadableError', 'Could not start audio source')), 'audio-capture');
  assert.equal(G.codigoDoErroDeMicrofone(null), 'not-allowed');
  // o Termux só entra quando é o navegador que não deixa (não para "sem internet" nem "não ouvi nada")
  for (const c of ['not-allowed', 'service-not-allowed', 'audio-capture', 'mic-sistema', 'reconhecedor-recusou']) assert.equal(G.navegadorRecusou(c), true, c);
  for (const c of ['network', 'no-speech', 'aborted', 'mic-fechado']) assert.equal(G.navegadorRecusou(c), false, c);
});

test('navegador real: o microfone é pedido de verdade, e cada recusa aparece na tela com o seu caminho', { skip: pular, timeout: 120000 }, async (t) => {
  const s = await subir({ conversar: conversarFalso(null, []), aliados: aliadosFalsos([]), ouvirNoAparelho: null });
  const nav = new Navegador({ executavel: acharNavegador(), permitirLocal: true, navegacaoBarrada: () => null });
  await nav.iniciar();
  t.after(() => nav.fechar());
  const pagina = async (expr) => {
    const r = await nav.enviar('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  const alerta = () => pagina("[...document.querySelectorAll('.msg-alerta')].map((n) => n.textContent).join(' | ')");
  await nav.enviar('Page.addScriptToEvaluateOnNewDocument', { source: FALSOS_DE_VOZ });
  await nav.abrir(s.endereco('/chat'));
  assert.ok(await nav.esperarTexto('Como posso ajudar?', 10000));
  // v0.53.1 parava quando a consulta dizia "bloqueado", sem nem pedir: agora pede (é isso que faz o Chrome perguntar,
  // ou mostrar o microfone bloqueado no endereço) e mostra o motivo que o navegador deu
  await pagina("window.__permissaoMic = 'denied'; window.__erroGum = ['NotAllowedError', 'Permission denied']; document.getElementById('btn-mic').click()");
  assert.ok(await nav.esperarTexto('Microfone bloqueado', 10000), 'o aviso aparece na conversa');
  assert.equal(await pagina('window.__gum'), 1, 'pediu o microfone mesmo com a consulta dizendo "bloqueado"');
  assert.equal(await pagina('window.__iniciados'), 0, 'recusado o microfone, nem tenta o reconhecimento');
  let a = await alerta();
  assert.match(a, /Configurações do site › Microfone/, 'o caminho do Chrome inteiro');
  assert.match(a, new RegExp(`tire 127\\.0\\.0\\.1:${s.porta} dos bloqueados`), 'com o endereço deste site');
  assert.match(a, /detalhe: NotAllowedError: Permission denied; permissão do site: bloqueada/, 'o motivo exato');
  // o Android não deu o microfone ao Chrome
  await pagina("window.__permissaoMic = 'prompt'; window.__erroGum = ['NotAllowedError', 'Permission denied by system']; document.getElementById('btn-mic').click()");
  assert.ok(await nav.esperarTexto('O Android não deu o microfone ao Chrome', 10000));
  assert.equal(await pagina("document.querySelectorAll('.msg-alerta').length"), 1, 'o aviso novo entra no lugar do anterior');
  // o pedido fechou sem resposta
  await pagina("window.__erroGum = ['NotAllowedError', 'Permission dismissed']; document.getElementById('btn-mic').click()");
  assert.ok(await nav.esperarTexto('O pedido do microfone fechou', 10000));
  // o site tem o microfone, mas o reconhecedor do Android recusa: não é o site
  await pagina("window.__erroGum = null; window.__erroDoMic = 'not-allowed'; document.getElementById('btn-mic').click()");
  assert.ok(await nav.esperarTexto('O reconhecimento de voz recusou', 10000));
  assert.equal(await pagina('window.__soltos'), 1, 'o microfone pedido foi solto na hora (o reconhecimento precisa dele livre)');
  assert.match(await alerta(), /Apps › Google › Permissões › Microfone/);
  await pagina("window.__erroDoMic = 'service-not-allowed'; document.getElementById('btn-mic').click()");
  assert.ok(await nav.esperarTexto('Reconhecimento de voz indisponível', 10000));
  // já liberado: nem pede de novo
  const pedidos = await pagina('window.__gum');
  await pagina("window.__permissaoMic = 'granted'; window.__erroDoMic = 'no-speech'; document.getElementById('btn-mic').click()");
  // "não ouvi nada" é só um lembrete na bandeja, não um alarme na conversa
  assert.ok(await nav.esperarTexto('fale perto dele', 10000));
  assert.equal(await pagina('window.__gum'), pedidos, 'com a permissão já liberada, não pede de novo');
  assert.equal(await pagina("document.querySelectorAll('.msg-alerta').length"), 0, 'o aviso grave anterior saiu quando tentou de novo');
  // sem o Termux no servidor, o microfone não fica preso no "pelo Termux"
  assert.equal(await pagina("sessionStorage.getItem('gc-mic-aparelho')"), null);
  // a página de voz usa as mesmas mensagens e também pede o microfone
  await nav.eEsperar(() => pagina("document.getElementById('btn-modo-voz').click()"));
  await pagina("window.__permissaoMic = 'prompt'; window.__erroGum = ['NotAllowedError', 'Permission denied by system']; document.getElementById('btn-mic').click()");
  assert.ok(await nav.esperarTexto('Apps › Chrome › Permissões › Microfone', 10000), 'na esfera também');
  await pagina("window.__erroGum = null; window.__erroDoMic = 'service-not-allowed'; document.getElementById('btn-mic').click()");
  assert.ok(await nav.esperarTexto('Não é o microfone', 10000));
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

// ---------------------------------------------------------------------------
// v0.53.2: o microfone do aparelho pelo Termux:API (/api/ouvir), quando o navegador não deixa
// ---------------------------------------------------------------------------
function ouvinteFalso({ disponivel = true, respostas = [] } = {}) {
  const f = { chamadas: 0, sinais: [], respostas };
  f.disponivel = () => (typeof disponivel === 'function' ? disponivel() : disponivel);
  f.ouvir = ({ signal } = {}) => {
    f.chamadas++;
    f.sinais.push(signal);
    const r = f.respostas.length ? f.respostas.shift() : '';
    if (typeof r === 'function') return r(signal);
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  };
  return f;
}
/** Fica "ouvindo" até alguém cancelar (a página fechar o pedido, o "Parar"). */
const ateCancelar = (signal) => new Promise((_, reject) => {
  signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelado'), { cancelado: true })), { once: true });
});

test('/api/ouvir: só o texto volta (limpo), um por vez, nunca no meio de uma resposta, e cancelar encerra o Termux', async () => {
  const pedidos = [];
  const linhas = [];
  let soltar;
  const segurar = new Promise((r) => { soltar = r; });
  const BEL = String.fromCodePoint(7);
  const f = ouvinteFalso({ respostas: [`  monta   o treino${RLO} de${BEL}amanhã\n `, 'x'.repeat(5000), ateCancelar, ateCancelar] });
  const s = await subir({ conversar: conversarFalso(null, pedidos, { segurar }), ouvirNoAparelho: f, log: (l) => linhas.push(String(l)) });
  assert.equal(json(await pedir(s.porta, '/api/historico', {})).ouvirNoAparelho, true);
  let r = await pedir(s.porta, '/api/ouvir', {});
  assert.equal(r.status, 200);
  assert.deepEqual(json(r), { texto: 'monta o treino de amanhã' }, 'sem controle nem caractere que inverte o texto');
  assert.ok(!linhas.join('\n').includes('monta o treino'), 'o que foi ouvido não vai para o log');
  assert.equal(json(await pedir(s.porta, '/api/ouvir', {})).texto.length, 4000);
  // um por vez
  const primeiro = pedir(s.porta, '/api/ouvir', {});
  while (f.chamadas < 3) await dormir(10);
  r = await pedir(s.porta, '/api/ouvir', {});
  assert.equal(r.status, 409);
  assert.match(json(r).erro, /já estou ouvindo/);
  // "Parar" encerra o microfone também
  assert.equal((await pedir(s.porta, '/api/parar', {})).status, 200);
  assert.equal(f.sinais[2].aborted, true);
  assert.deepEqual(json(await primeiro), { texto: '', cancelado: true });
  // a página fechou o pedido no meio (tocou de novo no microfone, recarregou): o Termux é encerrado
  const req = http.request({ host: '127.0.0.1', port: s.porta, method: 'POST', path: '/api/ouvir', headers: { host: `127.0.0.1:${s.porta}`, 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` } });
  req.on('error', () => {});
  req.end('{}');
  while (f.chamadas < 4) await dormir(10);
  req.destroy();
  const ate = Date.now() + 5000;
  while (!f.sinais[3].aborted && Date.now() < ate) await dormir(10);
  assert.equal(f.sinais[3].aborted, true, 'fechar o pedido cancela');
  while (Date.now() < ate && (await pedir(s.porta, '/api/ouvir', {})).status === 409) await dormir(20); // terminou de limpar
  // no meio de uma resposta, não
  const conversa = pedir(s.porta, '/api/conversa', { texto: 'demora' });
  while (!pedidos.length) await dormir(10);
  const chamadas = f.chamadas;
  r = await pedir(s.porta, '/api/ouvir', {});
  assert.equal(r.status, 409);
  assert.match(json(r).erro, /espere a resposta terminar/);
  soltar();
  await conversa;
  // sem a chave da sessão, nada
  assert.equal((await pedir(s.porta, '/api/ouvir', {}, { token: 'outra-chave-qualquer-123456' })).status, 401);
  assert.equal(f.chamadas, chamadas, 'nem o 409 nem o 401 chegaram a ouvir');
});

test('/api/ouvir: cada erro do Termux vira o caminho para resolver (sem detalhe interno); sem o Termux, a rota não existe', async () => {
  const f = ouvinteFalso({
    respostas: [
      Object.assign(new Error('Please grant'), { permissao: true }),
      Object.assign(new Error('o Termux:API não respondeu'), { prazo: true }),
      new Error('ENOENT /data/data/com.termux/files/segredo'),
    ],
  });
  const s = await subir({ conversar: conversarFalso(null, []), ouvirNoAparelho: f });
  let r = await pedir(s.porta, '/api/ouvir', {});
  assert.equal(r.status, 502);
  assert.equal(json(r).motivo, 'permissao');
  assert.match(json(r).erro, /toque em "Permitir"/);
  r = await pedir(s.porta, '/api/ouvir', {});
  assert.equal(json(r).motivo, 'prazo');
  assert.match(json(r).erro, /Termux:API está instalado/);
  r = await pedir(s.porta, '/api/ouvir', {});
  assert.equal(json(r).motivo, 'falhou');
  assert.ok(!json(r).erro.includes('segredo'), 'o erro interno não vai para a página');
  assert.match(json(r).erro, /pkg install termux-api/);
  // sem o Termux: o histórico diz que não tem e a rota responde 404 com o caminho
  const sem = await subir({ conversar: conversarFalso(null, []), ouvirNoAparelho: null });
  assert.equal(json(await pedir(sem.porta, '/api/historico', {})).ouvirNoAparelho, false);
  r = await pedir(sem.porta, '/api/ouvir', {});
  assert.equal(r.status, 404);
  assert.match(json(r).erro, /Termux:API/);
  // conferir se tem nunca derruba nada, e é conferido uma vez só
  let conferidas = 0;
  const quebra = await subir({ conversar: conversarFalso(null, []), ouvirNoAparelho: ouvinteFalso({ disponivel: () => { conferidas++; throw new Error('sem /proc'); } }) });
  assert.equal(json(await pedir(quebra.porta, '/api/historico', {})).ouvirNoAparelho, false);
  assert.equal((await pedir(quebra.porta, '/api/ouvir', {})).status, 404);
  assert.equal(conferidas, 1);
});

test('lerSaidaDoTermux: vale o último parcial; o pedido de permissão do Termux:API não vira texto', () => {
  assert.deepEqual(site.lerSaidaDoTermux('monta\nmonta o\r\nmonta o treino\n\n'), { texto: 'monta o treino', permissao: false });
  assert.deepEqual(site.lerSaidaDoTermux(''), { texto: '', permissao: false });
  assert.deepEqual(site.lerSaidaDoTermux(null), { texto: '', permissao: false });
  assert.deepEqual(site.lerSaidaDoTermux('Please grant the following permission to use this command: android.permission.RECORD_AUDIO\n'), { texto: '', permissao: true });
  assert.equal(site.erroDeOuvir({ permissao: true }).includes('Termux:API › Permissões › Microfone'), true);
});

const vivo = (pid) => {
  try { return !/^\d+ \(.*\) [ZX]/.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return false; }
};
test('ouvirCom de verdade: o último parcial, o pedido de permissão, o prazo e o cancelar, sem deixar processo órfão', { skip: process.platform !== 'linux' ? 'precisa de /proc' : false, timeout: 30000 }, async () => {
  const dir = fs.mkdtempSync(path.join(HOME, 'termux-falso-'));
  const programa = (nome, corpo) => { const p = path.join(dir, nome); fs.writeFileSync(p, `#!/bin/sh\n${corpo}\n`, { mode: 0o755 }); return p; };
  // os parciais chegam um por linha, cada um com tudo o que ouviu até ali
  assert.equal(await site.ouvirCom(programa('parciais', 'echo monta; echo "monta o treino"; echo "monta o treino de amanhã"')), 'monta o treino de amanhã');
  await assert.rejects(site.ouvirCom(programa('permissao', 'echo "Please grant the following permission to use this command: android.permission.RECORD_AUDIO"')), (e) => e.permissao === true);
  await assert.rejects(site.ouvirCom(programa('falha', 'exit 3')), /código 3/);
  await assert.rejects(site.ouvirCom(path.join(dir, 'nao-existe')), (e) => e.code === 'ENOENT');
  // sem o app Termux:API, o termux-api fica esperando para sempre: o prazo mata o comando E o que ele abriu
  const arquivoPid = path.join(dir, 'pid');
  const inicio = Date.now();
  await assert.rejects(site.ouvirCom(programa('travado', `sleep 30 &\necho $! > "${arquivoPid}"\nwait`), { prazoMs: 400 }), (e) => e.prazo === true);
  assert.ok(Date.now() - inicio < 5000, 'não esperou os 30 s');
  const pid = Number(fs.readFileSync(arquivoPid, 'utf8'));
  const ate = Date.now() + 3000;
  while (vivo(pid) && Date.now() < ate) await dormir(20);
  assert.equal(vivo(pid), false, 'o filho do comando também morreu');
  // cancelar (a página fechou, "Parar")
  const ctrl = new AbortController();
  const ouvindo = site.ouvirCom(programa('espera', 'sleep 30'), { signal: ctrl.signal });
  setTimeout(() => ctrl.abort(), 100);
  await assert.rejects(ouvindo, (e) => e.cancelado === true && !e.prazo);
});

test('o termux-speech-to-text só vale fora das áreas do modelo: um plantado na temporária ou no projeto não roda', { skip: process.platform === 'win32' ? 'só Unix' : false }, () => {
  const antes = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, forcar: process.env.GEMINI_CODE_FORCE_NO_TERMUX_API };
  const plantado = fs.mkdtempSync(path.join(os.tmpdir(), 'plantado-'));
  fs.writeFileSync(path.join(plantado, 'termux-speech-to-text'), '#!/bin/sh\necho oi\n', { mode: 0o755 });
  const repor = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  try {
    delete process.env.GEMINI_CODE_FORCE_NO_TERMUX_API;
    process.env.PATH = `${plantado}${path.delimiter}${antes.PATH}`;
    assert.equal(site.ouvirPadrao().disponivel(), false, 'na temporária (área do modelo): não');
    // a mesma pasta, agora fora das áreas do modelo (a temporária passa a ser outra): vale
    process.env.TMPDIR = fs.mkdtempSync(path.join(HOME, 'outra-tmp-'));
    assert.equal(site.ouvirPadrao().disponivel(), true, 'fora das áreas do modelo: sim');
    process.env.GEMINI_CODE_FORCE_NO_TERMUX_API = '1';
    assert.equal(site.ouvirPadrao().disponivel(), false, 'desligado pelo ambiente');
  } finally {
    repor('PATH', antes.PATH);
    repor('TMPDIR', antes.TMPDIR);
    repor('GEMINI_CODE_FORCE_NO_TERMUX_API', antes.forcar);
  }
});

test('navegador real: o Chrome recusa o microfone e o site ouve pelo Termux, no chat e na esfera; tocar de novo cancela', { skip: pular, timeout: 120000 }, async (t) => {
  const pedidos = [];
  const f = ouvinteFalso({ respostas: ['monta o treino pelo termux', ateCancelar, Object.assign(new Error('x'), { prazo: true }), 'agora na esfera', 'sem reconhecimento no navegador'] });
  const s = await subir({ conversar: conversarFalso(null, pedidos), ouvirNoAparelho: f });
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
  assert.ok(await esperar("document.getElementById('btn-mic').dataset.aparelho === 'true'"), 'o servidor disse que ouve pelo Termux');
  // o Chrome recusa: ouve pelo Termux:API, e a mensagem vai sozinha (e a resposta vem falada, como no ditado)
  await pagina("window.__erroGum = ['NotAllowedError', 'Permission denied']; document.getElementById('btn-mic').click()");
  assert.ok(await nav.esperarTexto('Geral: monta o treino pelo termux', 10000));
  assert.deepEqual(pedidos, [{ nome: null, texto: 'monta o treino pelo termux' }]);
  assert.ok(await esperar("window.__falas.join(' ').includes('Geral: monta o treino pelo termux')"), 'a resposta foi falada');
  assert.equal(await pagina("sessionStorage.getItem('gc-mic-aparelho')"), '1', 'lembrado nesta aba');
  assert.equal(await pagina("document.querySelectorAll('.msg-alerta').length"), 0, 'com o Termux, sem o alarme do Chrome');
  // daqui em diante, direto pelo Termux (sem pedir ao navegador); tocar de novo cancela
  assert.ok(await esperar("!document.getElementById('app').dataset.ocupado"));
  const gum = await pagina('window.__gum');
  await pagina("document.getElementById('btn-mic').click()");
  assert.ok(await esperar("document.getElementById('btn-mic').getAttribute('aria-pressed') === 'true'"), 'ouvindo');
  assert.match(await pagina("document.getElementById('texto').placeholder"), /Ouvindo pelo Termux/);
  assert.equal(await pagina('window.__gum'), gum, 'não pediu ao navegador de novo');
  await pagina("document.getElementById('btn-mic').click()");
  assert.ok(await esperar("document.getElementById('btn-mic').getAttribute('aria-pressed') === 'false'"), 'parou de ouvir');
  assert.ok(await esperar("document.getElementById('texto').placeholder.startsWith('Escreva')"));
  const ate = Date.now() + 5000;
  while (!(f.sinais[1] && f.sinais[1].aborted) && Date.now() < ate) await dormir(20);
  assert.equal(f.sinais[1].aborted, true, 'o servidor encerrou o Termux');
  // o Termux falhou: o caminho para resolver, e na próxima o site tenta o navegador de novo
  await pagina("document.getElementById('btn-mic').click()");
  assert.ok(await nav.esperarTexto('O Termux não ouviu', 10000));
  assert.match(await pagina("document.querySelector('.msg-alerta').textContent"), /Termux:API está instalado/);
  assert.equal(await pagina("sessionStorage.getItem('gc-mic-aparelho')"), null);
  // a esfera: o navegador recusa e ela ouve pelo Termux
  await nav.eEsperar(() => pagina("document.getElementById('btn-modo-voz').click()"));
  assert.ok(await esperar("location.pathname === '/' && document.getElementById('btn-mic').dataset.aparelho === 'true'"));
  await pagina("window.__erroGum = ['NotAllowedError', 'Permission denied']; document.getElementById('btn-mic').click()");
  assert.ok(await esperar("document.getElementById('historico-lista').textContent.includes('Geral: agora na esfera')"), 'a esfera mandou o que o Termux ouviu');
  assert.equal(await pagina("sessionStorage.getItem('gc-mic-aparelho')"), '1');
  // navegador sem reconhecimento de voz (ex.: Firefox): com o Termux, o microfone aparece e ouve por ele
  await pagina("sessionStorage.removeItem('gc-mic-aparelho')");
  await nav.enviar('Page.addScriptToEvaluateOnNewDocument', { source: 'delete window.SpeechRecognition; delete window.webkitSpeechRecognition;' });
  await nav.abrir(s.endereco('/chat'));
  assert.ok(await esperar("!document.getElementById('btn-mic').hidden && document.getElementById('btn-mic').dataset.aparelho === 'true'"), 'o microfone aparece');
  const gum2 = await pagina('window.__gum');
  await pagina("document.getElementById('btn-mic').click()");
  assert.ok(await nav.esperarTexto('Geral: sem reconhecimento no navegador', 10000));
  assert.equal(await pagina('window.__gum'), gum2, 'sem reconhecimento no navegador, nem pede o microfone a ele');
  assert.equal(f.chamadas, 5);
});
