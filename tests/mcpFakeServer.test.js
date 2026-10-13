'use strict';
// v0.35.0: teste de ponta a ponta do cliente MCP contra um servidor stdio de verdade (falso, estilo Roblox):
// processo real, JSON-RPC real, declarações para o Gemini, confirmação s/n e erro do servidor.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const mcpClient = require('../src/tools/mcpClient');

const SERVIDOR = path.join(__dirname, 'fixtures', 'fake-roblox-mcp.js');
const novaConexao = (cfg = {}) => new mcpClient.McpConnection('roblox', { command: process.execPath, args: [SERVIDOR], ...cfg });

test('conecta, faz initialize e lista as ferramentas do servidor', async () => {
  const c = novaConexao(); c.start();
  try {
    const tools = await c.initialize();
    assert.deepEqual(tools.map((t) => t.name), ['get_data_model', 'execute_luau']);
  } finally { c.stop(); }
});

test('declarationsForGemini + execute: nome mcp__roblox__*, resultado em texto, e confirmação do execute', async () => {
  const c = novaConexao({ confirmar: ['execute'] }); c.start(); await c.initialize();
  const perguntas = []; let resposta = 'n';
  mcpClient._testar({ conexoes: { roblox: c }, ask: async (q) => { perguntas.push(q); return resposta; } });
  try {
    const decls = await mcpClient.declarationsForGemini();
    assert.deepEqual(decls.map((d) => d.name), ['mcp__roblox__get_data_model', 'mcp__roblox__execute_luau']);

    // leitura: roda direto, sem perguntar
    assert.match(await mcpClient.execute('mcp__roblox__get_data_model', {}), /SpawnLocation/);
    assert.equal(perguntas.length, 0);

    // execução de código: recusada
    assert.match(await mcpClient.execute('mcp__roblox__execute_luau', { code: 'print(1)' }), /cancelada/);
    assert.equal(perguntas.length, 1);
    assert.match(perguntas[0], /execute_luau/);
    assert.doesNotMatch(await mcpClient.execute('mcp__roblox__get_data_model', {}), /"ServerScriptService":\["Script"\]/);

    // aceita: o servidor executa e o estado muda
    resposta = 's';
    assert.equal(await mcpClient.execute('mcp__roblox__execute_luau', { code: 'print(2)' }), 'executado: print(2)');
    assert.match(await mcpClient.execute('mcp__roblox__get_data_model', {}), /"ServerScriptService":\["Script"\]/);
  } finally { c.stop(); mcpClient._testar({ conexoes: null }); }
});

test('erro JSON-RPC do servidor vira exceção legível; servidor que morre destrava a chamada', async () => {
  const c = novaConexao(); c.start(); await c.initialize();
  await assert.rejects(() => c.callTool('nao_existe', {}), /ferramenta desconhecida/);
  c.proc.kill();
  await assert.rejects(() => c.callTool('get_data_model', {}), /encerrou|EPIPE|write after end|destroyed/i);
  c.stop();
});

// ---- v0.36.0: subida em paralelo e servidor desligado ----
test('servidores sobem em paralelo (3 x 400 ms em bem menos que 1200 ms) e falha de um não derruba os outros', async () => {
  const com = (extra) => ({ command: process.execPath, args: [SERVIDOR], env: { FAKE_DELAY_MS: '400' }, ...extra });
  mcpClient._testar({ conexoes: null, servidores: () => ({ a: com(), b: com(), c: com(), quebrado: { command: '/nao/existe/xyz', args: [] } }) });
  const t0 = Date.now();
  const origErr = console.error; console.error = () => {};
  let conns;
  try { conns = await mcpClient.declarationsForGemini(); } finally { console.error = origErr; }
  const ms = Date.now() - t0;
  try {
    assert.ok(ms < 1100, `demorou ${ms} ms (sequencial seria >= 1200)`);
    assert.deepEqual(conns.map((d) => d.name).filter((n) => n.endsWith('get_data_model')).sort(), ['mcp__a__get_data_model', 'mcp__b__get_data_model', 'mcp__c__get_data_model']);
  } finally { mcpClient.stopAll(); mcpClient._testar({ conexoes: null }); }
});

test('"desativado": true não sobe o servidor nem entra nas declarações', async () => {
  mcpClient._testar({ conexoes: null, servidores: () => ({ ligado: { command: process.execPath, args: [SERVIDOR] }, off: { command: process.execPath, args: [SERVIDOR], desativado: true } }) });
  try {
    const nomes = (await mcpClient.declarationsForGemini()).map((d) => d.name);
    assert.ok(nomes.every((n) => n.startsWith('mcp__ligado__')) && nomes.length === 2);
  } finally { mcpClient.stopAll(); mcpClient._testar({ conexoes: null }); }
});
