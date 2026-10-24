// Provedor local via servidor OpenAI-compatible do llama.cpp. Não usa Ollama.
// Para Android, execute llama-server no Termux com um modelo GGUF já baixado.
'use strict';

const { loadConfig } = require('../config');
const { respostaDePartes } = require('../gemini');
const localServer = require('../localServer');

function baseUrl(cfg) {
  const raw = process.env.LLAMACPP_URL || cfg.llamaCppUrl || 'http://127.0.0.1:8080';
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  return withScheme.replace(/\/+$/, '').replace(/\/v1$/i, '');
}

function normalizarSchema(value) {
  if (Array.isArray(value)) return value.map(normalizarSchema);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = key === 'type' && typeof item === 'string' ? item.toLowerCase() : normalizarSchema(item);
  }
  return result;
}

function converterTools(tools) {
  return (tools || []).map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: normalizarSchema(tool.parameters) || { type: 'object', properties: {} },
    },
  }));
}

function resultadoComoTexto(value) {
  const result = value && value.result !== undefined ? value.result : value;
  return typeof result === 'string' ? result : JSON.stringify(result);
}

// v0.41.0: imagens (partes inlineData) viram image_url no provedor openai (`imagens: true`); no llama.cpp
// local (modelo pequeno, em geral sem visão) viram um aviso em texto em vez de sumirem em silêncio.
function converterHistorico(history, systemInstruction, { imagens = false } = {}) {
  const messages = [];
  const pendingIds = new Map();
  let generatedId = 0;
  if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });

  for (const turn of history || []) {
    const parts = turn.parts || [];
    if (turn.role === 'model') {
      const content = parts.filter((part) => typeof part.text === 'string').map((part) => part.text).join('');
      const calls = parts.filter((part) => part.functionCall).map((part) => {
        const call = part.functionCall;
        const id = call.id || `call_${++generatedId}`;
        const ids = pendingIds.get(call.name) || [];
        ids.push(id);
        pendingIds.set(call.name, ids);
        return {
          id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.args || {}) },
        };
      });
      const message = { role: 'assistant', content: content || null };
      if (calls.length) message.tool_calls = calls;
      if (message.content || calls.length) messages.push(message);
      continue;
    }

    // Gemini guarda retorno de ferramentas em um turno "user". Convertemos
    // esses itens para mensagens "tool" exigidas pela API compatível com OpenAI.
    for (const part of parts) {
      if (!part.functionResponse) continue;
      const response = part.functionResponse;
      const ids = pendingIds.get(response.name) || [];
      const matchingIndex = response.id ? ids.indexOf(response.id) : 0;
      const id = response.id || (matchingIndex >= 0 && ids[matchingIndex]) || `call_${++generatedId}`;
      if (matchingIndex >= 0 && ids.length) ids.splice(matchingIndex, 1);
      messages.push({ role: 'tool', tool_call_id: id, content: resultadoComoTexto(response.response) });
    }
    const text = parts.filter((part) => typeof part.text === 'string').map((part) => part.text).join('');
    const figuras = parts.filter((part) => part.inlineData && part.inlineData.data);
    if (figuras.length && imagens) {
      messages.push({
        role: 'user',
        content: [
          ...figuras.map((p) => ({ type: 'image_url', image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } })),
          ...(text ? [{ type: 'text', text }] : []),
        ],
      });
    } else if (figuras.length) {
      messages.push({ role: 'user', content: `[${figuras.length} imagem(ns) omitida(s): o modelo local não recebe imagens]\n${text}`.trim() });
    } else if (text) messages.push({ role: 'user', content: text });
  }
  return messages;
}

// ---------------------------------------------------------------------------
// v0.37.0 — contexto pequeno do celular
// O llama-server sobe com contexto limitado (padrão 4096 tokens). Só as ferramentas + o prompt do sistema do
// agente já passam de ~3 000 tokens, então antes o servidor recusava o pedido (HTTP 400, contexto estourado).
// Agora: ferramentas compactas, system truncado só se precisar, e o histórico é podado por orçamento.
// ---------------------------------------------------------------------------

const CHARS_POR_TOKEN = 3; // estimativa conservadora para português/código
const estimarTokens = (texto) => Math.ceil(String(texto || '').length / CHARS_POR_TOKEN);

function ctxTamanho(cfg) {
  const n = Number(process.env.LLAMA_CTX || process.env.LLAMACPP_CTX || cfg.llamaCppCtx);
  return Number.isInteger(n) && n >= 512 ? n : 4096;
}

