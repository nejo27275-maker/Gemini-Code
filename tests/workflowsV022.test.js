'use strict';
// v0.22.0: passo com "each" — repete o prompt para cada linha de uma lista (máx. 10), com {{item}} e {{indice}}.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const wf = require('../src/tools/workflowTools');
const usage = require('../src/usage');
const { runWorkflowData, extrairItens, analisarVariaveis, MAX_ITENS } = require('../src/agents/runner');

function pasta(arquivos = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-wf22-'));
  for (const [n, c] of Object.entries(arquivos)) fs.writeFileSync(path.join(d, n), typeof c === 'string' ? c : JSON.stringify(c));
  wf.definirPasta(d);
  return d;
}
const quieto = async (fn) => { const log = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = log; } };

test('extrairItens: tira marcadores (-, *, •, 1., 2)), linhas vazias e [falhou:; respeita o limite de 10', () => {
  const t = '- a.js\n* b.js\n• c.js\n1. d.js\n2) e.js\n\n   \n[falhou: x]\nf.js';
  assert.deepEqual(extrairItens(t).itens, ['a.js', 'b.js', 'c.js', 'd.js', 'e.js', 'f.js']);
  const muitos = Array.from({ length: 25 }, (_, i) => `i${i}`).join('\n');
  const r = extrairItens(muitos);
  assert.equal(r.itens.length, MAX_ITENS);
  assert.equal(r.total, 25);
  assert.equal(extrairItens(muitos, 3).itens.length, 3);
  assert.equal(extrairItens(muitos, 99).itens.length, 10, 'maxItens acima de 10 é cortado em 10');
  assert.deepEqual(extrairItens('').itens, []);
});

