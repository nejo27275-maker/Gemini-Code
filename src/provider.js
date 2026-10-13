// src/provider.js
// Roteador online/local. O modo padrão usa llama.cpp sem Ollama; depois do download
// de um GGUF, a inferência local funciona sem internet. Com chave Gemini, o modo híbrido
// também pode enviar pedidos complexos à nuvem e fazer fallback se um lado cair.
// `modelName`: '@local', '@cloud', '@codeia', 'ollama:NOME' ou modelo Gemini explícito.
'use strict';

const { loadConfig } = require('./config');
const gemini = require('./gemini');
const ollama = require('./providers/ollama');
const llamacpp = require('./providers/llamacpp');
const codeia = require('./providers/codeia');
const usage = require('./usage');
const solo = require('./solo');

const PALAVRAS_PESADAS = /\b(refator\w*|arquitet\w*|debug\w*|depur\w*|otimiz\w*|analis\w*|analys\w*|migr\w*|segur\w*|vulnerab\w*|implement\w*|projet[eo]\w*|design|algoritm\w*|por ?que|explique em detalhe|revis[ea]\w*|performance|concorr\w*|race condition)\b/i;

/** Última mensagem de texto escrita pelo usuário (ignora resultados de ferramenta). */
function ultimoTextoDoUsuario(history) {
  for (let i = (history || []).length - 1; i >= 0; i--) {
    const t = history[i];
    if (t.role !== 'user') continue;
    const texto = (t.parts || []).filter((p) => typeof p.text === 'string').map((p) => p.text).join('');
    if (texto) return texto;
  }
  return '';
}

function tamanhoDoHistorico(history) {
  return JSON.stringify(history || []).length;
}