const ESSENCIAIS = new Set(['read_file', 'write_file', 'edit_file', 'list_dir', 'run_shell', 'search_files', 'run_checks']);
// Ordem de descarte quando as ferramentas não cabem (primeiro as menos úteis para um modelo pequeno).
const DESCARTE = ['browser', 'delegate_task', 'run_workflow', 'todo_write', 'read_skill'];

function encurtar(texto, max) {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function encurtarSchema(value) {
  if (Array.isArray(value)) return value.map(encurtarSchema);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = k === 'description' && typeof v === 'string' ? encurtar(v, 70) : encurtarSchema(v);
  return out;
}

/**
 * Deixa as ferramentas dentro de `limiteTokens`. 1º encurta as descrições; 2º se ainda não couber, descarta as
 * dispensáveis (nunca as essenciais). `mcp__*` ficam por último. Devolve { tools, removidas, tokens }.
 */
function compactarTools(tools, limiteTokens) {
  let lista = (tools || []).map((t) => ({ ...t, description: encurtar(t.description, 110), parameters: encurtarSchema(t.parameters) }));
  const tokens = (l) => estimarTokens(JSON.stringify(converterTools(l)));
  const removidas = [];
  const remover = (nome) => {
    const i = lista.findIndex((t) => t.name === nome);
    if (i >= 0) { removidas.push(nome); lista.splice(i, 1); }
  };
  for (const nome of DESCARTE) { if (tokens(lista) <= limiteTokens) break; remover(nome); }
  if (tokens(lista) > limiteTokens) {
    for (const t of [...lista].reverse()) {
      if (tokens(lista) <= limiteTokens) break;
      if (t.name.startsWith('mcp__')) remover(t.name);
    }
  }
  if (tokens(lista) > limiteTokens) {
    for (const t of [...lista].reverse()) {
      if (tokens(lista) <= limiteTokens) break;
      if (!ESSENCIAIS.has(t.name)) remover(t.name);
    }
  }
  return { tools: lista, removidas, tokens: tokens(lista) };
}

// Conteúdo em partes (imagem + texto): soma o texto e estima ~1 000 tokens (3 000 caracteres) por imagem.
const tamConteudo = (c) => (typeof c === 'string' ? c.length
  : Array.isArray(c) ? c.reduce((a, p) => a + (p.type === 'text' ? String(p.text || '').length : 3000), 0) : 0);
const tamMsg = (m) => tamConteudo(m.content) + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0);

/**
 * Poda por orçamento (em caracteres). Mantém o system (truncado se passar de `maxSistemaChars`) e o que é mais
 * recente; nunca começa com mensagem "tool" órfã; trunca a última se sozinha estourar.
 */
function ajustarAoContexto(msgs, orcamentoChars, { maxSistemaChars = Infinity } = {}) {
  const sistema = msgs[0] && msgs[0].role === 'system' ? [{ ...msgs[0] }] : [];
  if (sistema.length && sistema[0].content.length > maxSistemaChars) {
    sistema[0].content = `${sistema[0].content.slice(0, Math.max(0, maxSistemaChars))}\n[... instruções adicionais omitidas para caber no contexto local ...]`;
  }
  const resto = (sistema.length ? msgs.slice(1) : msgs.slice()).map((m) => ({ ...m }));
  const livre = Math.max(400, orcamentoChars - sistema.reduce((a, m) => a + tamMsg(m), 0));
  let total = 0;
  const mantidas = [];
  for (let i = resto.length - 1; i >= 0; i--) {
    const t = tamMsg(resto[i]);
    if (total + t > livre && mantidas.length) break;
    total += t;
    mantidas.unshift(resto[i]);
  }
  while (mantidas.length > 1 && mantidas[0].role === 'tool') mantidas.shift();
  const cortou = mantidas.length < resto.length;
  const ultima = mantidas[mantidas.length - 1];
  if (ultima && typeof ultima.content === 'string' && ultima.content.length > livre) {
    ultima.content = `${ultima.content.slice(0, livre)}\n[... truncado para caber no contexto local ...]`;
  }
  const aviso = cortou ? [{ role: 'user', content: '[...parte antiga da conversa omitida para caber no contexto do modelo local...]' }] : [];
  return [...sistema, ...aviso, ...mantidas];
}

/**
 * v0.38.0: o system é cortado pelo FIM, e é no fim que ficam os conhecimentos fixos do usuário (spec da NetoLang,
 * convenções do projeto). Antes de cortar, tira o que um modelo pequeno menos aproveita: parágrafos sobre
 * delegate_task/todo_write/run_workflow (ferramentas que já saem no modo compacto) e a lista de skills.
 * Identidade, regra do run_checks, contexto do projeto e conhecimento ficam; só o conhecimento é cortado no fim.
 */
