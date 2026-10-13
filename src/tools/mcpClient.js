// src/tools/mcpClient.js
// Cliente MCP (Model Context Protocol) minimalista, via stdio.
// Lê servidores definidos em ~/.gemini-code/mcp.json, no mesmo formato
// usado por Claude Desktop / Claude Code:
// { "mcpServers": { "nome": { "command": "npx", "args": [...] } } }
'use strict';

const { spawn } = require('child_process');
const { loadMcpServers } = require('../config');

// v0.41.0: o servidor MCP (muitas vezes de terceiros) herdava o process.env inteiro, inclusive
// as chaves do PRÓPRIO gemini-code. Estas saem; o que o servidor precisar vai no "env" dele no
// mcp.json. Outras variáveis do seu shell (ex.: GITHUB_TOKEN) continuam herdadas de propósito.
const SEGREDOS_DO_GEMINI_CODE = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_CODE_OPENAI_KEY', 'ROUTINE_API_TOKEN'];

function ambienteSemSegredosDoGeminiCode(env = process.env) {
  const limpo = { ...env };
  for (const nome of SEGREDOS_DO_GEMINI_CODE) delete limpo[nome];
  return limpo;
}

let VERSAO = '0.0.0';
try { VERSAO = require('../../package.json').version; } catch { /* sem package.json: segue */ }

// v0.3.7: o resultado de `tools/call` do MCP é um objeto
// ({ content: [{ type: 'text', text }, ...], isError }). O agente fazia
// String(resultado) e o modelo recebia literalmente "[object Object]" —
// ou seja, NENHUMA ferramenta de MCP devolvia algo útil. Aqui vira texto.
function formatarResultado(result) {
  if (result == null) return '(sem resultado)';
  if (typeof result === 'string') return result;
  const partes = Array.isArray(result.content) ? result.content : null;
  if (!partes) return JSON.stringify(result, null, 2);
  const texto = partes
    .map((p) => {
      if (!p) return '';
      if (p.type === 'text') return p.text || '';
      if (p.type === 'image') return `[imagem ${p.mimeType || ''} omitida]`;
      if (p.type === 'resource' && p.resource) return p.resource.text || `[recurso ${p.resource.uri || ''}]`;
      return JSON.stringify(p);
    })
    .filter(Boolean)
    .join('\n');
  const corpo = texto || (result.structuredContent ? JSON.stringify(result.structuredContent, null, 2) : '(sem saída)');
  return result.isError ? `Erro reportado pela ferramenta MCP:\n${corpo}` : corpo;
}

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
      env: { ...ambienteSemSegredosDoGeminiCode(), ...(this.cfg.env || {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc.stdout.on('data', (chunk) => this._onData(chunk));
    this.proc.stderr.on('data', () => {}); // logs do servidor MCP são ignorados aqui
    // v0.3.7: escrever no stdin de um servidor que já morreu emite 'error'
    // (EPIPE) — sem handler isso derrubava o gemini-code inteiro.
    this.proc.stdin.on('error', (err) => this._rejectAllPending(err));
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

  // Notificação JSON-RPC (sem id, sem resposta).
  _notify(method, params) {
    if (!this.proc || !this.proc.stdin.writable) return;
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  async initialize() {
    await this._send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'gemini-code', version: VERSAO },
    });
    // v0.3.7: o protocolo MCP exige esta notificação depois do initialize.
    // Servidores que seguem a especificação à risca ignoram (ou recusam)
    // tools/list enquanto ela não chega — o cliente antigo nunca mandava.
    this._notify('notifications/initialized');
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

// v0.34.0: servidor com "confirmar": ["execute", ...] no mcp.json pede s/n antes de cada ferramenta cujo nome
// contenha um desses trechos ("*" = todas). Serve para ferramentas que rodam código (Blender, Roblox).
let perguntar = (q) => require('../ui/prompt').ask(q);
function precisaConfirmar(cfg, toolName) {
  const lista = [].concat(cfg && cfg.confirmar ? cfg.confirmar : []).map((x) => String(x).toLowerCase());
  const n = String(toolName).toLowerCase();
  return lista.some((x) => x === '*' || n.includes(x));
}

let lerServidores = () => loadMcpServers();

// v0.36.0: os servidores sobem EM PARALELO (antes eram um por vez: 3 servidores lentos somavam até 60 s de espera
// antes da primeira resposta) e um servidor com "desativado": true no mcp.json é ignorado (não gasta tempo nem
// tokens com as declarações das ferramentas). Falha de um não derruba os outros.
async function loadAllMcpTools() {
  if (connections) return connections;
  const servers = Object.entries(lerServidores()).filter(([, cfg]) => !(cfg && cfg.desativado === true));
  const resultados = await Promise.all(servers.map(async ([name, cfg]) => {
    const conn = new McpConnection(name, cfg);
    try {
      conn.start();
      await conn.initialize();
      return [name, conn];
    } catch (err) {
      console.error(`[mcp] falha ao iniciar "${name}": ${err.message}`);
      // Se initialize() falhou (timeout, erro etc.), o processo do servidor
      // pode ter ficado rodando (ex.: um "sleep" ou servidor travado) sem
      // que ninguém mais tenha referência pra matá-lo depois — isso sozinho
      // já era o suficiente pra impedir o Node de encerrar no final.
      conn.stop();
      return null;
    }
  }));
  connections = {};
  for (const r of resultados) if (r) connections[r[0]] = r[1];
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
  const conns = await loadAllMcpTools();
  // v0.3.7: o nome do servidor pode conter "__"; casa pelo prefixo dos
  // servidores conhecidos (o mais longo vence) em vez de split('__').
  const nomes = Object.keys(conns).sort((a, b) => b.length - a.length);
  const serverName = nomes.find((n) => fullName.startsWith(`mcp__${n}__`));
  if (!serverName) throw new Error(`Servidor MCP não encontrado para a ferramenta: ${fullName}`);
  const toolName = fullName.slice(`mcp__${serverName}__`.length);
  if (precisaConfirmar(conns[serverName].cfg, toolName)) {
    const resumo = JSON.stringify(args || {}).slice(0, 600);
    const resp = String(await perguntar(`\n[gemini-code] O servidor "${serverName}" vai executar "${toolName}":\n  ${resumo}\nConfirmar? (s/n) `) || '').trim().toLowerCase();
    if (resp !== 's' && resp !== 'y') return 'Chamada cancelada pelo usuário.';
  }
  const res = await conns[serverName].callTool(toolName, args);
  return formatarResultado(res);
}

function stopAll() {
  if (!connections) return;
  Object.values(connections).forEach((c) => c.stop());
}

// Só para testes: injeta conexões falsas e a função de pergunta.
function _testar({ conexoes, ask, servidores } = {}) { if (conexoes !== undefined) connections = conexoes; if (ask) perguntar = ask; if (servidores) lerServidores = servidores; }

module.exports = { declarationsForGemini, execute, stopAll, McpConnection, formatarResultado, precisaConfirmar, ambienteSemSegredosDoGeminiCode, SEGREDOS_DO_GEMINI_CODE, _testar };
