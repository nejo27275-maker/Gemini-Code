'use strict';
// v0.41.0: dentro de um pedido com dezenas de ferramentas seguidas, nada era podado (o corte
// só cai numa fala do usuário) e cada passo reenviava tudo. Agora os resultados antigos viram
// um aviso curto acima do orçamento; /compact ia pede o resumo ao modelo.
const fs = require('fs');
const os = require('os');
const path = require('path');
const HOME_FALSO = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-contexto-'));
process.env.HOME = HOME_FALSO;
process.env.USERPROFILE = HOME_FALSO;

const test = require('node:test');
const assert = require('node:assert/strict');
const { enxugarResultadosAntigos, compactarComModelo, PREFIXO_OMITIDO } = require('../src/compact');
const { runOnce } = require('../src/agent');

function conversaComFerramentas(n, tamanho) {
  const h = [{ role: 'user', parts: [{ text: 'tarefa longa' }] }];
  for (let i = 0; i < n; i++) {
    h.push({ role: 'model', parts: [{ functionCall: { name: 'read_file', args: { path: `f${i}` }, id: `c${i}` } }] });
    h.push({ role: 'user', parts: [{ functionResponse: { name: 'read_file', id: `c${i}`, response: { result: String(i % 10).repeat(tamanho) } } }] });
  }
  return h;
}

test('acima do orçamento, só os resultados antigos viram aviso; pares, ids e os 6 recentes ficam', () => {
  const h = conversaComFerramentas(20, 30000);
  const copia = JSON.stringify(h);
  const r = enxugarResultadosAntigos(h, { maxChars: 200000 });
  assert.equal(JSON.stringify(h), copia, 'não pode alterar o histórico recebido');
  assert.ok(JSON.stringify(r.history).length <= 200000, `ficou com ${JSON.stringify(r.history).length}`);
  assert.ok(r.enxugados >= 14);
  const respostas = r.history.flatMap((m) => m.parts).filter((p) => p.functionResponse);
  const chamadas = r.history.flatMap((m) => m.parts).filter((p) => p.functionCall);
  assert.equal(respostas.length, 20);
  assert.deepEqual(respostas.map((p) => p.functionResponse.id), chamadas.map((p) => p.functionCall.id));
  for (const p of respostas.slice(-6)) assert.equal(p.functionResponse.response.result.length, 30000, 'os 6 recentes ficam inteiros');
  assert.ok(respostas[0].functionResponse.response.result.startsWith(PREFIXO_OMITIDO));
  assert.match(respostas[0].functionResponse.response.result, /30000 caracteres/);
});

test('abaixo do orçamento ou com 0 (desligado), nada muda', () => {
  const h = conversaComFerramentas(3, 1000);
  assert.equal(enxugarResultadosAntigos(h, { maxChars: 300000 }).history, h);
  const grande = conversaComFerramentas(20, 30000);
  assert.equal(enxugarResultadosAntigos(grande, { maxChars: 0 }).enxugados, 0);
});

test('loop do agente: 15 leituras grandes seguidas não fazem o pedido crescer sem limite', async () => {
  const dir = fs.mkdtempSync(path.join(HOME_FALSO, 'arquivos-'));
  for (let i = 0; i < 15; i++) fs.writeFileSync(path.join(dir, `a${i}.txt`), `${i}`.repeat(40000));
  const tamanhos = [];
  let passo = 0;
  const resp = (calls, text = '') => ({ functionCalls: () => calls, text: () => text, rawParts: () => calls.map((c) => ({ functionCall: c })) });
  const modelo = async ({ history }) => {
    tamanhos.push(JSON.stringify(history).length);
    passo += 1;
    return passo <= 15 ? resp([{ name: 'read_file', args: { path: path.join(dir, `a${passo - 1}.txt`) }, id: `id${passo}` }]) : resp([], 'pronto');
  };
  const r = await runOnce('leia tudo', {
    deps: { chatWithTools: modelo, buildSystemInstruction: () => '', loadConfig: () => ({ contextoMaxChars: 150000 }) },
  });
  assert.equal(r.text, 'pronto');
  // Cada resultado já é cortado em 20 000 caracteres (cortarResultado); sem a poda, o último
  // pedido teria ~15 × 20 000 ≈ 305 000 caracteres (medido na v0.40.0).
  assert.ok(Math.max(...tamanhos) <= 150000, `maior pedido: ${Math.max(...tamanhos)}`);
  // O histórico devolvido continua completo (a poda vale só para o que é enviado).
  assert.ok(JSON.stringify(r.history).length > 290000);
});

test('/compact ia: usa o resumo do modelo; se o modelo falha, cai no resumo local', async () => {
  const h = [];
  for (let i = 0; i < 6; i++) {
    h.push({ role: 'user', parts: [{ text: `pedido ${i}` }] });
    h.push({ role: 'model', parts: [{ text: `resposta ${i}` }] });
  }
  let pedido = null;
  const r = await compactarComModelo(h, { manter: 4, chat: async (a) => { pedido = a; return { text: () => 'Objetivo: X. Decisões: Y.' }; } });
  assert.equal(r.compactou, true);
  assert.equal(r.comModelo, true);
  assert.deepEqual(pedido.tools, []);
  assert.match(r.history[0].parts[0].text, /feito pelo modelo\]\nObjetivo: X/);
  assert.equal(r.history.length, 2 + (h.length - r.removidas));
  const falha = await compactarComModelo(h, { manter: 4, chat: async () => { throw new Error('sem rede'); } });
  assert.equal(falha.compactou, true);
  assert.equal(falha.comModelo, false);
  assert.match(falha.history[0].parts[0].text, /^\[Resumo da conversa até aqui/);
  const curta = await compactarComModelo(h.slice(0, 2), { chat: async () => { throw new Error('não deveria chamar'); } });
  assert.equal(curta.compactou, false);
});