function compactarSistema(texto, maxChars) {
  const t = String(texto || '');
  if (t.length <= maxChars) return t;
  const paragrafos = t.split(/\n\n/);
  const irrelevante = (p) => /delegate_task|todo_write|run_workflow/.test(p) || /^Skills dispon[ií]veis:/.test(p);
  let partes = paragrafos.filter((p) => !irrelevante(p));
  // lista de skills pode ter várias linhas e vir "grudada" no último parágrafo da base: remove só o bloco dela.
  partes = partes.map((p) => p.replace(/\n?Skills dispon[ií]veis:[\s\S]*?(?=\n\nConhecimento fixo|$)/, ''));
  let r = partes.join('\n\n');
  if (r.length > maxChars) r = `${r.slice(0, Math.max(0, maxChars))}\n[... instruções adicionais omitidas para caber no contexto local ...]`;
  return r;
}

/**
 * Modelos pequenos às vezes "escrevem" a chamada em texto (`<tool_call>{...}</tool_call>` do Qwen, ou um JSON
 * puro) em vez de usar tool_calls. Só aceita se a ferramenta existe.
 */
function extrairChamadasEmTexto(texto, tools) {
  if (!texto || !tools || !tools.length) return null;
  const nomes = new Set(tools.map((t) => t.name));
  const candidatos = [];
  for (const m of texto.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g)) candidatos.push(m[1]);
  if (!candidatos.length) {
    let t = texto.trim();
    const cerca = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    if (cerca) t = cerca[1].trim();
    if (t.startsWith('{')) candidatos.push(t);
  }
  const calls = [];
  for (const c of candidatos) {
    let obj;
    try { obj = JSON.parse(c); } catch { continue; }
    const nome = obj.name || obj.tool || obj.function;
    let args = obj.arguments || obj.parameters || obj.args || {};
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
    if (typeof nome === 'string' && nomes.has(nome) && args && typeof args === 'object') calls.push({ name: nome, args });
  }
  return calls.length ? calls : null;
}

function erroConexao(err, url) {
  const error = new Error(
    `[llama.cpp] Não consegui conectar a ${url} (${err.cause?.code || err.message}).\n` +
    'No Termux, rode: gemini-code llamacpp start (ou bash android/start-llama-server.sh; para subir sozinho: gemini-code config set-llamacpp-autostart on). ' +
    'O modelo GGUF precisa estar baixado; veja ANDROID_TERMUX.md.'
  );
  error.rede = true;
  return error;
}

function erroTempoEsgotado(url, ms) {
  const error = new Error(`[llama.cpp] sem resposta de ${url} há ${Math.round(ms / 1000)}s. O celular pode estar sobrecarregado ou o servidor travou (veja: gemini-code llamacpp status). Ajuste com llamaCppTimeoutMs no config.`);
  error.rede = true;
  return error;
}

function erroHttp(status, data, url) {
  const detail = data.error?.message || data.error || data.message || 'sem detalhes';
  const texto = typeof detail === 'string' ? detail : JSON.stringify(detail);
  if (status === 400 && (data.error?.type === 'exceed_context_size_error' || /exceed.*context|context.*(size|length|exceed)|n_ctx/i.test(texto))) {
    const error = new Error('[llama.cpp] a conversa passou do contexto do servidor local. Use /compact (ou /clear) e tente de novo; ' +
      'para aumentar: reinicie com LLAMA_CTX=8192 gemini-code llamacpp start e rode gemini-code config set-llamacpp-ctx 8192.');
    error.contexto = true;
    return error;
  }
  const error = new Error(`[llama.cpp] erro HTTP ${status} em ${url}: ${texto}`);
  error.transitorio = [500, 502, 503, 504].includes(status);
  if (/jinja/i.test(texto)) error.message += '\nDica: inicie o llama-server com --jinja (android/start-llama-server.sh já faz isso).';
  return error;
}

/**
 * Lê o SSE do llama-server juntando texto e tool_calls (que chegam em pedaços, por `index`).
 * v0.41.0: também usado pelo provedor openai (src/providers/openai.js), que passa o próprio
 * `criarErro` e recebe o `usage` do último pedaço quando a API manda.
 */
