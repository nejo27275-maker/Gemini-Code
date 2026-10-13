// src/configCommands.js (v0.31.0)
// Comandos simples `gemini-code config set-*` fora do bin/gemini-code.js, para poderem ser testados sem abrir o
// terminal. Devolve a linha de texto pronta, ou null se o subcomando não é um destes (o bin trata o resto:
// set-key, passphrases, unlock, show). Novidade: endereços (URL) agora são validados antes de salvar.
'use strict';

const PROVEDORES = ['gemini', 'ollama', 'llamacpp', 'code-ia', 'hybrid'];

function urlValida(v) {
  if (typeof v !== 'string') return false;
  try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
}

const SETTERS = {
  'set-model': { campo: 'model', ok: (v) => `Modelo principal definido: ${v}`, uso: 'gemini-code config set-model NOME' },
  'set-fast-model': { campo: 'fastModel', ok: (v) => `Modelo rápido definido: ${v}`, uso: 'gemini-code config set-fast-model NOME' },
  'set-llamacpp-model': { campo: 'llamaCppModel', ok: (v) => `Modelo llama.cpp definido: ${v}`, uso: 'gemini-code config set-llamacpp-model local-model' },
  'set-llamacpp-path': { campo: 'llamaCppModelPath', ok: (v) => `Arquivo GGUF local definido: ${v}`, uso: 'gemini-code config set-llamacpp-path /caminho/para/modelo.gguf' },
  'set-ollama-model': { campo: 'ollamaModel', ok: (v) => `Modelo local definido: ${v}`, uso: 'gemini-code config set-ollama-model NOME (ex.: qwen3:4b-instruct)' },
  'set-llamacpp-url': { campo: 'llamaCppUrl', url: true, ok: (v) => `Endereço do llama.cpp definido: ${v}`, uso: 'gemini-code config set-llamacpp-url http://127.0.0.1:8080' },
  'set-ollama-url': { campo: 'ollamaUrl', url: true, ok: (v) => `Endereço do Ollama definido: ${v}`, uso: 'gemini-code config set-ollama-url http://127.0.0.1:11434' },
};

/** @returns {string|null} texto para mostrar, ou null se `sub` não é daqui. */
function aplicar(sub, args, saveConfig) {
  const a = Array.isArray(args) ? args : [];
  if (SETTERS[sub]) {
    const s = SETTERS[sub];
    if (!a[0] || (sub === 'set-llamacpp-path' && (a[0].includes('\0') || /[\r\n]/.test(a[0])))) return `Uso: ${s.uso}`;
    if (s.url && !urlValida(a[0])) return `Endereço inválido: "${a[0]}" (precisa começar com http:// ou https://).\nUso: ${s.uso}`;
    saveConfig({ [s.campo]: a[0] });
    return s.ok(a[0]);
  }
  if (sub === 'set-fallback-model') {
    saveConfig({ fallbackModel: a[0] || '' });
    return a[0] ? `Modelo reserva definido: ${a[0]}` : 'Modelo reserva desligado.';
  }
  if (sub === 'set-provider') {
    if (require('./solo').ativo() && a[0] !== 'code-ia') return 'Modo solo ligado: só o code-ia é usado. Para trocar de provedor, rode antes: gemini-code solo off';
    if (!PROVEDORES.includes(a[0])) return 'Uso: gemini-code config set-provider hybrid|llamacpp|gemini|ollama|code-ia';
    saveConfig({ provider: a[0] });
    return `Provedor definido: ${a[0]}`;
  }
  if (sub === 'set-wait-quota') {
    const n = Number(a[0]);
    if (a[0] === undefined || !Number.isFinite(n) || n < 0 || n > 300) return 'Uso: config set-wait-quota SEGUNDOS (0 desliga; máximo 300). Ex.: 60';
    saveConfig({ esperarCotaSegundos: Math.floor(n) });
    return n > 0 ? `Cota por minuto (429): espera até ${Math.floor(n)}s e repete UMA vez.` : 'Espera automática do 429 desligada.';
  }
  if (sub === 'set-llamacpp-ctx') {
    const n = Number(a[0]);
    if (a[0] === undefined || !Number.isInteger(n) || n < 1024 || n > 131072) return 'Uso: config set-llamacpp-ctx TOKENS (1024 a 131072; precisa ser o mesmo do servidor). Ex.: 4096';
    saveConfig({ llamaCppCtx: n });
    return `Contexto do llama.cpp definido: ${n} tokens. Reinicie o servidor com LLAMA_CTX=${n} (gemini-code llamacpp stop && gemini-code llamacpp start).`;
  }
  if (sub === 'set-llamacpp-autostart') {
    if (!['on', 'off'].includes(a[0])) return 'Uso: config set-llamacpp-autostart on|off';
    saveConfig({ llamaCppAutoStart: a[0] === 'on' });
    return a[0] === 'on' ? 'Servidor local sobe sozinho quando o chat precisar dele.' : 'Servidor local só sobe com: gemini-code llamacpp start.';
  }
  return null;
}

module.exports = { aplicar, urlValida, PROVEDORES };
