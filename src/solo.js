// src/solo.js (v0.39.0)
// Modo SOLO: o code-ia roda sozinho, sem nenhuma outra IA por trás (nem Gemini, nem llama.cpp, nem Ollama,
// nem APIs de terceiros). Três travas independentes, para que um esquecimento numa não vaze:
//   1) o roteador (src/provider.js) escolhe SEMPRE o code-ia e nunca troca de lado;
//   2) comandos que dependem de outra IA (design, media, live, models, ollama, llamacpp start) são recusados;
//   3) guarda de rede: qualquer fetch para um serviço de IA conhecido, ou para o endereço configurado do
//      llama.cpp/Ollama, é bloqueado antes de sair do processo.
// Liga com `gemini-code solo on`; desliga com `gemini-code solo off`. Env: GEMINI_CODE_SOLO=1 (força ligado) / 0.
'use strict';

const HOSTS_IA = /(^|\.)(generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com|api\.openai\.com|api\.anthropic\.com|openrouter\.ai|api\.groq\.com|api\.mistral\.ai|api\.together\.xyz|api\.deepseek\.com|api\.x\.ai|api-inference\.huggingface\.co)$/i;

function cfgAtual(cfg) {
  if (cfg) return cfg;
  try { return require('./config').loadConfig(); } catch { return {}; }
}

function ativo(cfg) {
  if (process.env.GEMINI_CODE_SOLO === '1') return true;
  if (process.env.GEMINI_CODE_SOLO === '0') return false;
  return cfgAtual(cfg).modoSolo === true;
}

/** Texto explicando por que o destino é bloqueado, ou null se pode. */
function destinoDeIA(url, cfg) {
  let u;
  try { u = new URL(String((url && url.url) || url)); } catch { return null; }
  if (HOSTS_IA.test(u.hostname)) return `serviço de IA online (${u.hostname})`;
  const c = cfgAtual(cfg);
  for (const alvo of [process.env.LLAMACPP_URL, c.llamaCppUrl, process.env.OLLAMA_URL, c.ollamaUrl]) {
    if (!alvo) continue;
    try {
      const o = new URL(/^https?:\/\//i.test(alvo) ? alvo : `http://${alvo}`);
      if (o.origin === u.origin) return `modelo local (${o.host})`;
    } catch { /* endereço inválido no config: ignora */ }
  }
  return null;
}

function erroSolo(motivo) {
  const e = new Error(`[solo] bloqueado: ${motivo}. O modo solo usa só o code-ia, sem nenhuma outra IA. Para sair: gemini-code solo off`);
  e.solo = true;
  return e;
}

/** Lança se o modo solo está ligado (use antes de qualquer recurso que dependa de outra IA). */
function exigirDesligado(recurso, cfg) {
  if (ativo(cfg)) throw erroSolo(recurso);
}

/** Embrulha o fetch global (uma vez). O teste de rede só acontece com o solo ligado. */
function instalarGuarda() {
  if (!globalThis.fetch || globalThis.fetch.__solo) return false;
  const original = globalThis.fetch;
  const guardado = function fetchSolo(input, init) {
    if (ativo()) {
      const motivo = destinoDeIA(input);
      if (motivo) return Promise.reject(erroSolo(`acesso a ${motivo}`));
    }
    return original.call(this, input, init);
  };
  guardado.__solo = true;
  globalThis.fetch = guardado;
  return true;
}

module.exports = { ativo, destinoDeIA, exigirDesligado, instalarGuarda, erroSolo, HOSTS_IA };
