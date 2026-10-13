// Servidor MCP FALSO (stdio) que imita o formato do Roblox Studio, só para testar o cliente do gemini-code.
'use strict';
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const cena = { Workspace: ['SpawnLocation', 'Fase1'], ServerScriptService: [] };
rl.on('line', (l) => {
  let m; try { m = JSON.parse(l); } catch { return; }
  if (m.method === 'initialize') { const d = Number(process.env.FAKE_DELAY_MS) || 0; return setTimeout(() => send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fake-roblox', version: '0' } } }), d); }
  if (m.method === 'tools/list') return send({ jsonrpc: '2.0', id: m.id, result: { tools: [
    { name: 'get_data_model', description: 'Lê a árvore do jogo', inputSchema: { type: 'object', properties: {} } },
    { name: 'execute_luau', description: 'Roda Luau no Studio', inputSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] } },
  ] } });
  if (m.method === 'tools/call') {
    const { name, arguments: a } = m.params;
    if (name === 'get_data_model') return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: JSON.stringify(cena) }] } });
    if (name === 'execute_luau') { cena.ServerScriptService.push('Script'); return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: `executado: ${a.code}` }] } }); }
    return send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `ferramenta desconhecida: ${name}` } });
  }
});