async function lerStream(response, onText, reiniciarTimer, criarErro = erroHttp) {
  const reader = response.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let texto = '';
  let usage = null;
  const calls = [];
  const tratar = (linha) => {
    const l = linha.trim();
    if (!l.startsWith('data:')) return;
    const payload = l.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let obj;
    try { obj = JSON.parse(payload); } catch { return; }
    if (obj.error) { const e = criarErro(obj.error.code || 500, { error: obj.error }, ''); throw e; }
    if (obj.usage) usage = obj.usage;
    const delta = obj.choices?.[0]?.delta || {};
    if (typeof delta.content === 'string' && delta.content) { texto += delta.content; if (onText) onText(delta.content); }
    for (const tc of delta.tool_calls || []) {
      const i = Number.isInteger(tc.index) ? tc.index : calls.length;
      const atual = calls[i] || (calls[i] = { id: undefined, name: '', args: '' });
      if (tc.id) atual.id = tc.id;
      if (tc.function?.name) atual.name += tc.function.name;
      if (tc.function?.arguments) atual.args += typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments);
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    reiniciarTimer();
    buf += dec.decode(value, { stream: true });
    const linhas = buf.split(/\r?\n/);
    buf = linhas.pop();
    linhas.forEach(tratar);
  }
  if (buf) tratar(buf);
  return { texto, calls: calls.filter(Boolean), usage };
}

async function pedir({ url, body, onText, timeoutMs }) {
  const ctrl = new AbortController();
  let timer;
  let estourou = false;
  const reiniciar = () => { clearTimeout(timer); timer = setTimeout(() => { estourou = true; ctrl.abort(); }, timeoutMs); };
  reiniciar();
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
    reiniciar();
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw erroHttp(response.status, data, url);
    }
    // resposta inteira em JSON se o servidor ignorar o "stream"; o resto é SSE
    const json = /application\/json/i.test(String(response.headers?.get?.('content-type') || ''));
    if (!json && response.body && typeof response.body.getReader === 'function') {
      const r = await lerStream(response, onText, reiniciar);
      // sem onText (nada exibido durante a leitura), quem chama ainda entrega o texto inteiro no fim
      return { texto: r.texto, calls: r.calls, jaEmitiu: Boolean(onText) };
    }
    const data = await response.json().catch(() => ({}));
    const message = data.choices?.[0]?.message || {};
    const texto = typeof message.content === 'string' ? message.content
      : Array.isArray(message.content) ? message.content.map((part) => part.text || '').join('') : '';
    const calls = (message.tool_calls || []).map((tc) => ({ id: tc.id, name: tc.function?.name || '', args: tc.function?.arguments ?? {} }));
    return { texto, calls, jaEmitiu: false };
  } catch (err) {
    if (estourou) throw erroTempoEsgotado(url, timeoutMs);
    if (err.rede !== undefined || err.contexto || err.transitorio !== undefined) throw err;
    throw err; // quem chama converte falha de rede
  } finally {
    clearTimeout(timer);
  }
}