test('each: roda o prompt uma vez por item com {{item}}/{{indice}} e junta as saídas para o próximo passo', async () => {
  const prompts = [];
  const runOnce = async (p) => { prompts.push(p); return { text: p.startsWith('lista') ? '- a.js\n- b.js\n- c.js' : `ok(${p})`, history: [] }; };
  const r = await quieto(() => runWorkflowData({ steps: [
    { id: 'arquivos', prompt: 'lista os arquivos' },
    { id: 'revisao', prompt: 'revise {{item}} (#{{indice}})', each: '{{arquivos}}' },
    { id: 'final', prompt: 'resuma:\n{{revisao}}' },
  ] }, { runOnce }));
  assert.deepEqual(prompts.slice(1, 4), ['revise a.js (#1)', 'revise b.js (#2)', 'revise c.js (#3)']);
  assert.equal(r.results[1].itens, 3);
  assert.match(r.results[1].output, /--- 1\. a\.js ---\nok\(revise a\.js \(#1\)\)\n\n--- 2\. b\.js ---/);
  assert.match(prompts[4], /^resuma:\n--- 1\. a\.js ---/);
});

test('each com lista vazia: pula sem gastar IA; item que falha derruba o passo (ou vira [falhou] se optional)', async () => {
  let chamadas = 0;
  const r = await quieto(() => runWorkflowData({ steps: [{ id: 'x', prompt: 'p {{item}}', each: '{{nada}}' }] }, { runOnce: async () => { chamadas++; return { text: 'x', history: [] }; } }));
  assert.equal(r.results[0].pulado, true);
  assert.equal(chamadas, 0);

  const falha2 = async (p) => { if (p.includes('b')) throw new Error('quota'); return { text: 'ok', history: [] }; };
  const wfD = (extra) => ({ steps: [{ id: 'l', prompt: 'l' }, { id: 'r', prompt: 'r {{item}}', each: '{{l}}', ...extra }] });
  const run = (extra) => runWorkflowData(wfD(extra), { runOnce: async (p) => (p === 'l' ? { text: 'a\nb\nc', history: [] } : falha2(p)) });
  await assert.rejects(quieto(() => run({})), /passo "r" falhou no item 2 de 3 \("b"\): quota/);
  const ok = await quieto(() => run({ optional: true }));
  assert.equal(ok.results[1].falhasItens, 1);
  assert.match(ok.results[1].output, /--- 2\. b ---\n\[falhou: quota\]/);
  assert.match(ok.results[1].output, /--- 3\. c ---\nok/);
});

test('each + retry: cada item tem as suas tentativas', async () => {
  const vistos = {};
  const run = async (p) => {
    if (p === 'l') return { text: 'a\nb', history: [] };
    vistos[p] = (vistos[p] || 0) + 1;
    if (p === 'r a' && vistos[p] < 3) throw new Error('503');
    return { text: 'ok', history: [] };
  };
  const r = await quieto(() => runWorkflowData({ steps: [{ id: 'l', prompt: 'l' }, { id: 'r', prompt: 'r {{item}}', each: '{{l}}', retry: 2 }] }, { runOnce: run }));
  assert.equal(vistos['r a'], 3);
  assert.equal(vistos['r b'], 1);
  assert.equal(r.results[1].itens, 2);
});

test('each + maxTokens: o orçamento é checado antes de CADA item e o erro permite retomar', async () => {
  usage.zerar();
  const gasta = (n) => async (p) => { usage.registrar({ modelo: 'm', uso: { promptTokenCount: n / 2, totalTokenCount: n } }); return { text: p === 'l' ? 'a\nb\nc\nd' : 'ok', history: [] }; };
  let erro;
  try { await quieto(() => runWorkflowData({ maxTokens: 2500, steps: [{ id: 'l', prompt: 'l' }, { id: 'r', prompt: 'r {{item}}', each: '{{l}}' }] }, { runOnce: gasta(1000) })); } catch (e) { erro = e; }
  assert.equal(erro.orcamento, true);
  assert.equal(erro.indice, 1);
  assert.match(erro.message, /no passo "r", item 3 de 4 \(ao retomar, continua do item 3\)/);
});

test('analisarVariaveis: {{item}} e {{indice}} são do laço (não viram variável obrigatória) e o each é lido', () => {
  const r = analisarVariaveis({ steps: [{ id: 'l', prompt: 'x' }, { id: 'r', prompt: '{{item}} {{indice}} {{alvo}}', each: '{{l}}' }] });
  assert.deepEqual(r.obrigatorias, ['alvo']);
  const f = analisarVariaveis({ steps: [{ id: 'r', prompt: '{{item}}', each: '{{depois}}' }, { id: 'depois', prompt: 'x' }] });
  assert.equal(f.futuras.length, 1);
  assert.deepEqual(analisarVariaveis({ steps: [{ id: 'r', prompt: 'sem item', each: '{{lista}}' }] }).obrigatorias, ['lista']);
});

test('validação: each/maxItens inválidos; aviso se o prompt não usa {{item}}; run_workflow resume os itens', async () => {
  pasta({ 'a.json': { name: 'a', steps: [{ id: 'a', prompt: 'x', each: 5 }] }, 'b.json': { name: 'b', steps: [{ id: 'a', prompt: 'x', each: '{{l}}', maxItens: 50 }] } });
  assert.match(await wf.execute('run_workflow', { name: 'a' }), /"each" inválido/);
  assert.match(await wf.execute('run_workflow', { name: 'b' }), /"maxItens" inválido/);
  const v = wf.validarWorkflow({ description: 'd', steps: [{ id: 'l', prompt: 'l' }, { id: 'r', prompt: 'sem item', each: '{{l}}', keepHistory: true }] });
  assert.deepEqual(v.erros, []);
  assert.ok(v.avisos.some((a) => /não usa \{\{item\}\}/.test(a)));
  assert.ok(v.avisos.some((a) => /keepHistory.*ignorado/.test(a)));
  assert.ok(wf.validarWorkflow({ description: 'd', steps: [{ id: 'r', prompt: '{{item}}', each: '{{l}}', maxItens: 0 }] }).erros.some((e) => /maxItens/.test(e)));

  pasta({ 'ok.json': { name: 'ok', description: 'd', steps: [{ id: 'l', prompt: 'l' }, { id: 'r', prompt: 'r {{item}}', each: '{{l}}' }] } });
  const out = await quieto(() => wf.execute('run_workflow', { name: 'ok' }, { runOnceFn: async (p) => ({ text: p === 'l' ? 'x\ny' : 'ok', history: [] }) }));
  assert.match(out, /Resultado final \(r\):\n--- 1\. x ---/);
  assert.match(out, /- l: x y/);
});
