// src/usage.js
// Contador de uso de IA da sessão (v0.15.0): tokens REAIS que o Gemini informa (usageMetadata), chamadas locais
// (Ollama/code-ia, que não gastam cota) e um limite opcional por sessão. Fica só na memória do processo.
// Não guarda preço de propósito: tabelas de preço mudam; tokens são o dado confiável.
'use strict';

let est = novo();
let avisou = false;

function novo() { return { chamadas: 0, locais: 0, prompt: 0, saida: 0, ultimoPrompt: 0, ultimoLocal: false, porModelo: {} }; }
const n = (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Math.floor(Number(x)) : 0);

/** Registra uma chamada. `uso` = usageMetadata do Gemini ({promptTokenCount, candidatesTokenCount, totalTokenCount}). */
function registrar({ modelo = '?', uso, local = false, promptTokens = 0 } = {}) {
  if (local) {
    est.locais++;
    // v0.38.0: modelo local não gasta cota, mas o tamanho do prompt importa (contexto pequeno) — guarda para o auto-compact.
    if (n(promptTokens)) { est.ultimoPrompt = n(promptTokens); est.ultimoLocal = true; }
    return;
  }
  est.ultimoLocal = false;
  const prompt = n(uso && uso.promptTokenCount);
  const total = n(uso && uso.totalTokenCount);
  // total - prompt inclui os tokens de "pensamento", que também são cobrados como saída.
  const saida = total > prompt ? total - prompt : n(uso && uso.candidatesTokenCount);
  est.chamadas++;
  est.prompt += prompt;
  est.saida += saida;
  if (prompt) est.ultimoPrompt = prompt;
  const m = est.porModelo[modelo] || (est.porModelo[modelo] = { chamadas: 0, prompt: 0, saida: 0 });
  m.chamadas++; m.prompt += prompt; m.saida += saida;
}

function total() { return est.prompt + est.saida; }
function estado() { return JSON.parse(JSON.stringify(est)); }
function zerar() { est = novo(); avisou = false; }
const fmt = (x) => x.toLocaleString('pt-BR');

function resumo({ limite = 0 } = {}) {
  const linhas = [`Chamadas ao Gemini: ${est.chamadas} | tokens: ${fmt(est.prompt)} de entrada + ${fmt(est.saida)} de saída = ${fmt(total())}`];
  linhas.push(`Chamadas locais (Ollama/code-ia, sem custo): ${est.locais}`);
  if (est.ultimoPrompt) linhas.push(`Contexto da última chamada: ${fmt(est.ultimoPrompt)} tokens`);
  for (const [m, d] of Object.entries(est.porModelo)) linhas.push(`  ${m}: ${d.chamadas} chamada(s), ${fmt(d.prompt + d.saida)} tokens`);
  linhas.push(limite > 0 ? `Limite da sessão: ${fmt(total())} / ${fmt(limite)} tokens` : 'Limite da sessão: nenhum (defina maxTokensSessao na config).');
  return linhas.join('\n');
}

/** Lança se o limite foi estourado; avisa uma vez ao passar de 80%. Limite 0/ausente = sem limite. */
function checarLimite(limite) {
  const l = n(limite);
  if (!l) return;
  const t = total();
  if (t >= l) {
    const e = new Error(`Limite de tokens da sessão atingido (${fmt(t)}/${fmt(l)}). Opções: /compact, /local ou /codeia (sem custo), /custo zerar, ou aumente maxTokensSessao na config.`);
    e.orcamento = true;
    throw e;
  }
  if (!avisou && t >= l * 0.8) { avisou = true; console.error(`[custo] ${fmt(t)} de ${fmt(l)} tokens da sessão (80%+).`); }
}

// v0.41.0: depois de compactar, o tamanho da última chamada (a do resumo, no /compact ia) não vale mais para a
// conversa: sem isto o auto-compact rodava de novo logo no turno seguinte e apagava o resumo recém-feito.
function contextoCompactado() { est.ultimoPrompt = 0; }

/** O contexto da última chamada passou do limiar? (0 = desligado) */
function contextoGrande(limiar, { ctxLocal = 0 } = {}) {
  let l = n(limiar);
  if (l <= 0) return false; // 0 = desligado, vale para os dois casos
  // v0.38.0: se a última chamada foi no modelo local, o teto real é o contexto do servidor (compacta com 60% usado).
  if (est.ultimoLocal && n(ctxLocal)) l = Math.min(l, Math.floor(n(ctxLocal) * 0.6));
  return est.ultimoPrompt >= l;
}

module.exports = { registrar, total, estado, zerar, resumo, checarLimite, contextoGrande, contextoCompactado };
