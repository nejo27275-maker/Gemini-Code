// src/providers/ollama.js
// Provedor LOCAL: fala com o Ollama (http://127.0.0.1:11434) no mesmo formato
// que src/gemini.js expõe (chatWithTools -> { text(), functionCalls(), rawParts() }),
// então o loop do agente (agent.js) não sabe nem precisa saber qual modelo
// está do outro lado. O histórico continua sendo guardado no formato Gemini
// (parts/functionCall/functionResponse) — aqui só convertemos na hora de enviar.
'use strict';

const { loadConfig } = require('../config');
const { respostaDePartes } = require('../gemini');

function baseUrl(cfg) {
  const raw = process.env.OLLAMA_HOST || cfg.ollamaUrl || 'http://127.0.0.1:11434';
  const comEsquema = /^https?:\/\//.test(raw) ? raw : `http://${raw}`;
  return comEsquema.replace(/\/+$/, '');
}

// Gemini aceita/gera tipos em MAIÚSCULAS em alguns schemas (MCP); JSON Schema
// puro (que o Ollama espera) é minúsculo.
function normalizarSchema(s) {
  if (Array.isArray(s)) return s.map(normalizarSchema);
  if (!s || typeof s !== 'object') return s;
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    out[k] = k === 'type' && typeof v === 'string' ? v.toLowerCase() : normalizarSchema(v);
  }
  return out;
}

function converterTools(tools) {
  return (tools || []).map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description || '',
      parameters: normalizarSchema(t.parameters) || { type: 'object', properties: {} },
    },
  }));
}

function resultadoComoTexto(resp) {
  const r = resp && resp.result !== undefined ? resp.result : resp;
  return typeof r === 'string' ? r : JSON.stringify(r);
}

/** Histórico no formato Gemini -> mensagens do Ollama. */
function converterHistorico(history, systemInstruction) {
  const msgs = [];
  if (systemInstruction) msgs.push({ role: 'system', content: systemInstruction });
  for (const turno of history || []) {
    const parts = turno.parts || [];
    if (turno.role === 'model') {
      const texto = parts.filter((p) => typeof p.text === 'string').map((p) => p.text).join('');
      const calls = parts.filter((p) => p.functionCall).map((p) => ({
        function: { name: p.functionCall.name, arguments: p.functionCall.args || {} },
      }));
      const m = { role: 'assistant', content: texto };
      if (calls.length) m.tool_calls = calls;
      msgs.push(m);
    } else {
      const texto = parts.filter((p) => typeof p.text === 'string').map((p) => p.text).join('');
      for (const p of parts) {
        if (p.functionResponse) {
          msgs.push({ role: 'tool', tool_name: p.functionResponse.name, content: resultadoComoTexto(p.functionResponse.response) });
        }
      }
      if (texto) msgs.push({ role: 'user', content: texto });
    }
  }
  return msgs;
}

/**
 * Modelos locais têm contexto pequeno (num_ctx). Em vez de estourar e o
 * Ollama truncar sozinho (perdendo justo o system prompt), cortamos o MEIO da
 * conversa por orçamento de caracteres (~3 chars/token), mantendo o system e
 * o que é mais recente. Nunca começa a parte mantida com uma mensagem "tool"
 * órfã (sem o assistant que a chamou).
 */
function ajustarAoContexto(msgs, numCtx) {
  const orcamento = Math.floor(numCtx * 3 * 0.75); // deixa 25% pra resposta
  const tam = (m) => (m.content ? m.content.length : 0) + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0);
  const sistema = msgs[0] && msgs[0].role === 'system' ? [msgs[0]] : [];
  const resto = sistema.length ? msgs.slice(1) : msgs.slice();
  let total = sistema.reduce((a, m) => a + tam(m), 0);
  const mantidas = [];
  for (let i = resto.length - 1; i >= 0; i--) {
    const t = tam(resto[i]);
    if (total + t > orcamento && mantidas.length) break;
    total += t;
    mantidas.unshift(resto[i]);
  }
  while (mantidas.length > 1 && mantidas[0].role === 'tool') mantidas.shift();
  const cortou = mantidas.length < resto.length;
  const aviso = cortou ? [{ role: 'user', content: '[...parte antiga da conversa omitida para caber no contexto do modelo local...]' }] : [];
  // mensagens muito grandes (ex.: arquivo lido) que sozinhas passam do orçamento
  const ultima = mantidas[mantidas.length - 1];
  if (ultima && ultima.content && ultima.content.length > orcamento) {
    ultima.content = ultima.content.slice(0, orcamento) + '\n[... truncado para caber no contexto local ...]';
  }
  return [...sistema, ...aviso, ...mantidas];
}

