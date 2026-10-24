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

// ---------------------------------------------------------------------------
// v0.41.0 — MCP remoto (transporte "Streamable HTTP" da especificação MCP)
// Antes só havia stdio (servidor local); Claude Code, Codex e Antigravity falam com servidores
// remotos. No mcp.json: { "url": "https://.../mcp", "headers": { "Authorization": "Bearer ${MEU_TOKEN}" } }
// ${VAR} vem do ambiente, para o token não ficar escrito no arquivo. Cada pedido é um POST com
// JSON-RPC; a resposta vem em JSON ou em SSE. OAuth não é suportado (use token no cabeçalho).
// ---------------------------------------------------------------------------

const PROTOCOLO_HTTP = '2025-06-18';

function expandirVariaveis(valor, env = process.env) {
  return String(valor).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, nome) => (env[nome] === undefined ? '' : env[nome]));
}

/** Lê um corpo SSE até achar a resposta JSON-RPC com o `id` pedido. */
async function respostaDoSse(response, id) {
  const reader = response.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let dados = [];
  const evento = () => {
    if (!dados.length) return null;
    const texto = dados.join('\n');
    dados = [];
    try { const msg = JSON.parse(texto); return msg && msg.id === id ? msg : null; } catch { return null; }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const linhas = buf.split(/\r?\n/);
    buf = linhas.pop();
    for (const linha of linhas) {
      if (linha === '') { const msg = evento(); if (msg) { reader.cancel().catch(() => {}); return msg; } } else if (linha.startsWith('data:')) dados.push(linha.slice(5).replace(/^ /, ''));
    }
  }
  if (buf.startsWith('data:')) dados.push(buf.slice(5).replace(/^ /, ''));
  return evento();
}

class McpHttpConnection {
  constructor(name, cfg, { fetchFn = (...a) => fetch(...a) } = {}) {
    this.name = name;
    this.cfg = cfg;
    this.fetchFn = fetchFn;
    this.nextId = 1;
    this.sessao = null;
    this.protocolo = null;
    this.tools = [];
  }

  start() {
    let u;
    try { u = new URL(this.cfg.url); } catch { throw new Error(`URL inválida no servidor MCP "${this.name}": ${this.cfg.url}`); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`Servidor MCP "${this.name}": só http(s) é aceito.`);
  }

  _cabecalhos() {
    const h = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    for (const [k, v] of Object.entries(this.cfg.headers || {})) h[k] = expandirVariaveis(v);
    if (this.sessao) h['Mcp-Session-Id'] = this.sessao;
    if (this.protocolo) h['MCP-Protocol-Version'] = this.protocolo;
    return h;
  }

  // O prazo vale até o CORPO terminar de chegar (JSON ou SSE): antes era limpo quando chegavam os
  // cabeçalhos, e um servidor que mandasse "200" e parasse travava o agente para sempre.
  async _comPrazo(timeoutMs, fn) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fn(ctrl);
    } catch (err) {
      if (ctrl.signal.aborted) throw new Error(`Tempo esgotado (${timeoutMs}ms) esperando resposta de "${this.name}".`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async _post(corpo, ctrl) {
    try {
      // redirect: 'manual' — seguir um 307/308 levaria os cabeçalhos do mcp.json (tokens) para outro endereço.
      const res = await this.fetchFn(this.cfg.url, { method: 'POST', headers: this._cabecalhos(), body: JSON.stringify(corpo), signal: ctrl.signal, redirect: 'manual' });
      const sessao = res.headers && res.headers.get && res.headers.get('mcp-session-id');
      if (sessao) this.sessao = sessao;
      return res;
    } catch (err) {
      if (ctrl.signal.aborted) throw err;
      throw new Error(`Não consegui falar com o servidor MCP "${this.name}" (${err.cause?.code || err.message}).`);
    }
  }

  _send(method, params, timeoutMs = 20000) {
    const id = this.nextId++;
    return this._comPrazo(timeoutMs, async (ctrl) => {
      const res = await this._post({ jsonrpc: '2.0', id, method, params }, ctrl);
      if (res.status >= 300 && res.status < 400) {
        throw new Error(`Servidor MCP "${this.name}" redirecionou (HTTP ${res.status}) para ${res.headers.get('location') || 'outro endereço'} em "${method}". O gemini-code não segue redirecionamento (os cabeçalhos com token iriam junto): coloque a URL final no mcp.json.`);
      }
      if (!res.ok) {
        const detalhe = await res.text().catch(() => '');
        throw new Error(`Servidor MCP "${this.name}" respondeu HTTP ${res.status} em "${method}"${res.status === 401 || res.status === 403 ? ' (confira o token em "headers" no mcp.json)' : ''}: ${detalhe.slice(0, 200)}`);
      }
      const tipo = (res.headers.get('content-type') || '').toLowerCase();
      const msg = tipo.includes('text/event-stream') ? await respostaDoSse(res, id) : await res.json().catch((err) => { if (ctrl.signal.aborted) throw err; return null; });
      if (!msg) throw new Error(`Servidor MCP "${this.name}" não devolveu resposta para "${method}".`);
      if (msg.error) throw new Error(msg.error.message || JSON.stringify(msg.error));
      return msg;
    });
  }

  async _notify(method, params) {
    try { await this._comPrazo(10000, (ctrl) => this._post({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }, ctrl)); } catch { /* notificação é best-effort */ }
  }

  async initialize() {
    const r = await this._send('initialize', { protocolVersion: PROTOCOLO_HTTP, capabilities: {}, clientInfo: { name: 'gemini-code', version: VERSAO } });
    this.protocolo = (r.result && r.result.protocolVersion) || PROTOCOLO_HTTP;
    await this._notify('notifications/initialized');
    const listed = await this._send('tools/list', {});
    this.tools = (listed && listed.result && listed.result.tools) || [];
    return this.tools;
  }

  async callTool(toolName, args) {
    const res = await this._send('tools/call', { name: toolName, arguments: args }, 120000);
    return res && res.result;
  }

  stop() {
    // Encerra a sessão no servidor (opcional na especificação); não espera a resposta.
    if (!this.sessao) return;
    const h = this._cabecalhos();
    this.sessao = null;
    Promise.resolve().then(() => this.fetchFn(this.cfg.url, { method: 'DELETE', headers: h, redirect: 'manual' })).catch(() => {});
  }
}

const novaConexao = (name, cfg) => (cfg && cfg.url ? new McpHttpConnection(name, cfg) : new McpConnection(name, cfg));

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
    const conn = novaConexao(name, cfg);
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

module.exports = {
  declarationsForGemini, execute, stopAll, McpConnection, McpHttpConnection, novaConexao, expandirVariaveis, formatarResultado,
  precisaConfirmar, ambienteSemSegredosDoGeminiCode, SEGREDOS_DO_GEMINI_CODE, _testar,
};
