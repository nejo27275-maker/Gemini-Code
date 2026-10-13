'use strict';
// v0.41.0: MCP remoto (Streamable HTTP). Servidor local segue o protocolo: sessão, versão,
// resposta em JSON e em SSE (com notificação antes da resposta), token no cabeçalho.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const HOME_FALSO = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-mcp-http-'));
process.env.HOME = HOME_FALSO;
process.env.USERPROFILE = HOME_FALSO;

const test = require('node:test');
const assert = require('node:assert/strict');
const mcp = require('../src/tools/mcpClient');
const presets = require('../src/mcpPresets');

const TOKEN = 'token-ficticio-mcp-123';
const eventos = [];
const servidor = http.createServer((req, res) => {
  let corpo = '';
  req.on('data', (d) => { corpo += d; });
  req.on('end', () => {
    eventos.push({ metodo: req.method, headers: req.headers, corpo });
    if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401); return res.end('sem token'); }
    if (req.method === 'DELETE') { res.writeHead(200); return res.end(); }
    const msg = JSON.parse(corpo);
    if (msg.method === 'initialize') {
      res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'sessao-abc' });
      return res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'remoto', version: '1' } } }));
    }
    if (req.headers['mcp-session-id'] !== 'sessao-abc' || req.headers['mcp-protocol-version'] !== '2025-06-18') {
      res.writeHead(400); return res.end('faltou sessão ou versão');
    }
    if (!('id' in msg)) { res.writeHead(202); return res.end(); }
    if (msg.method === 'tools/list') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: {} })}\n\n`);
      return res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'eco', description: 'Repete', inputSchema: { type: 'object', properties: { texto: { type: 'string' } } } }] } })}\n\n`);
    }
    if (msg.method === 'tools/call') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `eco: ${msg.params.arguments.texto}` }] } }));
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'método desconhecido' } }));
  });
});

test.before(() => new Promise((ok) => servidor.listen(0, '127.0.0.1', ok)));
test.after(() => { mcp.stopAll(); return new Promise((ok) => servidor.close(ok)); });
const url = () => `http://127.0.0.1:${servidor.address().port}/mcp`;

test('ponta a ponta: ferramentas do servidor remoto aparecem e funcionam no agente', async () => {
  process.env.TOKEN_MCP_TESTE = TOKEN;
  mcp._testar({ conexoes: null, servidores: () => ({ remoto: { url: url(), headers: { Authorization: 'Bearer ${TOKEN_MCP_TESTE}' } } }) });
  const decl = await mcp.declarationsForGemini();
  assert.deepEqual(decl.map((d) => d.name), ['mcp__remoto__eco']);
  assert.equal(await mcp.execute('mcp__remoto__eco', { texto: 'olá' }), 'eco: olá');
  const init = JSON.parse(eventos[0].corpo);
  assert.equal(init.method, 'initialize');
  assert.match(eventos[0].headers.accept, /text\/event-stream/);
  assert.ok(eventos.some((e) => e.corpo.includes('notifications/initialized')));
  mcp.stopAll();
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(eventos.some((e) => e.metodo === 'DELETE' && e.headers['mcp-session-id'] === 'sessao-abc'), 'encerra a sessão');
});

test('token errado: erro claro apontando o cabeçalho', async () => {
  const c = new mcp.McpHttpConnection('remoto', { url: url(), headers: { Authorization: 'Bearer errado' } });
  c.start();
  await assert.rejects(c.initialize(), /HTTP 401.*headers/);
});

test('URL inválida ou fora de http(s) é recusada', () => {
  assert.throws(() => new mcp.McpHttpConnection('x', { url: 'ftp://exemplo' }).start(), /só http/);
  assert.throws(() => new mcp.McpHttpConnection('x', { url: 'não é url' }).start(), /URL inválida/);
});

test('mcp list/check entendem servidor por URL e nunca mostram o token', () => {
  const arq = path.join(HOME_FALSO, 'mcp.json');
  fs.writeFileSync(arq, JSON.stringify({ mcpServers: { remoto: { url: url(), headers: { Authorization: 'Bearer ${VARIAVEL_QUE_NAO_EXISTE}' } } } }));
  const lista = presets.comando(['list'], { mcpPath: arq, env: {} });
  assert.match(lista, /remoto: http:\/\/127\.0\.0\.1:\d+\/mcp \(cabeçalhos: Authorization\)/);
  assert.doesNotMatch(lista, /Bearer/);
  const check = presets.comando(['check'], { mcpPath: arq, env: {} });
  assert.match(check, /VARIAVEL_QUE_NAO_EXISTE/);
});