// Modelos pequenos às vezes "escrevem" a chamada de ferramenta como texto JSON
// em vez de usar o campo tool_calls. Se o texto INTEIRO for uma chamada pra uma
// ferramenta que existe, tratamos como chamada de verdade.
function extrairChamadaEmTexto(texto, tools) {
  if (!texto || !tools || !tools.length) return null;
  let t = texto.trim();
  const cerca = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (cerca) t = cerca[1].trim();
  if (!t.startsWith('{')) return null;
  let obj;
  try { obj = JSON.parse(t); } catch { return null; }
  const nome = obj.name || obj.tool || obj.function;
  const args = obj.arguments || obj.parameters || obj.args || {};
  if (typeof nome !== 'string' || !tools.some((d) => d.name === nome)) return null;
  return { name: nome, args: typeof args === 'object' && args ? args : {} };
}

function erroOllama(status, corpo, model, url) {
  const msg = (corpo && corpo.error) || '';
  if (status === 404 || /not found/i.test(msg)) {
    const e = new Error(`[Ollama] modelo '${model}' não encontrado. Baixe com: ollama pull ${model}\n(ver instalados: gemini-code ollama models)`);
    e.rede = false;
    return e;
  }
  if (/does not support tools/i.test(msg)) {
    return new Error(`[Ollama] o modelo '${model}' não suporta ferramentas (tools). Use um que suporte, ex.: qwen2.5-coder, qwen3, llama3.1 — troque com: gemini-code config set-ollama-model NOME`);
  }
  return new Error(`[Ollama] erro HTTP ${status} em ${url}: ${msg || 'sem detalhes'}`);
}

function erroConexao(err, url) {
  const e = new Error(
    `[Ollama] não consegui conectar em ${url} (${err.cause?.code || err.message}).\n` +
    'Instale o Ollama no dispositivo/PC, inicie com "ollama serve" e baixe um modelo geral, por exemplo: "ollama pull qwen3:4b-instruct".\n' +
    'Se estiver no celular e o Ollama rodar em outro PC da mesma rede, defina OLLAMA_HOST=http://IP_DO_PC:11434.' 
  );
  e.rede = true;
  return e;
}

async function chatWithTools({ modelName, systemInstruction, history, tools, onText }) {
  const cfg = loadConfig();
  const model = modelName || cfg.ollamaModel;
  const url = `${baseUrl(cfg)}/api/chat`;
  const numCtx = Number(cfg.ollamaNumCtx) || 8192;
  const stream = Boolean(onText) && cfg.enableStreaming !== false;

  const body = {
    model,
    stream,
    messages: ajustarAoContexto(converterHistorico(history, systemInstruction), numCtx),
    options: { num_ctx: numCtx, temperature: Number.isFinite(cfg.ollamaTemperature) ? cfg.ollamaTemperature : 0.2 },
    keep_alive: cfg.ollamaKeepAlive || '10m',
  };
  const decls = converterTools(tools);
  if (decls.length) body.tools = decls;

  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (err) {
    throw erroConexao(err, baseUrl(cfg));
  }
  if (!res.ok) {
    const corpo = await res.json().catch(() => ({}));
    throw erroOllama(res.status, corpo, model, url);
  }

  let texto = '';
  const chamadas = [];
  const processar = (chunk) => {
    if (chunk.error) throw erroOllama(500, chunk, model, url);
    const m = chunk.message || {};
    if (m.content) {
      texto += m.content;
      if (stream && onText) onText(m.content);
    }
    for (const tc of m.tool_calls || []) {
      let args = tc.function?.arguments || {};
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
      chamadas.push({ functionCall: { name: tc.function?.name, args } });
    }
  };

  if (stream) {
    const reader = res.body.getReader();
    const dec = new TextDecoder('utf8');
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) !== -1) {
        const linha = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (linha) { try { processar(JSON.parse(linha)); } catch (e) { if (e.message.startsWith('[Ollama]')) throw e; } }
      }
    }
    buf += dec.decode();
    if (buf.trim()) { try { processar(JSON.parse(buf)); } catch (e) { if (e.message.startsWith('[Ollama]')) throw e; } }
  } else {
    processar(await res.json());
  }

  if (!chamadas.length) {
    const emTexto = extrairChamadaEmTexto(texto, tools);
    if (emTexto) {
      chamadas.push({ functionCall: { name: emTexto.name, args: emTexto.args } });
      texto = '';
    }
  }

  const parts = [];
  if (texto) parts.push({ text: texto });
  parts.push(...chamadas);
  if (!parts.length) parts.push({ text: '' });
  return respostaDePartes(parts);
}

/** Modelos instalados no Ollama local (ollama models). */
async function listarModelosLocais() {
  const cfg = loadConfig();
  let res;
  try {
    res = await fetch(`${baseUrl(cfg)}/api/tags`);
  } catch (err) {
    throw erroConexao(err, baseUrl(cfg));
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw erroOllama(res.status, data, '(lista)', `${baseUrl(cfg)}/api/tags`);
  return (data.models || []).map((m) => ({ name: m.name, sizeGB: m.size ? +(m.size / 1e9).toFixed(1) : undefined }));
}

module.exports = {
  chatWithTools, listarModelosLocais,
  // exportados para teste
  converterHistorico, converterTools, ajustarAoContexto, extrairChamadaEmTexto, baseUrl,
};
