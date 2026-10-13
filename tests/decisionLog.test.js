// tests/decisionLog.test.js
// logAcao() grava cada chamada de ferramenta em JSON Lines — ver comentário
// em src/decisionLog.js.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { logAcao, LOG_PATH } = require('../src/decisionLog');

function ultimaLinha() {
  const conteudo = fs.readFileSync(LOG_PATH, 'utf8').trim().split('\n');
  return JSON.parse(conteudo[conteudo.length - 1]);
}

test('grava tool, args e resultado numa linha JSON válida', () => {
  logAcao({ tool: 'read_file', args: { path: 'x.txt' }, resultado: 'conteúdo' });
  const entrada = ultimaLinha();
  assert.equal(entrada.tool, 'read_file');
  assert.match(entrada.args, /x\.txt/);
  assert.match(entrada.resultado, /conteúdo/);
  assert.ok(entrada.ts);
});

test('grava o campo erro em vez de resultado quando a ferramenta falha', () => {
  logAcao({ tool: 'run_shell', args: { command: 'x' }, erro: 'algo quebrou' });
  const entrada = ultimaLinha();
  assert.equal(entrada.tool, 'run_shell');
  assert.match(entrada.erro, /algo quebrou/);
  assert.equal(entrada.resultado, undefined);
});

test('trunca campos muito longos em vez de gravar tudo', () => {
  const grande = 'x'.repeat(1000);
  logAcao({ tool: 'write_file', args: {}, resultado: grande });
  const entrada = ultimaLinha();
  assert.ok(entrada.resultado.length < 1000);
  assert.match(entrada.resultado, /\+\d+ chars/);
});

test('não lança mesmo se chamado com dados inesperados', () => {
  assert.doesNotThrow(() => logAcao({ tool: 'x', args: undefined, resultado: undefined }));
});
