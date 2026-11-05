'use strict';
// v0.52.0: o modo site só precisando da chave do Gemini (o pedido da chave na página, conferida e salva sem nunca
// voltar; com a chave, tudo vai direto ao Gemini) e o modo até terminar no site (a página fechada não para o agente,
// a pergunta espera a pessoa voltar, o andamento aparece ao voltar), mais a página de verdade num Chromium.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-sitechave-'));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
delete process.env.GEMINI_API_KEY;

const test = require('node:test');
const assert = require('node:assert/strict');
const site = require('../src/site/servidor');
const prompt = require('../src/ui/prompt');

const TOKEN = 'token-de-teste-chave-1234567890';
// chave fictícia montada em pedaços: o security scan do próprio projeto acusaria o formato de uma chave real
const CHAVE = ['AIza', 'SyChaveDeTeste_1234567890abcdefghi'].join('');
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const fechar = [];
test.afterEach(async () => { while (fechar.length) await fechar.pop()(); });
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

/** Chaves falsas: o que foi salvo, e a validação escolhida pelo teste. */
function chavesFalsas({ configurada = false, protegida = false, validar = async () => true } = {}) {
  const f = { salvas: [], validadas: 0, configurada, protegida };
  f.api = {
    estado: () => ({ configurada: f.configurada, precisa: !f.configurada, protegida: f.protegida }),
    validar: async (c) => { f.validadas++; return validar(c); },
    salvar: (c) => { f.salvas.push(c); f.configurada = true; },
  };
  return f;
}

async function subir(opcoes = {}) {
  const s = site.criarServidorSite({ token: TOKEN, pasta: HOME, ...opcoes });
  await new Promise((r) => s.servidor.listen(0, '127.0.0.1', r));
  fechar.push(() => new Promise((r) => { s.servidor.closeAllConnections?.(); s.servidor.close(r); }));
  return { ...s, porta: s.servidor.address().port };
}
function pedir(porta, caminho, obj, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: porta, method: 'POST', path: caminho, headers: { host: `127.0.0.1:${porta}`, 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...headers } }, (res) => {
      let corpo = '';
      res.on('data', (d) => { corpo += d; });
      res.on('end', () => resolve({ status: res.statusCode, corpo }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(obj));
  });
}
const json = (r) => JSON.parse(r.corpo);
const eventos = (r) => r.corpo.split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('/api/historico diz se falta a chave (sem nunca mostrar a chave) e o padrão do modo até terminar', async () => {
  const f = chavesFalsas();
  const s = await subir({ chaves: f.api, ateTerminarPadrao: () => true });
  const h = json(await pedir(s.porta, '/api/historico', {}));
  assert.deepEqual(h.chave, { configurada: false, precisa: true });
  assert.equal(h.ateTerminarPadrao, true);
  assert.deepEqual(h.perguntas, []);
  f.configurada = true;
  assert.deepEqual(json(await pedir(s.porta, '/api/historico', {})).chave, { configurada: true, precisa: false });
});

test('/api/chave: formato, chave recusada não salva, sem internet salva sem conferir, protegida recusa; nunca volta', async () => {
  let modo = 'ok';
  const f = chavesFalsas({ validar: async () => { if (modo === 'recusa') throw Object.assign(new Error('x'), { recusada: true }); if (modo === 'offline') throw new Error('sem rede'); return true; } });
  const logs = [];
  const s = await subir({ chaves: f.api, log: (m) => logs.push(m) });
  assert.equal((await pedir(s.porta, '/api/chave', { chave: CHAVE }, { authorization: 'Bearer errado' })).status, 401);
  for (const chave of ['', 'curta', 'tem espaço no meio 1234567890', '<script>alert(1)</script>xxxxxxxxxxxx', 123]) {
    assert.equal((await pedir(s.porta, '/api/chave', { chave })).status, 400, String(chave));
  }
  assert.equal(f.validadas, 0, 'formato errado nem vai ao Google');
  modo = 'recusa';
  const recusada = await pedir(s.porta, '/api/chave', { chave: CHAVE });
  assert.equal(recusada.status, 400);
  assert.match(json(recusada).erro, /recusou essa chave/);
  assert.deepEqual(f.salvas, []);
  modo = 'offline';
  const offline = await pedir(s.porta, '/api/chave', { chave: CHAVE });
  assert.deepEqual(json(offline), { ok: true, conferida: false });
  modo = 'ok';
  assert.deepEqual(json(await pedir(s.porta, '/api/chave', { chave: `${CHAVE}x` })), { ok: true, conferida: true });
  assert.deepEqual(f.salvas, [CHAVE, `${CHAVE}x`]);
  const tudo = JSON.stringify([offline.corpo, logs, json(await pedir(s.porta, '/api/historico', {}))]);
  assert.ok(!tudo.includes('AIzaSy'), 'a chave nunca volta para a página nem vai para o log');
  f.protegida = true;
  assert.equal((await pedir(s.porta, '/api/chave', { chave: CHAVE })).status, 409, 'protegida por senha mestra: só pelo terminal');
});