async function esperarPronto({ esperaMs = 90000, log = () => {} } = {}) {
  const limite = Date.now() + esperaMs;
  let avisou = false;
  while (Date.now() < limite) {
    const s = await status();
    if (s.ok) return true;
    if (s.estado === 'offline') return false;
    if (!avisou) { log('[llama.cpp] carregando o modelo, aguarde...'); avisou = true; }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

async function chatWithTools({ modelName, systemInstruction, history, tools, onText }) {
  const cfg = loadConfig();
  const base = baseUrl(cfg);
  const url = `${base}/v1/chat/completions`;
  const ctx = ctxTamanho(cfg);
  let maxResp = Math.max(128, Math.min(Number(cfg.llamaCppMaxTokens) || 1024, Math.floor(ctx * 0.25)));
  const timeoutMs = Number(cfg.llamaCppTimeoutMs) || 180000;

  // 1) ferramentas compactas (no máximo ~35% do contexto)
  const compactas = compactarTools(tools, Math.floor(ctx * 0.35));
  const declarations = converterTools(compactas.tools);
  const toolsTokens = estimarTokens(JSON.stringify(declarations));

  // 2) system + histórico dentro do que sobra
  let sistema = systemInstruction || '';
  if (compactas.removidas.length) sistema += `\n\n[Modo local compacto: as ferramentas ${compactas.removidas.join(', ')} NÃO estão disponíveis agora; faça sem elas.]`;
  // Reserva mínima de 600 tokens para conversa; se o contexto é apertado, encolhe a reserva da resposta (mín. 128).
  const MIN_CONVERSA = 600;
  let orcamentoTokens = ctx - maxResp - toolsTokens - 64;
  if (orcamentoTokens < MIN_CONVERSA) {
    maxResp = Math.max(128, maxResp - (MIN_CONVERSA - orcamentoTokens));
    orcamentoTokens = ctx - maxResp - toolsTokens - 64;
  }
  orcamentoTokens = Math.max(300, orcamentoTokens);
  // O system fica com o que a conversa não usa: de 40% (conversa longa) até 70% (conversa curta) do orçamento.
  const totalChars = orcamentoTokens * CHARS_POR_TOKEN;
  const histChars = converterHistorico(history, '').reduce((a, m) => a + tamMsg(m), 0);
  const reservaConversa = Math.max(totalChars * 0.3, Math.min(histChars, totalChars * 0.6));
  const maxSistemaChars = Math.floor(totalChars - reservaConversa);
  sistema = compactarSistema(sistema, maxSistemaChars);
  const mensagens = ajustarAoContexto(converterHistorico(history, sistema), totalChars, { maxSistemaChars });

  // v0.43.4: o servidor responde sempre em streaming, mesmo quando nada é exibido (run, cowork, subagentes,
  // workflows). Sem streaming a resposta só chegava inteira no fim, e o llamaCppTimeoutMs, que é de
  // inatividade, virava limite da geração toda: num celular, resposta com mais de 180 s falhava.
  const exibir = Boolean(onText) && cfg.enableStreaming !== false;
  const body = {
    model: modelName || cfg.llamaCppModel || 'local-model',
    messages: mensagens,
    temperature: Number.isFinite(cfg.llamaCppTemperature) ? cfg.llamaCppTemperature : 0.4,
    max_tokens: maxResp,
    stream: true,
  };
  if (declarations.length) body.tools = declarations;

  const tentar = async () => {
    try {
      return await pedir({ url, body, onText: exibir ? onText : undefined, timeoutMs });
    } catch (err) {
      if (err && err.rede === undefined && err.contexto === undefined && err.transitorio === undefined) throw erroConexao(err, base);
      throw err;
    }
  };

  let r;
  try {
    r = await tentar();
  } catch (err) {
    const autoStart = (process.env.LLAMACPP_AUTOSTART === '1' || cfg.llamaCppAutoStart === true) && localServer.enderecoLocal(base);
    const carregando = err.transitorio && /loading|carregando/i.test(err.message);
    if (err.rede && autoStart && !/sem resposta/.test(err.message)) {
      const res = await localServer.iniciar({ url: base, ctx, status, config: cfg, log: (m) => console.error(`[llama.cpp] ${m}`) });
      if (!res.ok) { const e = new Error(`[llama.cpp] ${res.mensagem}`); e.rede = true; throw e; }
      r = await tentar();
    } else if (carregando && await esperarPronto({ log: (m) => console.error(m) })) {
      r = await tentar();
    } else throw err;
  }

  const parts = [];
  let texto = r.texto;
  const chamadas = r.calls.map((c) => {
    let args = c.args;
    if (typeof args === 'string') { try { args = JSON.parse(args || '{}'); } catch { args = {}; } }
    return { name: c.name, args: args || {}, id: c.id };
  }).filter((c) => c.name);
  if (!chamadas.length) {
    const emTexto = extrairChamadasEmTexto(texto, compactas.tools);
    if (emTexto) {
      chamadas.push(...emTexto);
      texto = texto.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim();
      if (!r.jaEmitiu && texto && onText) onText(texto);
    }
  }
  if (texto) parts.push({ text: texto });
  for (const c of chamadas) parts.push({ functionCall: { name: c.name, args: c.args, ...(c.id ? { id: c.id } : {}) } });
  if (!parts.length) parts.push({ text: '' });
  if (!r.jaEmitiu && texto && onText && !chamadas.length) onText(texto);
  const resposta = respostaDePartes(parts);
  // Tamanho estimado do que foi enviado (para o auto-compact do chat).
  resposta.promptTokens = estimarTokens(JSON.stringify(mensagens)) + toolsTokens;
  return resposta;
}

/** Estado do servidor: 'pronto' | 'carregando' (HTTP 503 enquanto lê o GGUF) | 'offline'. */
async function status() {
  const cfg = loadConfig();
  const base = baseUrl(cfg);
  try {
    const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) });
    if (response.ok) return { ok: true, estado: 'pronto', url: base, status: response.status };
    const data = await response.json().catch(() => ({}));
    const msg = String(data.error?.message || '');
    return { ok: false, estado: response.status === 503 && /load/i.test(msg) ? 'carregando' : 'offline', url: base, status: response.status, error: msg || undefined };
  } catch (err) {
    return { ok: false, estado: 'offline', url: base, error: err.message };
  }
}

module.exports = {
  chatWithTools, status, baseUrl, converterHistorico, converterTools, normalizarSchema,
  ctxTamanho, estimarTokens, compactarTools, compactarSistema, ajustarAoContexto, extrairChamadasEmTexto, esperarPronto,
  lerStream, tamMsg,
};
