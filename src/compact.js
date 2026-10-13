// src/compact.js
// /compact: em vez de só descartar o meio da conversa (podarHistorico), troca o começo por um RESUMO feito
// localmente (sem chamar modelo, sem custo): pedidos do usuário, ferramentas usadas, arquivos mexidos e a
// última resposta do modelo. Mantém as últimas mensagens inteiras e nunca separa chamada de ferramenta da resposta.
'use strict';

function temParte(msg, chave) {
  return Array.isArray(msg && msg.parts) && msg.parts.some((p) => p && p[chave]);
}
function textoDe(msg) {
  return ((msg && msg.parts) || []).filter((p) => p && typeof p.text === 'string').map((p) => p.text).join('').trim();
}
const curto = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

const ACK = 'Entendido. Continuo a partir deste resumo e das mensagens recentes.';
const MAX_RESUMO_ANTERIOR = 4000;

/** Resumo em texto de uma lista de mensagens. */
function resumir(msgs) {
  const pedidos = [];
  const ferramentas = new Map();
  const arquivos = new Set();
  let ultimaResposta = '';
  let anterior = '';
  for (const m of msgs) {
    if (m.role === 'user' && !temParte(m, 'functionResponse')) {
      const t = textoDe(m);
      // v0.41.0: um resumo anterior (do /compact ia, feito pelo modelo, ou do local) é levado adiante em vez
      // de descartado — antes a compactação seguinte apagava o resumo do modelo e o contexto antigo sumia.
      if (t.startsWith('[Resumo da conversa')) anterior = t.slice(t.indexOf('\n') + 1).trim();
      else if (t) pedidos.push(curto(t.replace(/\s+/g, ' '), 160));
    }
    for (const p of m.parts || []) {
      if (p && p.functionCall) {
        const { name, args } = p.functionCall;
        ferramentas.set(name, (ferramentas.get(name) || 0) + 1);
        if (args && typeof args.path === 'string') arquivos.add(args.path);
      }
    }
    if (m.role === 'model') { const t = textoDe(m); if (t && t !== ACK) ultimaResposta = t; }
  }
  const linhas = ['[Resumo da conversa até aqui — as mensagens antigas foram compactadas]'];
  if (anterior) linhas.push('Resumo anterior:', curto(anterior, MAX_RESUMO_ANTERIOR));
  if (pedidos.length) linhas.push('Pedidos do usuário:', ...pedidos.slice(-12).map((p, i) => `${i + 1}. ${p}`));
  if (ferramentas.size) linhas.push('Ferramentas usadas: ' + [...ferramentas].map(([n, c]) => `${n}×${c}`).join(', '));
  if (arquivos.size) linhas.push('Arquivos tocados: ' + [...arquivos].slice(-20).join(', '));
  if (ultimaResposta) linhas.push('Última resposta do modelo (trecho): ' + curto(ultimaResposta.replace(/\s+/g, ' '), 400));
  return linhas.join('\n');
}

/**
 * @returns {{ history: object[], removidas: number, compactou: boolean }}
 * `manter` = quantas mensagens recentes ficam inteiras (o corte recua até uma fala de texto do usuário).
 */
function compactar(history, { manter = 6 } = {}) {
  const h = Array.isArray(history) ? history : [];
  if (h.length <= manter + 2) return { history: h, removidas: 0, compactou: false };
  let corte = h.length - manter;
  while (corte > 0 && (h[corte].role !== 'user' || temParte(h[corte], 'functionResponse'))) corte--;
  if (corte <= 1) return { history: h, removidas: 0, compactou: false };
  const antigas = h.slice(0, corte);
  const resumo = { role: 'user', parts: [{ text: resumir(antigas) }] };
  const ack = { role: 'model', parts: [{ text: ACK }] };
  return { history: [resumo, ack, ...h.slice(corte)], removidas: antigas.length, compactou: true };
}

// ---------------------------------------------------------------------------
// v0.41.0 — contexto DENTRO de um pedido longo
// podarHistorico só corta numa fala de texto do usuário; numa tarefa de dezenas de
// ferramentas seguidas não há esse ponto, e cada chamada reenviava tudo (medido: 103
// mensagens, ~1 MB). Agora, acima do orçamento, os resultados de ferramenta ANTIGOS viram
// um aviso curto (os mais recentes ficam inteiros). Os pares chamada/resposta e os ids
// continuam, então a API aceita; o modelo pode chamar a ferramenta de novo se precisar.
// ---------------------------------------------------------------------------

