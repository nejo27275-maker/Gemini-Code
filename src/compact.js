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

/** Resumo em texto de uma lista de mensagens. */
function resumir(msgs) {
  const pedidos = [];
  const ferramentas = new Map();
  const arquivos = new Set();
  let ultimaResposta = '';
  for (const m of msgs) {
    if (m.role === 'user' && !temParte(m, 'functionResponse')) {
      const t = textoDe(m);
      if (t && !t.startsWith('[Resumo da conversa')) pedidos.push(curto(t.replace(/\s+/g, ' '), 160));
    }
    for (const p of m.parts || []) {
      if (p && p.functionCall) {
        const { name, args } = p.functionCall;
        ferramentas.set(name, (ferramentas.get(name) || 0) + 1);
        if (args && typeof args.path === 'string') arquivos.add(args.path);
      }
    }
    if (m.role === 'model') { const t = textoDe(m); if (t) ultimaResposta = t; }
  }
  const linhas = ['[Resumo da conversa até aqui — as mensagens antigas foram compactadas]'];
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
  const ack = { role: 'model', parts: [{ text: 'Entendido. Continuo a partir deste resumo e das mensagens recentes.' }] };
  return { history: [resumo, ack, ...h.slice(corte)], removidas: antigas.length, compactou: true };
}

module.exports = { compactar, resumir };
