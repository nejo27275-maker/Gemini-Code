// tests/cowork-server.test.js
// A parte arriscada do cowork server não é o WebSocket em si (isso é o
// pacote "ws" fazendo o trabalho pesado) — é a lógica em volta: comparação
// de token à prova de timing attack, exigir autenticação antes de qualquer
// tarefa, e validar o campo "prompt". `handleMessage` foi extraído
// justamente pra testar essa lógica sem precisar abrir uma porta de rede de
// verdade (ver comentário em src/cowork/server.js).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Isola HOME_DIR (getOrCreateToken grava um arquivo em ~/.gemini-code/)
// antes de qualquer require de src/config, pra não tocar a máquina real.
const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-cowork-test-'));
process.env.HOME = homeDir;
process.env.USERPROFILE = homeDir;

const {
  tokensBatem,
  localIps,
  getOrCreateToken,
  handleMessage,
} = require('../src/cowork/server');

function coletorDeEnvios() {
  const enviados = [];
  return { enviados, send: (obj) => enviados.push(obj) };
}

test('tokensBatem aceita o token certo e rejeita qualquer outro', () => {
  assert.equal(tokensBatem('abc123', 'abc123'), true);
  assert.equal(tokensBatem('abc124', 'abc123'), false);
  assert.equal(tokensBatem('', 'abc123'), false);
});

test('tokensBatem não quebra com entrada que não é string', () => {
  assert.equal(tokensBatem(undefined, 'abc123'), false);
  assert.equal(tokensBatem(42, 'abc123'), false);
  assert.equal(tokensBatem(null, 'abc123'), false);
  assert.equal(tokensBatem({}, 'abc123'), false);
});

test('localIps devolve uma lista (vazia ou não) sem quebrar', () => {
  const ips = localIps();
  assert.ok(Array.isArray(ips));
  for (const ip of ips) assert.equal(typeof ip, 'string');
});

test('getOrCreateToken cria um token na primeira vez e reaproveita depois', () => {
  const a = getOrCreateToken();
  const b = getOrCreateToken();
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{32}$/);
});

test('handleMessage: JSON inválido responde com erro, sem derrubar a conexão', async () => {
  const { enviados, send } = coletorDeEnvios();
  await handleMessage('isto não é json{{{', { authed: false, history: [] }, { token: 'tok', send });
  assert.deepEqual(enviados, [{ type: 'error', error: 'JSON inválido' }]);
});

test('handleMessage: auth com token certo autentica', async () => {
  const { enviados, send } = coletorDeEnvios();
  const connState = { authed: false, history: [] };
  await handleMessage(JSON.stringify({ type: 'auth', token: 'tok-certo' }), connState, { token: 'tok-certo', send });
  assert.deepEqual(enviados, [{ type: 'auth_result', ok: true }]);
  assert.equal(connState.authed, true);
});

test('handleMessage: auth com token errado não autentica', async () => {
  const { enviados, send } = coletorDeEnvios();
  const connState = { authed: false, history: [] };
  await handleMessage(JSON.stringify({ type: 'auth', token: 'chute' }), connState, { token: 'tok-certo', send });
  assert.deepEqual(enviados, [{ type: 'auth_result', ok: false }]);
  assert.equal(connState.authed, false);
});

test('handleMessage: rejeita "task" antes de autenticar', async () => {
  const { enviados, send } = coletorDeEnvios();
  const connState = { authed: false, history: [] };
  await handleMessage(JSON.stringify({ type: 'task', prompt: 'faça algo' }), connState, { token: 'tok', send });
  assert.deepEqual(enviados, [{ type: 'error', error: 'Não autenticado. Envie {type:"auth", token}.' }]);
});

test('handleMessage: rejeita "reset" antes de autenticar', async () => {
  const { enviados, send } = coletorDeEnvios();
  const connState = { authed: false, history: ['algo'] };
  await handleMessage(JSON.stringify({ type: 'reset' }), connState, { token: 'tok', send });
  assert.deepEqual(enviados, [{ type: 'error', error: 'Não autenticado. Envie {type:"auth", token}.' }]);
  assert.deepEqual(connState.history, ['algo']);
});

test('handleMessage: já autenticado, "reset" zera o histórico', async () => {
  const { enviados, send } = coletorDeEnvios();
  const connState = { authed: true, history: ['a', 'b'] };
  await handleMessage(JSON.stringify({ type: 'reset' }), connState, { token: 'tok', send });
  assert.deepEqual(enviados, [{ type: 'reset_ok' }]);
  assert.deepEqual(connState.history, []);
});

test('handleMessage: "task" sem prompt (ou vazio) é rejeitada antes de chamar o agente', async () => {
  let runOnceChamado = false;
  const runOnceFake = async () => { runOnceChamado = true; return { text: '', history: [] }; };

  for (const prompt of [undefined, '', '   ', 42, {}]) {
    const { enviados, send } = coletorDeEnvios();
    const connState = { authed: true, history: [] };
    await handleMessage(JSON.stringify({ type: 'task', prompt }), connState, { token: 'tok', send, runOnceFn: runOnceFake });
    assert.deepEqual(enviados, [{ type: 'error', error: 'Campo "prompt" ausente ou vazio na tarefa.' }]);
  }
  assert.equal(runOnceChamado, false);
});

test('handleMessage: "task" válida chama o agente e devolve status + resultado, atualizando o histórico', async () => {
  const runOnceFake = async (prompt, { history }) => {
    assert.equal(prompt, 'qual a capital do Brasil?');
    assert.deepEqual(history, []);
    return { text: 'Brasília', history: [{ role: 'user', parts: [{ text: prompt }] }] };
  };
  const { enviados, send } = coletorDeEnvios();
  const connState = { authed: true, history: [] };

  await handleMessage(
    JSON.stringify({ type: 'task', prompt: 'qual a capital do Brasil?' }),
    connState,
    { token: 'tok', send, runOnceFn: runOnceFake }
  );

  assert.deepEqual(enviados, [
    { type: 'status', status: 'rodando' },
    { type: 'result', text: 'Brasília' },
  ]);
  assert.equal(connState.history.length, 1);
});

test('handleMessage: erro do agente numa "task" vira mensagem de erro pro cliente', async () => {
  const runOnceFake = async () => { throw new Error('sem API key'); };
  const { enviados, send } = coletorDeEnvios();
  const connState = { authed: true, history: [] };

  await handleMessage(
    JSON.stringify({ type: 'task', prompt: 'oi' }),
    connState,
    { token: 'tok', send, runOnceFn: runOnceFake }
  );

  assert.deepEqual(enviados, [
    { type: 'status', status: 'rodando' },
    { type: 'error', error: 'sem API key' },
  ]);
});

test('handleMessage: segunda tarefa reaproveita o histórico da primeira', async () => {
  const historicosRecebidos = [];
  const runOnceFake = async (prompt, { history }) => {
    historicosRecebidos.push(history);
    return { text: 'ok', history: [...history, { role: 'user', parts: [{ text: prompt }] }] };
  };
  const connState = { authed: true, history: [] };

  await handleMessage(JSON.stringify({ type: 'task', prompt: 'primeira' }), connState, { token: 'tok', send: () => {}, runOnceFn: runOnceFake });
  await handleMessage(JSON.stringify({ type: 'task', prompt: 'segunda' }), connState, { token: 'tok', send: () => {}, runOnceFn: runOnceFake });

  assert.deepEqual(historicosRecebidos[0], []);
  assert.equal(historicosRecebidos[1].length, 1);
});