const PREFIXO_OMITIDO = '[resultado antigo de ';
// Imagem (inlineData, base64 de até 15 MB) conta como ~3000 caracteres, como em llamacpp.tamConteudo: o modelo
// a vê como algumas centenas de tokens, e contar o base64 apagava resultados de ferramenta numa conversa curta.
const IMAGEM_EQUIVALE = 'x'.repeat(3000);
const tamanhoDe = (v) => JSON.stringify(v, (k, x) => (k === 'inlineData' && x && typeof x.data === 'string' ? IMAGEM_EQUIVALE : x)).length;

/** @returns {{ history: object[], enxugados: number }} sem alterar o histórico recebido. */
function enxugarResultadosAntigos(history, { maxChars = 300000, manterRecentes = 6 } = {}) {
  const h = Array.isArray(history) ? history : [];
  if (!maxChars || maxChars <= 0) return { history: h, enxugados: 0 };
  let total = tamanhoDe(h);
  if (total <= maxChars) return { history: h, enxugados: 0 };
  const posicoes = [];
  h.forEach((m, i) => (m.parts || []).forEach((p, j) => { if (p && p.functionResponse) posicoes.push([i, j]); }));
  const candidatos = posicoes.slice(0, Math.max(0, posicoes.length - manterRecentes));
  const novo = h.slice();
  let enxugados = 0;
  for (const [i, j] of candidatos) {
    if (total <= maxChars) break;
    if (novo[i] === h[i]) novo[i] = { ...h[i], parts: h[i].parts.slice() };
    const fr = novo[i].parts[j].functionResponse;
    const res = fr.response && fr.response.result !== undefined ? fr.response.result : fr.response;
    const texto = typeof res === 'string' ? res : JSON.stringify(res === undefined ? '' : res);
    if (texto.length < 400 || texto.startsWith(PREFIXO_OMITIDO)) continue;
    const aviso = `${PREFIXO_OMITIDO}${fr.name} omitido para economizar contexto (${texto.length} caracteres); chame a ferramenta de novo se precisar dele]`;
    const antes = tamanhoDe(novo[i].parts[j]);
    novo[i].parts[j] = { functionResponse: { ...fr, response: { result: aviso } } };
    total -= antes - tamanhoDe(novo[i].parts[j]);
    enxugados++;
  }
  return { history: novo, enxugados };
}

const INSTRUCAO_RESUMO =
  'Resuma a conversa abaixo para que outro assistente continue o trabalho sem ela. Em português, até 400 palavras, ' +
  'nestas seções: Objetivo; Decisões tomadas; Arquivos criados/alterados e estado atual; O que falta fazer; ' +
  'Fatos importantes (nomes, caminhos, comandos, erros). Não invente nada que não esteja na conversa.';

/**
 * /compact ia: o PRÓPRIO modelo resume as mensagens antigas (perde menos que o resumo local,
 * que só lista pedidos, ferramentas e arquivos). Custa uma chamada. Se o modelo falhar ou
 * devolver vazio, usa o resumo local — compactar nunca piora a conversa.
 * @returns {Promise<{ history, removidas, compactou, comModelo }>}
 */
async function compactarComModelo(history, { chat, manter = 6 } = {}) {
  const h = Array.isArray(history) ? history : [];
  const local = compactar(h, { manter });
  if (!local.compactou) return { ...local, comModelo: false };
  const antigas = h.slice(0, local.removidas);
  let texto = '';
  try {
    const r = await chat({
      systemInstruction: INSTRUCAO_RESUMO,
      history: [...antigas, { role: 'user', parts: [{ text: 'Faça agora o resumo pedido nas instruções.' }] }],
      tools: [],
    });
    texto = String((r && r.text && r.text()) || '').trim();
  } catch { /* cai no resumo local */ }
  if (!texto) return { ...local, comModelo: false };
  // O resumo local vai junto: com contexto pequeno (llama.cpp) o modelo só recebe o FIM das mensagens antigas
  // e resumiria só isso; com os dois, /compact ia nunca perde o que o /compact local guardaria.
  const doLocal = local.history[0].parts[0].text.replace(/^[^\n]*\n?/, '');
  const resumo = { role: 'user', parts: [{ text: `[Resumo da conversa até aqui, feito pelo modelo]\n${texto}${doLocal ? `\n\nRegistro local das mensagens compactadas:\n${doLocal}` : ''}` }] };
  const ack = { role: 'model', parts: [{ text: ACK }] };
  return { history: [resumo, ack, ...h.slice(local.removidas)], removidas: local.removidas, compactou: true, comModelo: true };
}

module.exports = { compactar, resumir, enxugarResultadosAntigos, compactarComModelo, PREFIXO_OMITIDO };
