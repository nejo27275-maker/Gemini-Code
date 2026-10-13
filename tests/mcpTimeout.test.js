// tests/mcpTimeout.test.js
// _send() deve rejeitar sozinho se o servidor MCP nunca responder, em vez de
// deixar a promise pendurada pra sempre (ver comentário em mcpClient.js).
// Usamos um processo real (node -e) que só mantém o stdin aberto e nunca
// escreve nada no stdout — simula um servidor MCP travado/quieto.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { McpConnection } = require('../src/tools/mcpClient');

test('_send rejeita com timeout quando o servidor não responde', async () => {
  const conn = new McpConnection('servidor-mudo', {
    command: process.execPath, // o próprio node
    args: ['-e', 'process.stdin.resume();'], // só fica vivo, nunca escreve nada
  });
  conn.start();
  try {
    await assert.rejects(
      () => conn._send('tools/list', {}, 200), // timeout curto só pro teste
      /Tempo esgotado/
    );
  } finally {
    conn.stop();
  }
});

test('_send limpa a entrada de "pending" depois do timeout (não vaza memória)', async () => {
  const conn = new McpConnection('servidor-mudo-2', {
    command: process.execPath,
    args: ['-e', 'process.stdin.resume();'],
  });
  conn.start();
  try {
    await assert.rejects(() => conn._send('tools/list', {}, 150));
    assert.equal(conn.pending.size, 0);
  } finally {
    conn.stop();
  }
});
