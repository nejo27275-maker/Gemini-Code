// src/configCommands.js (v0.31.0)
// Comandos simples `gemini-code config set-*` fora do bin/gemini-code.js, para poderem ser testados sem abrir o
// terminal. Devolve a linha de texto pronta, ou null se o subcomando não é um destes (o bin trata o resto:
// set-key, passphrases, unlock, show). Novidade: endereços (URL) agora são validados antes de salvar.
'use strict';

const PROVEDORES = ['gemini', 'openai', 'ollama', 'llamacpp', 'code-ia', 'hybrid'];

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
  'set-openai-url': { campo: 'openaiBaseUrl', url: true, ok: (v) => `API compatível com OpenAI: ${v}`, uso: 'gemini-code config set-openai-url https://openrouter.ai/api/v1' },
  'set-openai-model': { campo: 'openaiModel', ok: (v) => `Modelo da API OpenAI-compatível: ${v}`, uso: 'gemini-code config set-openai-model NOME (ex.: anthropic/claude-sonnet-4.5 no OpenRouter)' },
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
  // v0.41.0: regras de permissão (src/permissions.js). Só o usuário muda: o config.json é protegido do modelo.
  if (sub === 'permitir' || sub === 'negar' || sub === 'remover-regra' || sub === 'regras') {
    const { loadConfig } = require('./config');
    const atuais = loadConfig().permissoes || {};
    const perm = { permitir: [...(atuais.permitir || [])], negar: [...(atuais.negar || [])] };
    if (sub === 'regras') {
      return [`negar: ${perm.negar.length ? perm.negar.join(' | ') : '(nenhuma)'}`,
        `permitir: ${perm.permitir.length ? perm.permitir.join(' | ') : '(nenhuma)'}`].join('\n');
    }
    const regra = a.join(' ').trim();
    if (!regra) return `Uso: gemini-code config ${sub} "FERRAMENTA(PADRÃO)"   ex.: config negar "run_shell(git push*)"`;
    if (sub === 'remover-regra') {
      const antes = perm.permitir.length + perm.negar.length;
      perm.permitir = perm.permitir.filter((r) => r !== regra);
      perm.negar = perm.negar.filter((r) => r !== regra);
      if (perm.permitir.length + perm.negar.length === antes) return `Regra não encontrada: ${regra}`;
      saveConfig({ permissoes: perm });
      return `Regra removida: ${regra}`;
    }
    const erro = require('./permissions').validar(regra);
    if (erro) return erro;
    if (sub === 'permitir' && !/\(.+\)$/.test(regra)) return 'Em "permitir", informe o padrão do comando: config permitir "run_shell(npm test*)" (liberar o shell inteiro é o mesmo que desligar a confirmação).';
    if (!perm[sub].includes(regra)) perm[sub].push(regra);
    saveConfig({ permissoes: perm });
    return sub === 'negar' ? `Regra de bloqueio adicionada: ${regra}` : `Regra de permissão adicionada: ${regra} (só comandos simples; destrutivos continuam pedindo confirmação)`;
  }
  if (sub === 'set-openai-key') {
    if (!a[0] || /\s/.test(a[0])) return 'Uso: gemini-code config set-openai-key SUA_CHAVE (ou defina GEMINI_CODE_OPENAI_KEY)';
    saveConfig({ openaiApiKey: a[0] });
    return 'Chave da API OpenAI-compatível salva (só seu usuário lê o config; o modelo não consegue ler).';
  }
  if (sub === 'set-hybrid-cloud') {
    if (!['gemini', 'openai'].includes(a[0])) return 'Uso: gemini-code config set-hybrid-cloud gemini|openai';
    saveConfig({ hybridCloud: a[0] });
    return `Lado nuvem do modo hybrid: ${a[0]}.`;
  }
  if (sub === 'set-provider') {
    if (require('./solo').ativo() && a[0] !== 'code-ia') return 'Modo solo ligado: só o code-ia é usado. Para trocar de provedor, rode antes: gemini-code solo off';
    if (!PROVEDORES.includes(a[0])) return 'Uso: gemini-code config set-provider hybrid|llamacpp|gemini|openai|ollama|code-ia';
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
