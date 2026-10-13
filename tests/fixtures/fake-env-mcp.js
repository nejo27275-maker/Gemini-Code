// Servidor MCP FALSO (stdio) com uma ferramenta que devolve variáveis de ambiente que ele recebeu.
// Usado para provar que as chaves do próprio gemini-code não vazam para servidores MCP.
'use strict';
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
rl.on('line', (l) => {
  let m; try { m = JSON.parse(l); } catch { return; }
  if (m.method === 'initialize') return send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fake-env', version: '0' } } });
  if (m.method === 'tools/list') return send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'ler_env', description: 'Devolve variáveis', inputSchema: { type: 'object', properties: { nomes: { type: 'array', items: { type: 'string' } } } } }] } });
  if (m.method === 'tools/call') {
    const valores = {};
    for (const n of m.params.arguments.nomes || []) valores[n] = process.env[n] === undefined ? null : process.env[n];
    return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: JSON.stringify(valores) }] } });
  }
});