test('/api/chave: no máximo 10 tentativas em 10 minutos (cada uma é uma chamada ao Google)', async () => {
  const f = chavesFalsas({ validar: async () => { throw Object.assign(new Error('x'), { recusada: true }); } });
  const s = await subir({ chaves: f.api });
  for (let i = 0; i < 10; i++) assert.equal((await pedir(s.porta, '/api/chave', { chave: CHAVE })).status, 400);
  assert.equal((await pedir(s.porta, '/api/chave', { chave: CHAVE })).status, 429);
  assert.equal(f.validadas, 10);
});

test('chave de verdade (chavesPadrao): conferida pela lista de modelos, com a chave no cabeçalho; salva no config', async (t) => {
  const pedidos = [];
  const original = global.fetch;
  let status = 200;
  global.fetch = async (url, init) => { pedidos.push({ url: String(url), init }); return new Response('{}', { status }); };
  t.after(() => { global.fetch = original; });
  const c = site.chavesPadrao();
  assert.equal(await c.validar(CHAVE), true);
  assert.equal(pedidos[0].url, 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1');
  assert.equal(pedidos[0].init.headers['x-goog-api-key'], CHAVE);
  assert.equal(pedidos[0].init.redirect, 'error');
  status = 400;
  await assert.rejects(() => c.validar(CHAVE), (e) => e.recusada === true);
  status = 503;
  assert.equal(await c.validar(CHAVE), false, 'Google fora do ar: não deu para conferir');
  assert.equal(c.estado().configurada, false);
  c.salvar(CHAVE);
  assert.equal(c.estado().configurada, true);
  assert.equal(require('../src/config').loadConfig().apiKey, CHAVE);
});

test('com a chave, o site manda tudo direto ao Gemini (sem o modelo local do modo híbrido); quem escolheu outro segue com o dele', async () => {
  assert.equal(site.modeloDoSite({ provider: 'hybrid', apiKey: CHAVE }), '@cloud');
  assert.equal(site.modeloDoSite({ apiKey: CHAVE }), '@cloud', 'o padrão é o híbrido');
  assert.equal(site.modeloDoSite({ provider: 'hybrid', apiKey: '' }), undefined, 'sem chave: o roteador decide');
  for (const provider of ['llamacpp', 'ollama', 'openai', 'gemini', 'code-ia']) assert.equal(site.modeloDoSite({ provider, apiKey: CHAVE }), undefined, provider);
  assert.equal(site.modeloDoSite({ provider: 'hybrid', apiKey: CHAVE, modoSolo: true }), undefined, 'modo solo');
  const chamadas = [];
  const runOnce = async (texto, o) => { chamadas.push(o); return { text: 'ok', history: [] }; };
  const conv = site.conversarComAgente({ runOnce, loadConfig: () => ({ provider: 'hybrid', apiKey: CHAVE }) });
  await conv('oi', { historico: [], onText() {}, onFerramenta() {}, onAlerta() {} });
  assert.equal(chamadas[0].modelName, '@cloud');
  await conv('faz tudo', { historico: [], onText() {}, onFerramenta() {}, onAlerta() {}, ateTerminar: true, onContinuar() {} });
  assert.equal(chamadas[1].ateTerminar, true);
  assert.equal(typeof chamadas[1].onContinuar, 'function');
  const semChave = site.conversarComAgente({ runOnce, loadConfig: () => ({ provider: 'hybrid', apiKey: '' }) });
  await semChave('oi', { historico: [], onText() {}, onFerramenta() {}, onAlerta() {} });
  assert.equal(chamadas[2].modelName, undefined);
});

test('erro de chave na conversa: o evento de erro avisa a página para pedir a chave de novo', async () => {
  const s = await subir({ chaves: chavesFalsas({ configurada: true }).api, conversar: async () => { throw new Error('Nenhuma API key configurada. Rode: gemini-code config set-key SUA_CHAVE'); } });
  const evs = eventos(await pedir(s.porta, '/api/conversa', { texto: 'oi' }));
  const erro = evs.find((e) => e.tipo === 'erro');
  assert.equal(erro.chave, true);
  assert.equal(site.erroDeChave('[Gemini] chave recusada ou sem permissão'), true);
  assert.equal(site.erroDeChave('o modelo está sobrecarregado'), false);
});

test('até terminar no site: o pedido chega ao agente, as continuações viram eventos e a resposta traz o selo', async () => {
  const vistos = [];
  const s = await subir({
    chaves: chavesFalsas({ configurada: true }).api,
    conversar: async (texto, o) => { vistos.push(o); o.onContinuar(1); o.onText('Pronto.'); return { texto: 'Pronto.', historico: [], fim: 'concluida' }; },
  });
  const evs = eventos(await pedir(s.porta, '/api/conversa', { texto: 'faz tudo', ateTerminar: true }));
  assert.equal(vistos[0].ateTerminar, true);
  assert.deepEqual(evs.filter((e) => e.tipo === 'continuando'), [{ tipo: 'continuando', n: 1 }]);
  assert.equal(evs.find((e) => e.tipo === 'resposta').fim, 'concluida');
  await pedir(s.porta, '/api/conversa', { texto: 'normal' });
  assert.equal(vistos[1].ateTerminar, undefined, 'sem o botão, o modo fica desligado');
});

test('até terminar no site: a página fechada NÃO para o agente; ao voltar, o andamento e a pergunta aparecem, e a resposta vale', async () => {
  const sinais = [];
  let liberar;
  const respostas = [];
  const s = await subir({
    chaves: chavesFalsas({ configurada: true }).api,
    prazoPerguntaMs: 100, // fora do modo até terminar a pergunta expiraria logo; aqui ela espera a pessoa
    conversar: async (texto, o) => {
      sinais.push(o.signal);
      o.onFerramenta('video');
      o.onText('Cortando o vídeo... ');
      await new Promise((r) => { liberar = r; });
      respostas.push(await prompt.ask('O agente quer gravar fora do projeto. Permitir? (s/n) '));
      o.onText('feito.');
      return { texto: 'Cortando o vídeo... feito.', historico: [{ role: 'user', parts: [{ text: texto }] }, { role: 'model', parts: [{ text: 'Cortando o vídeo... feito.' }] }], fim: 'concluida' };
    },
  });
  // a página manda e fecha no meio (celular bloqueou a tela)
  await new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: s.porta, method: 'POST', path: '/api/conversa', headers: { host: `127.0.0.1:${s.porta}`, 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` } }, (res) => {
      res.on('data', (d) => { if (String(d).includes('Cortando')) req.destroy(); });
      res.on('error', () => {});
      res.on('close', resolve);
    });
    req.on('error', () => {});
    req.end(JSON.stringify({ texto: 'corta os gols do jogo', ateTerminar: true }));
  });
  await dormir(150);
  assert.equal(sinais[0].aborted, false, 'a página fechou, mas o agente segue');
  let h = json(await pedir(s.porta, '/api/historico', {}));
  assert.equal(h.ocupado, true);
  assert.deepEqual([h.andamento.texto, h.andamento.ferramentas, h.andamento.ateTerminar], ['Cortando o vídeo... ', ['video'], true]);
  liberar();
  for (let i = 0; i < 40 && !h.perguntas.length; i++) { await dormir(25); h = json(await pedir(s.porta, '/api/historico', {})); }
  assert.equal(h.perguntas.length, 1, 'a pergunta espera a pessoa voltar');
  assert.match(h.perguntas[0].texto, /gravar fora do projeto/);
  await dormir(200);
  assert.equal(json(await pedir(s.porta, '/api/historico', {})).perguntas.length, 1, 'não expirou no prazo curto');
  assert.equal((await pedir(s.porta, '/api/confirmar', { id: h.perguntas[0].id, resposta: 's' })).status, 200);
  for (let i = 0; i < 40 && json(await pedir(s.porta, '/api/historico', {})).ocupado; i++) await dormir(25);
  assert.deepEqual(respostas, ['s']);
  const fim = json(await pedir(s.porta, '/api/historico', {}));
  assert.equal(fim.ocupado, false);
  assert.equal(fim.andamento, undefined);
  assert.deepEqual(fim.mensagens.map((m) => m.texto), ['corta os gols do jogo', 'Cortando o vídeo... feito.']);
});

test('fora do modo até terminar, a página fechada continua parando o agente (como antes)', async () => {
  const sinais = [];
  const s = await subir({
    chaves: chavesFalsas({ configurada: true }).api,
    conversar: async (texto, o) => { sinais.push(o.signal); o.onText('x'); await new Promise((r) => o.signal.addEventListener('abort', r, { once: true })); return { texto: '(interrompido por você)', historico: [], interrompido: true }; },
  });
  await new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: s.porta, method: 'POST', path: '/api/conversa', headers: { host: `127.0.0.1:${s.porta}`, 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` } }, (res) => {
      res.on('data', () => req.destroy());
      res.on('error', () => {});
      res.on('close', resolve);
    });
    req.on('error', () => {});
    req.end(JSON.stringify({ texto: 'longa' }));
  });
  for (let i = 0; i < 40 && !(sinais[0] && sinais[0].aborted); i++) await dormir(25);
  assert.equal(sinais[0].aborted, true);
});

