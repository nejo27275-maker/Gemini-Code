// tests/cowork-client.test.js
// handleServerMessage (extraído de src/cowork/client.js) decide o que fazer
// com cada mensagem que chega do servidor cowork — sem precisar de uma
// conexão WebSocket de verdade nem do process.exit/readline reais, que
// aqui são substituídos por callbacks (ver comentário no arquivo).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { handleServerMessage } = require('../src/cowork/client');

function coletor() {
  const logs = [];
  const errors = [];
  const chamadas = [];
  return {
    logs,
    errors,
    chamadas,
    actions: {
      log: (t) => logs.push(t),
      errorLog: (t) => errors.push(t),
      onAutenticado: () => chamadas.push('autenticado'),
      onTokenInvalido: () => chamadas.push('token_invalido'),
      onPromptAgain: () => chamadas.push('prompt_again'),
    },
  };
}

test('JSON inválido só loga um aviso, não quebra nem chama nenhuma action', () => {
  const { errors, chamadas, actions } = coletor();
  assert.doesNotThrow(() => handleServerMessage('{{{ isso não é json', actions));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /mensagem inválida/);
  assert.deepEqual(chamadas, []);
});

test('auth_result com ok:true chama onAutenticado e loga a confirmação', () => {
  const { logs, chamadas, actions } = coletor();
  handleServerMessage(JSON.stringify({ type: 'auth_result', ok: true }), actions);
  assert.deepEqual(chamadas, ['autenticado']);
  assert.match(logs[0], /Autenticado!/);
});

test('auth_result com ok:false chama onTokenInvalido, não onAutenticado', () => {
  const { errors, chamadas, actions } = coletor();
  handleServerMessage(JSON.stringify({ type: 'auth_result', ok: false }), actions);
  assert.deepEqual(chamadas, ['token_invalido']);
  assert.match(errors[0], /Token inválido/);
});

test('status apenas loga, sem chamar nenhuma action', () => {
  const { logs, chamadas, actions } = coletor();
  handleServerMessage(JSON.stringify({ type: 'status', status: 'rodando' }), actions);
  assert.match(logs[0], /\[PC\] rodando/);
  assert.deepEqual(chamadas, []);
});

test('result loga a resposta e chama onPromptAgain', () => {
  const { logs, chamadas, actions } = coletor();
  handleServerMessage(JSON.stringify({ type: 'result', text: 'Brasília' }), actions);
  assert.ok(logs[0].includes('Brasília'));
  assert.deepEqual(chamadas, ['prompt_again']);
});

test('error do servidor loga o erro e também chama onPromptAgain (não trava o prompt)', () => {
  const { errors, chamadas, actions } = coletor();
  handleServerMessage(JSON.stringify({ type: 'error', error: 'deu ruim' }), actions);
  assert.match(errors[0], /deu ruim/);
  assert.deepEqual(chamadas, ['prompt_again']);
});

test('tipo de mensagem desconhecido é ignorado silenciosamente', () => {
  const { logs, errors, chamadas, actions } = coletor();
  assert.doesNotThrow(() => handleServerMessage(JSON.stringify({ type: 'algo_novo_do_futuro' }), actions));
  assert.deepEqual(logs, []);
  assert.deepEqual(errors, []);
  assert.deepEqual(chamadas, []);
});
