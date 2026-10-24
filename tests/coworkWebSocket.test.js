'use strict';
// v0.43.3: cowork de ponta a ponta com WebSocket DE VERDADE (servidor ws numa porta local + cliente ws), sem
// modelo (runOnceFn falso). Precisa do pacote "ws" (dependência do projeto, instalada por `npm ci` no CI);
// sem ele, os testes são pulados com o motivo. tests/coworkCifrado.test.js cobre o protocolo e as conexões
// com uma rede em memória; aqui se confere o transporte: aperto de mão, cifra no fio, códigos de fechamento,
// HTTP 429/503 antes do upgrade, teto de tamanho de mensagem e porta ocupada.
const fs = require('fs');
const os = require('os');
const path = require('path');
const HOME_FALSO = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-cowork-ws-'));
process.env.HOME = HOME_FALSO;
process.env.USERPROFILE = HOME_FALSO;

const test = require('node:test');
const assert = require('node:assert/strict');

let WebSocket = null;
try { WebSocket = require('ws'); } catch { /* sem o pacote: pula */ }
const pular = WebSocket ? false : 'pacote "ws" não instalado (rode npm install; o CI instala)';

const server = WebSocket ? require('../src/cowork/server') : null;
const client = WebSocket ? require('../src/cowork/client') : null;

function subir({ runOnceFn } = {}) {
  const wss = server.startServer(0, { host: '127.0.0.1', log: () => {}, runOnceFn: runOnceFn || (async (p, { history }) => ({ text: `eco: ${p}`, history: [...history, p] })) });
  return new Promise((ok) => wss.on('listening', () => ok({ wss, url: `ws://127.0.0.1:${wss.address().port}` })));
}

/** Cliente real; resolve quando autentica, fecha ou é recusado antes do upgrade. Guarda cada quadro bruto. */
function conectar(url, token, { capturar = [] } = {}) {
  return new Promise((ok) => {
    const ws = new WebSocket(url, { perMessageDeflate: false });
    const ev = { autenticado: false, invalido: false, logs: [], erros: [], fechou: null, http: null };
    let pronto = null;
    const conn = client.criarConexaoCliente({
      token,
      enviar: (o) => { const q = JSON.stringify(o); capturar.push(q); ws.send(q); },
      fechar: () => ws.close(),
      acoes: {
        log: (t) => { ev.logs.push(t); if (pronto) pronto(); },
        errorLog: (t) => { ev.erros.push(t); if (pronto) pronto(); },
        onAutenticado: () => { ev.autenticado = true; ok({ ws, conn, ev, aguardar: () => new Promise((r) => { pronto = r; }) }); },
        onTokenInvalido: () => { ev.invalido = true; },
        onPromptAgain: () => {},
      },
    });
    ws.on('message', (raw) => { capturar.push(String(raw)); conn.aoReceber(raw); });
    ws.on('close', (codigo) => { ev.fechou = codigo; ok({ ws, conn, ev }); });
    ws.on('unexpected-response', (req, res) => { ev.http = res.statusCode; ok({ ws, conn, ev }); });
    ws.on('error', () => {});
  });
}

const TOKEN = () => server.getOrCreateToken();

test('tarefa vai e volta pelo WebSocket real; no fio não aparece o token nem o texto', { skip: pular }, async (t) => {
  const { wss, url } = await subir();
  t.after(() => new Promise((ok) => wss.close(ok)));
  const fio = [];
  const c = await conectar(url, TOKEN(), { capturar: fio });
  assert.equal(c.ev.autenticado, true);
  const chegou = c.aguardar();
  c.conn.enviarTarefa('TAREFA-SECRETA leia ~/.ssh');
  await chegou;
  // "status: rodando" e o resultado chegam cifrados; espera o resultado
  while (!c.ev.logs.some((l) => l.includes('eco: TAREFA-SECRETA'))) await c.aguardar();
  const tudo = fio.join('\n');
  for (const segredo of [TOKEN(), 'TAREFA-SECRETA', 'eco:', 'rodando']) assert.ok(!tudo.includes(segredo), `apareceu no fio: ${segredo}`);
  c.ws.close();
});

test('token errado fecha com 4401; na 6ª tentativa do mesmo IP o servidor recusa antes do upgrade (HTTP 429)', { skip: pular }, async (t) => {
  const { wss, url } = await subir();
  t.after(() => new Promise((ok) => wss.close(ok)));
  for (let i = 0; i < server.FALHAS_POR_IP; i++) {
    const r = await conectar(url, 'f'.repeat(32));
    assert.equal(r.ev.fechou, 4401);
    assert.equal(r.ev.invalido, true);
  }
  assert.equal((await conectar(url, 'f'.repeat(32))).ev.http, 429);
  assert.equal((await conectar(url, TOKEN())).ev.http, 429, 'durante o bloqueio, nem o token certo entra por este IP');
});

test('cliente antigo (token aberto) recebe o aviso para atualizar e é desconectado', { skip: pular }, async (t) => {
  const { wss, url } = await subir();
  t.after(() => new Promise((ok) => wss.close(ok)));
  const recebido = await new Promise((ok) => {
    const ws = new WebSocket(url);
    const msgs = [];
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: TOKEN() })));
    ws.on('message', (m) => msgs.push(JSON.parse(String(m))));
    ws.on('close', (codigo) => ok({ codigo, msgs }));
  });
  assert.equal(recebido.codigo, 4401);
  assert.match(recebido.msgs.find((m) => m.type === 'auth_result').error, /Atualize o gemini-code do celular/);
});

test('mensagem maior que 1 MiB é recusada pelo transporte (1009) antes de chegar ao protocolo', { skip: pular }, async (t) => {
  const { wss, url } = await subir();
  t.after(() => new Promise((ok) => wss.close(ok)));
  const codigo = await new Promise((ok) => {
    const ws = new WebSocket(url);
    ws.on('open', () => ws.send('x'.repeat(server.MAX_PAYLOAD_BYTES + 1)));
    ws.on('close', (c) => ok(c));
    ws.on('error', () => {});
  });
  assert.equal(codigo, 1009);
});

test('teto de conexões: a 9ª conexão recebe HTTP 503', { skip: pular }, async (t) => {
  const { wss, url } = await subir();
  const abertas = [];
  t.after(async () => { for (const ws of abertas) ws.terminate(); await new Promise((ok) => wss.close(ok)); });
  for (let i = 0; i < server.MAX_CONEXOES; i++) {
    abertas.push(await new Promise((ok) => { const ws = new WebSocket(url); ws.on('open', () => ok(ws)); ws.on('error', () => {}); }));
  }
  const http = await new Promise((ok) => {
    const ws = new WebSocket(url);
    ws.on('unexpected-response', (req, res) => ok(res.statusCode));
    ws.on('open', () => ok('abriu'));
    ws.on('error', () => {});
  });
  assert.equal(http, 503);
});

test('porta ocupada: mensagem clara em vez de derrubar o processo', { skip: pular }, async (t) => {
  const { wss } = await subir();
  t.after(() => new Promise((ok) => wss.close(ok)));
  const erros = [];
  const original = console.error;
  console.error = (m) => erros.push(m);
  const exitAntes = process.exitCode;
  try {
    const outro = server.startServer(wss.address().port, { host: '127.0.0.1', log: () => {} });
    await new Promise((ok) => outro.on('error', () => setImmediate(ok)));
  } finally {
    console.error = original;
    process.exitCode = exitAntes;
  }
  assert.match(erros.join('\n'), /já está em uso/);
});