test('histórico: a mensagem automática do modo até terminar não aparece como fala sua', () => {
  const agent = require('../src/agent');
  const m = site.paraExibicao([
    { role: 'user', parts: [{ text: 'faz o relatório' }] }, { role: 'model', parts: [{ text: 'Comecei.' }] },
    { role: 'user', parts: [{ text: agent.CONTINUAR_ATE_TERMINAR }] }, { role: 'model', parts: [{ text: 'Terminei.' }] },
  ]);
  assert.deepEqual(m, [{ quem: 'voce', texto: 'faz o relatório' }, { quem: 'agente', texto: 'Comecei.\n\nTerminei.' }]);
});

// ---------------------------------------------------------------------------
// A página de verdade
// ---------------------------------------------------------------------------
const { Navegador, acharNavegador } = require('../src/navegador');
const pular = acharNavegador() ? false : 'nenhum Chrome/Chromium instalado';

test('sugestões do aliado: limpas, curtas, no máximo 4, no lugar das da página; sem aliado, nada muda', async () => {
  const RLO = String.fromCodePoint(0x202e);
  const s = await subir({ chaves: chavesFalsas({ configurada: true }).api, sugestoes: [`Monta o ${RLO}treino`, '  ', 'x'.repeat(300), 'Planeja\n a semana', 'd', 'e'] });
  assert.deepEqual(json(await pedir(s.porta, '/api/historico', {})).sugestoes, ['Monta o treino', 'x'.repeat(160), 'Planeja a semana', 'd']);
  const sem = await subir({ chaves: chavesFalsas({ configurada: true }).api });
  assert.equal(json(await pedir(sem.porta, '/api/historico', {})).sugestoes, undefined);
});

