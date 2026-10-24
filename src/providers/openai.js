// src/providers/openai.js (v0.41.0)
// Qualquer API compatível com OpenAI (/chat/completions) COM chave: OpenRouter (dá acesso a
// Claude, GPT, Gemini, DeepSeek, Qwen...), OpenAI, DeepSeek, Groq e similares. O cliente do
// llama.cpp não manda Authorization e encolhe tudo para 4096 tokens de contexto — servia só
// para modelo pequeno local. Aqui o modelo é forte e o contexto é grande: sem ferramentas
// compactas nem system cortado; o histórico só é podado se passar do orçamento configurado.
'use strict';

const { loadConfig } = require('../config');
const { respostaDePartes } = require('../gemini');
const usage = require('../usage');
const { converterHistorico, converterTools, ajustarAoContexto, lerStream, estimarTokens } = require('./llamacpp');

const BASE_PADRAO = 'https://openrouter.ai/api/v1';
const CHARS_POR_TOKEN = 3;

function baseUrl(cfg) {
  const raw = process.env.GEMINI_CODE_OPENAI_URL || cfg.openaiBaseUrl || BASE_PADRAO;
  return raw.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
}

function chave(cfg) {
  return process.env.GEMINI_CODE_OPENAI_KEY || cfg.openaiApiKey || '';
}

function ctxTokens(cfg) {
  const n = Number(cfg.openaiCtx);
  return Number.isInteger(n) && n >= 8000 ? n : 128000;
}

function erroHttp(status, data, url) {
  const detalhe = data.error?.message || data.error || data.message || 'sem detalhes';
  const texto = typeof detalhe === 'string' ? detalhe : JSON.stringify(detalhe);
  const error = new Error(`[openai] erro HTTP ${status} em ${url}: ${texto}`);
  if (status === 401 || status === 403) error.message += '\nConfira a chave: gemini-code config set-openai-key SUA_CHAVE (ou GEMINI_CODE_OPENAI_KEY).';
  if (status === 400 && /context|token|too long|maximum/i.test(texto)) {
    error.contexto = true;
    error.message += '\nA conversa passou do contexto do modelo: use /compact ou ajuste openaiCtx no config.';
  }
  error.transitorio = status === 429 || status >= 500;
  return error;
}

function erroRede(err, url) {
  const error = new Error(`[openai] não consegui conectar a ${url} (${err.cause?.code || err.message}).`);
  error.rede = true;
  return error;
}

async function pedir({ url, headers, body, onText, timeoutMs, stream }) {
  const ctrl = new AbortController();
  let timer;
  let estourou = false;
  const reiniciar = () => { clearTimeout(timer); timer = setTimeout(() => { estourou = true; ctrl.abort(); }, timeoutMs); };
  reiniciar();
  try {
    let response;
    try {
      response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
    } catch (err) {
      if (estourou) throw Object.assign(new Error(`[openai] sem resposta de ${url} há ${Math.round(timeoutMs / 1000)}s.`), { rede: true });
      throw erroRede(err, url);
    }
    reiniciar();
    if (!response.ok) throw erroHttp(response.status, await response.json().catch(() => ({})), url);
    if (stream && response.body && typeof response.body.getReader === 'function') {
      const r = await lerStream(response, onText, reiniciar, erroHttp);
      return { texto: r.texto, calls: r.calls, usage: r.usage, jaEmitiu: true };
    }
    const data = await response.json().catch(() => ({}));
    const message = data.choices?.[0]?.message || {};
    const texto = typeof message.content === 'string' ? message.content
      : Array.isArray(message.content) ? message.content.map((p) => p.text || '').join('') : '';
    const calls = (message.tool_calls || []).map((tc) => ({ id: tc.id, name: tc.function?.name || '', args: tc.function?.arguments ?? {} }));
    return { texto, calls, usage: data.usage || null, jaEmitiu: false };
  } catch (err) {
    if (estourou && !err.rede) throw Object.assign(new Error(`[openai] sem resposta de ${url} há ${Math.round(timeoutMs / 1000)}s.`), { rede: true });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function chatWithTools({ modelName, systemInstruction, history, tools, onText }) {
  const cfg = loadConfig();
  const key = chave(cfg);
  if (!key) {
    const e = new Error('[openai] nenhuma chave configurada. Rode: gemini-code config set-openai-key SUA_CHAVE (ou defina GEMINI_CODE_OPENAI_KEY).');
    e.rede = true; // recuperável: no modo híbrido o roteador tenta o outro lado
    throw e;
  }
  const modelo = modelName || cfg.openaiModel;
  if (!modelo) throw new Error('[openai] nenhum modelo configurado. Rode: gemini-code config set-openai-model NOME (ex.: anthropic/claude-sonnet-4.5 no OpenRouter).');

  const base = baseUrl(cfg);
  const url = `${base}/chat/completions`;
  const maxResp = Math.max(256, Math.min(Number(cfg.openaiMaxTokens) || 8192, 64000));
  const declarations = converterTools(tools);
  const toolsTokens = estimarTokens(JSON.stringify(declarations));
  // Só poda se a conversa passar do contexto do modelo (com folga para a resposta).
  const orcamentoChars = Math.max(20000, (ctxTokens(cfg) - maxResp - toolsTokens - 512) * CHARS_POR_TOKEN);
  const mensagens = ajustarAoContexto(converterHistorico(history, systemInstruction || '', { imagens: true }), orcamentoChars);

  const stream = Boolean(onText) && cfg.enableStreaming !== false;
  const body = { model: modelo, messages: mensagens, max_tokens: maxResp, stream };
  if (stream) body.stream_options = { include_usage: true };
  if (Number.isFinite(cfg.openaiTemperature)) body.temperature = cfg.openaiTemperature;
  if (declarations.length) body.tools = declarations;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
    // Opcionais do OpenRouter (identificam o app); outras APIs ignoram.
    'HTTP-Referer': 'https://github.com/nejo27275-maker/Gemini-Code',
    'X-Title': 'gemini-code',
  };

  const r = await pedir({ url, headers, body, onText, timeoutMs: Number(cfg.openaiTimeoutMs) || 300000, stream });

  const parts = [];
  if (r.texto) parts.push({ text: r.texto });
  for (const c of r.calls) {
    if (!c.name) continue;
    let args = c.args;
    if (typeof args === 'string') { try { args = JSON.parse(args || '{}'); } catch { args = {}; } }
    parts.push({ functionCall: { name: c.name, args: args || {}, ...(c.id ? { id: c.id } : {}) } });
  }
  if (!parts.length) parts.push({ text: '' });
  const temChamada = parts.some((p) => p.functionCall);
  if (!r.jaEmitiu && r.texto && onText && !temChamada) onText(r.texto);

  // Custo de nuvem de verdade: entra no /custo e no limite maxTokensSessao.
  const u = r.usage || {};
  usage.registrar({
    modelo: `openai:${modelo}`,
    uso: { promptTokenCount: u.prompt_tokens, candidatesTokenCount: u.completion_tokens, totalTokenCount: u.total_tokens },
  });
  return respostaDePartes(parts);
}

module.exports = { chatWithTools, baseUrl, chave, ctxTokens, BASE_PADRAO };
