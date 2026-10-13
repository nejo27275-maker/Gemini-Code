// tests/mcpProtocol.test.js (v0.3.7)
// Servidor MCP falso (processo node real) que SÓ responde tools/list depois de
// receber notifications/initialized, como servidores que seguem a spec à risca.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { McpConnection, formatarResultado } = require('../src/tools/mcpClient');

const SERVIDOR = `
let ok = false, buf = '';
process.stdin.on('data', (d) => {
  buf += d; let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const l = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!l.trim()) continue;
    const m = JSON.parse(l);
    if (m.method === 'notifications/initialized') { ok = true; continue; }
    if (m.method === 'initialize') send(m.id, { protocolVersion: '2024-11-05', capabilities: {} });
    else if (m.method === 'tools/list') {
      if (!ok) send(m.id, null, { message: 'not initialized' });
      else send(m.id, { tools: [{ name: 'eco', description: 'ecoa', inputSchema: { type: 'object', properties: {} } }] });
    } else if (m.method === 'tools/call') send(m.id, { content: [{ type: 'text', text: 'oi ' + m.params.arguments.x }] });
  }
});
function send(id, result, error) { console.log(JSON.stringify(error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result })); }
`;

test('initialize manda notifications/initialized antes de tools/list', async () => {
  const conn = new McpConnection('fake', { command: process.execPath, args: ['-e', SERVIDOR] });
  conn.start();
  try {
    const tools = await conn.initialize();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, 'eco');
    const res = await conn.callTool('eco', { x: 'mundo' });
    assert.equal(formatarResultado(res), 'oi mundo');
  } finally {
    conn.stop();
  }
});

test('escrever num servidor que já morreu não derruba o processo (EPIPE tratado)', async () => {
  const conn = new McpConnection('morto', { command: process.execPath, args: ['-e', 'process.exit(0)'] });
  conn.start();
  await new Promise((r) => setTimeout(r, 300));
  await assert.rejects(() => conn._send('tools/list', {}, 500));
  conn.stop();
});

test('formatarResultado converte o objeto do MCP em texto legível', () => {
  assert.equal(formatarResultado({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }), 'a\nb');
  assert.match(formatarResultado({ content: [{ type: 'text', text: 'falhou' }], isError: true }), /^Erro reportado pela ferramenta MCP:\nfalhou/);
  assert.match(formatarResultado({ content: [{ type: 'image', mimeType: 'image/png', data: 'xxx' }] }), /imagem image\/png omitida/);
  assert.equal(formatarResultado({ content: [] }), '(sem saída)');
  assert.equal(formatarResultado(null), '(sem resultado)');
  assert.ok(!formatarResultado({ foo: 1 }).includes('[object Object]'));
});