test('navegador real: a página pede a chave, salva sem mostrá-la, e o botão "Até terminar" manda o modo; o selo aparece', { skip: pular, timeout: 90000 }, async (t) => {
  const f = chavesFalsas();
  const pedidos = [];
  const s = await subir({
    sugestoes: ['Monta o treino de amanhã', 'Desenha o 4-3-3'],
    chaves: f.api,
    conversar: async (texto, o) => {
      pedidos.push({ texto, ateTerminar: o.ateTerminar === true });
      o.onContinuar(1);
      o.onText('Plano pronto.');
      return { texto: 'Plano pronto.', historico: [{ role: 'user', parts: [{ text: texto }] }, { role: 'model', parts: [{ text: 'Plano pronto.' }] }], fim: 'concluida' };
    },
  });
  const nav = new Navegador({ executavel: acharNavegador(), permitirLocal: true, navegacaoBarrada: () => null });
  await nav.iniciar();
  t.after(() => nav.fechar());
  await nav.abrir(s.endereco('/chat'));
  assert.ok(await nav.esperarTexto('Falta só a chave da API do Gemini', 10000), 'a página pediu a chave');
  await nav.avaliar(`(() => { const c = document.querySelector('.chave-campo'); c.value = ${JSON.stringify(CHAVE)}; document.querySelector('.chave button[type=submit]').click(); })()`);
  assert.ok(await nav.esperarTexto('Chave conferida e salva', 10000));
  assert.deepEqual(f.salvas, [CHAVE]);
  assert.equal(await nav.avaliar("document.querySelector('.chave-campo') ? document.querySelector('.chave-campo').value : ''"), '', 'o campo se esvaziou');
  assert.ok(!(await nav.avaliar('document.body.innerText')).includes('AIzaSy'), 'a chave não aparece na página');
  assert.deepEqual(await nav.avaliar("[...document.querySelectorAll('.sugestao')].map((b) => b.textContent)"), ['Monta o treino de amanhã', 'Desenha o 4-3-3'], 'as sugestões do aliado');
  await nav.avaliar("document.getElementById('btn-ate').click()");
  assert.equal(await nav.avaliar("document.getElementById('btn-ate').getAttribute('aria-pressed')"), 'true');
  await nav.avaliar("document.getElementById('texto').value = 'monta o treino da semana'; document.getElementById('btn-enviar').click()");
  assert.ok(await nav.esperarTexto('Tarefa concluída', 10000), 'o selo do fim apareceu');
  assert.deepEqual(pedidos, [{ texto: 'monta o treino da semana', ateTerminar: true }]);
  // recarregar: o botão continua ligado nesta aba
  await nav.abrir(`http://127.0.0.1:${s.porta}/chat`);
  assert.ok(await nav.esperarTexto('Plano pronto', 10000));
  assert.equal(await nav.avaliar("document.getElementById('btn-ate').getAttribute('aria-pressed')"), 'true');
});