/** Heurística simples e previsível: o que vale a nuvem? */
function pedidoPesado(history, cfg) {
  const texto = ultimoTextoDoUsuario(history);
  const limite = Number(cfg.hybridComplexityChars) || 600;
  if (texto.length > limite) return true;
  if ((texto.match(/```/g) || []).length >= 2) return true;
  if (PALAVRAS_PESADAS.test(texto)) return true;
  // conversa já grande demais pro contexto do modelo local
  // v0.37.0: o modelo local é o llama.cpp (contexto próprio), não o Ollama.
  const numCtx = Number(cfg.llamaCppCtx) || 4096;
  if (tamanhoDoHistorico(history) > numCtx * 2.5) return true;
  return false;
}

function escolher({ cfg, modelName, history }) {
  // v0.39.0: modo solo — só o code-ia, não importa o que foi pedido (/cloud, /local, modelo explícito...).
  if (solo.ativo(cfg)) return { provider: 'code-ia', model: 'code-ia', motivo: 'modo solo' };
  if (modelName === '@codeia' || modelName === 'code-ia' || modelName === 'codeia') return { provider: 'code-ia', model: 'code-ia', motivo: 'forçado (/codeia)' };
  if (modelName === '@local') return { provider: 'llamacpp', model: cfg.llamaCppModel || 'local-model', motivo: 'forçado (/local)' };
  if (modelName === '@cloud') return { provider: 'gemini', model: cfg.model, motivo: 'forçado (/cloud)' };
  if (typeof modelName === 'string' && modelName.startsWith('llamacpp:')) {
    return { provider: 'llamacpp', model: modelName.slice('llamacpp:'.length) || cfg.llamaCppModel || 'local-model', motivo: 'modelo local llama.cpp explícito' };
  }
  if (typeof modelName === 'string' && modelName.startsWith('ollama:')) {
    return { provider: 'ollama', model: modelName.slice('ollama:'.length) || cfg.ollamaModel, motivo: 'modelo local explícito' };
  }
  if (modelName) return { provider: 'gemini', model: modelName, motivo: 'modelo explícito' };

  const modo = cfg.provider || 'hybrid';
  if (modo === 'code-ia') return { provider: 'code-ia', model: 'code-ia', motivo: 'provider=code-ia' };
  if (modo === 'ollama') return { provider: 'ollama', model: cfg.ollamaModel, motivo: 'provider=ollama (compatibilidade)' };
  if (modo === 'llamacpp') return { provider: 'llamacpp', model: cfg.llamaCppModel || 'local-model', motivo: 'provider=llamacpp' };
  if (modo === 'hybrid') {
    if (!cfg.apiKey) return { provider: 'llamacpp', model: cfg.llamaCppModel || 'local-model', motivo: 'sem API key: local via llama.cpp' };
    return pedidoPesado(history, cfg)
      ? { provider: 'gemini', model: cfg.model, motivo: 'pedido pesado: nuvem' }
      : { provider: 'llamacpp', model: cfg.llamaCppModel || 'local-model', motivo: 'pedido simples: local via llama.cpp' };
  }
  // Sem chave online, use um modelo generativo local em vez da base pré-indexada.
  if (!cfg.apiKey && cfg.codeIaAuto !== false) return { provider: 'llamacpp', model: cfg.llamaCppModel || 'local-model', motivo: 'sem API key: LLM local via llama.cpp' };
  return { provider: 'gemini', model: cfg.model, motivo: 'provider=gemini' };
}

function erroRecuperavel(err) {
  if (!err) return false;
  return Boolean(err.rede || err.transitorio || err.contexto || err.name === 'TypeError' || /cota da API atingida|Nenhuma API key/.test(err.message || ''));
}

async function chamar(escolha, args) {
  if (solo.ativo() && escolha.provider !== 'code-ia') throw solo.erroSolo(`chamada ao provedor ${escolha.provider}`);
  const fn = escolha.provider === 'code-ia' ? codeia.chatWithTools
    : escolha.provider === 'ollama' ? ollama.chatWithTools
      : escolha.provider === 'llamacpp' ? llamacpp.chatWithTools : gemini.chatWithTools;
  // v0.15.0: limite de tokens por sessão (só vale para a nuvem; local não gasta cota) e contagem de chamadas locais.
  if (escolha.provider === 'gemini') usage.checarLimite(loadConfig().maxTokensSessao);
  const r = await fn({ ...args, modelName: escolha.model });
  if (escolha.provider !== 'gemini') usage.registrar({ local: true, promptTokens: r && r.promptTokens });
  return r;
}

async function chatWithTools(args) {
  const cfg = loadConfig();
  const escolha = escolher({ cfg, modelName: args.modelName, history: args.history });
  if (process.env.GEMINI_CODE_DEBUG_ROUTER) console.error(`[router] ${escolha.provider}:${escolha.model} (${escolha.motivo})`);

  let emitiu = false;
  const onText = args.onText ? (t) => { emitiu = true; args.onText(t); } : undefined;
  const chamadaArgs = { ...args, onText };

  try {
    return await chamar(escolha, chamadaArgs);
  } catch (err) {
    // Só o modo híbrido troca de lado sozinho — e só se nada foi impresso
    // ainda (senão o texto sairia duplicado).
    const hibrido = (cfg.provider || 'hybrid') === 'hybrid' && !args.modelName;
    if (solo.ativo(cfg) || !hibrido || emitiu || !erroRecuperavel(err)) throw err;
    const outro = escolha.provider === 'gemini'
      ? { provider: 'llamacpp', model: cfg.llamaCppModel || 'local-model' }
      : cfg.apiKey ? { provider: 'gemini', model: cfg.model } : null;
    if (!outro) throw err;
    console.error(`[router] ${escolha.provider} indisponível (${String(err.message).split('\n')[0]}). Usando ${outro.provider}:${outro.model}.`);
    return chamar(outro, chamadaArgs);
  }
}

module.exports = { chatWithTools, escolher, pedidoPesado, ultimoTextoDoUsuario, erroRecuperavel };
