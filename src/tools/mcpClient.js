// src/tools/mcpClient.js
// Cliente MCP (Model Context Protocol) minimalista, via stdio.
// Lê servidores definidos em ~/.gemini-code/mcp.json, no mesmo formato
// usado por Claude Desktop / Claude Code:
// { "mcpServers": { "nome": { "command": "npx", "args": [...] } } }
'use strict';

const { spawn } = require('child_process');
const { loadMcpServers } = require('../config');

class McpConnection {
  constructor(name, cfg) {
    this.name = name;
    this.cfg = cfg;
    this.proc = null;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.tools = [];
  }

  start() {
    this.proc = spawn(this.cfg.command, this.cfg.args || [], {
      env: { ...process.env, ...(this.cfg.env || {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc.stdout.on('data', (chunk) => this._onData(chunk));
    this.proc.stderr.on('data', () => {}); // logs do servidor MCP são ignorados aqui
    // Se o processo do servidor morrer ou nem conseguir iniciar, destrava
    // qualquer chamada que estivesse esperando resposta dele.
    this.proc.on('error', (err) => this._rejectAllPending(err));
    this.proc.on('exit', (code) => {
      this._rejectAllPending(new Error(`Servidor MCP "${this.name}" encerrou inesperadamente (código ${code}).`));
    });
  }

  _rejectAllPending(err) {
    for (const { reject } of this.pending.values()) reject(err);
    this.pending.clear();
  }

  _onData(chunk) {
    this.buffer += chunk.toString('utf8');
    let idx;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // linha não-JSON (log do servidor), ignora
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        // Antes, uma resposta JSON-RPC de erro era resolvida como se fosse
        // sucesso e o erro passava batido; agora rejeita de verdade.
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg);
      }
    }
  }

  _send(method, params, timeoutMs = 20000) {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    return new Promise((resolve, reject) => {
      // Antes não havia timeout: se o servidor MCP nunca respondesse, essa
      // promise ficava pendurada pra sempre e travava o agente inteiro.
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Tempo esgotado (${timeoutMs}ms) esperando resposta de "${this.name}" para "${method}".`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (msg) => { clearTimeout(timer); resolve(msg); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });
      this.proc.stdin.write(payload);
    });
  }

  async initialize() {
    await this._send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'gemini-code', version: '0.1.0' },
    });
    const listed = await this._send('tools/list', {});
    this.tools = (listed && listed.result && listed.result.tools) || [];
    return this.tools;
  }

  async callTool(toolName, args) {
    const res = await this._send('tools/call', { name: toolName, arguments: args });
    return res && res.result;
  }

  stop() {
    if (this.proc) this.proc.kill();
  }
}

let connections = null;

async function loadAllMcpTools() {
  if (connections) return connections;
  connections = {};
  const servers = loadMcpServers();
  for (const [name, cfg] of Object.entries(servers)) {
    const conn = new McpConnection(name, cfg);
    try {
      conn.start();
      await conn.initialize();
      connections[name] = conn;
    } catch (err) {
      console.error(`[mcp] falha ao iniciar "${name}": ${err.message}`);
      // Se initialize() falhou (timeout, erro etc.), o processo do servidor
      // pode ter ficado rodando (ex.: um "sleep" ou servidor travado) sem
      // que ninguém mais tenha referência pra matá-lo depois — isso sozinho
      // já era o suficiente pra impedir o Node de encerrar no final.
      conn.stop();
    }
  }
  return connections;
}

/** Devolve as ferramentas de todos os servidores MCP no formato do Gemini. */
async function declarationsForGemini() {
  const conns = await loadAllMcpTools();
  const decls = [];
  for (const [serverName, conn] of Object.entries(conns)) {
    for (const tool of conn.tools) {
      decls.push({
        name: `mcp__${serverName}__${tool.name}`,
        description: tool.description || `Ferramenta MCP ${tool.name} de ${serverName}`,
        parameters: tool.inputSchema || { type: 'object', properties: {} },
      });
    }
  }
  return decls;
}

async function execute(fullName, args) {
  const [, serverName, ...rest] = fullName.split('__');
  const toolName = rest.join('__');
  const conns = await loadAllMcpTools();
  const conn = conns[serverName];
  if (!conn) throw new Error(`Servidor MCP não encontrado: ${serverName}`);
  return conn.callTool(toolName, args);
}

function stopAll() {
  if (!connections) return;
  Object.values(connections).forEach((c) => c.stop());
}

module.exports = { declarationsForGemini, execute, stopAll };
