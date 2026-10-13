'use strict';
// v0.21.0: tokens por passo e orçamento ("maxTokens") do workflow, com parada que permite retomar.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const wf = require('../src/tools/workflowTools');
const usage = require('../src/usage');
const { runWorkflowData } = require('../src/agents/runner');

function pasta(arquivos = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-wf21-'));
  for (const [n, c] of Object.entries(arquivos)) fs.writeFileSync(path.join(d, n), typeof c === 'string' ? c : JSON.stringify(c));
  wf.definirPasta(d);
  return d;
}
const quieto = async (fn) => { const log = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = log; } };
// runOnce falso que "gasta" tokens de verdade no contador da sessão, como o gemini.js faria
const gasta = (n) => async (p) => { usage.registrar({ modelo: 'm', uso: { promptTokenCount: n / 2, totalTokenCount: n } }); return { text: `R:${p}`, history: [] }; };

test('tokens por passo aparecem nos resultados (só quando houve gasto) e o modelo local conta zero', async () => {
  usage.zerar();
  const r = await quieto(() => runWorkflowData({ steps: [{ id: 'a', prompt: 'a' }, { id: 'b', prompt: 'b' }] }, {
    runOnce: async (p) => (p === 'a' ? gasta(1000)(p) : { text: 'local', history: [] }),
  }));
  assert.equal(r.results[0].tokens, 1000);
  assert.equal('tokens' in r.results[1], false);
});

test('tokens de tentativas que falharam também contam no passo', async () => {
  usage.zerar();
  let n = 0;
  const r = await quieto(() => runWorkflowData({ steps: [{ id: 'a', prompt: 'a', retry: 1 }] }, {
    runOnce: async (p) => { n++; usage.registrar({ modelo: 'm', uso: { promptTokenCount: 100, totalTokenCount: 300 } }); if (n === 1) throw new Error('x'); return { text: 'ok', history: [] }; },
  }));
  assert.equal(r.results[0].tokens, 600);
  assert.equal(r.results[0].tentativas, 2);
});

test('maxTokens: para ANTES do passo que estouraria, com índice e contexto no erro', async () => {
  usage.zerar();
  const chamadas = [];
  const run = async (p) => { chamadas.push(p); return gasta(1000)(p); };
  let erro;
  try { await quieto(() => runWorkflowData({ maxTokens: 1500, steps: [{ id: 'a', prompt: 'a' }, { id: 'b', prompt: 'b {{a}}' }, { id: 'c', prompt: 'c' }] }, { runOnce: run })); } catch (e) { erro = e; }
  assert.deepEqual(chamadas, ['a', 'b R:a'], 'a roda (0<1500), b roda (1000<1500), c é barrado (2000>=1500)');
  assert.equal(erro.orcamento, true);
  assert.equal(erro.step, 'c');
  assert.equal(erro.indice, 2);
  assert.match(erro.message, /orçamento de tokens do workflow estourado \(2000\/1500\) antes do passo "c"/);
  assert.equal(erro.ctx.b, 'R:b R:a');
});

test('o orçamento conta só ESTA execução (não o que a sessão já gastou antes) e sem maxTokens nada é barrado', async () => {
  usage.zerar();
  usage.registrar({ modelo: 'm', uso: { promptTokenCount: 50000, totalTokenCount: 100000 } });
  const r = await quieto(() => runWorkflowData({ maxTokens: 1500, steps: [{ id: 'a', prompt: 'a' }] }, { runOnce: gasta(1000) }));
  assert.equal(r.results.length, 1);
  const r2 = await quieto(() => runWorkflowData({ steps: [{ id: 'a', prompt: 'a' }, { id: 'b', prompt: 'b' }] }, { runOnce: gasta(999999) }));
  assert.equal(r2.results.length, 2);
});

test('passo pulado por when não é barrado pelo orçamento nem gasta tokens', async () => {
  usage.zerar();
  const r = await quieto(() => runWorkflowData({ maxTokens: 500, steps: [{ id: 'a', prompt: 'a', when: '{{nada}}' }] }, { runOnce: gasta(1000) }));
  assert.equal(r.results[0].pulado, true);
});

test('run_workflow: estouro salva o progresso, explica e retomar recomeça o orçamento; resumo mostra tokens', async () => {
  usage.zerar();
  pasta({ 'o.json': { name: 'o', description: 'd', maxTokens: 1500, steps: [{ id: 'a', prompt: 'a' }, { id: 'b', prompt: 'b' }, { id: 'c', prompt: 'c' }] } });
  const r1 = await quieto(() => wf.execute('run_workflow', { name: 'o' }, { runOnceFn: gasta(1000) }));
  assert.match(r1, /estourado \(2000\/1500\) antes do passo "c"/);
  assert.match(r1, /passos que já tinham rodado: a, b/);
  assert.match(r1, /retomar: true/);
  assert.match(r1, /orçamento recomeça do zero/);
  const vistos = [];
  const r2 = await quieto(() => wf.execute('run_workflow', { name: 'o', retomar: true }, { runOnceFn: async (p) => { vistos.push(p); return gasta(300)(p); } }));
  assert.deepEqual(vistos, ['c']);
  assert.match(r2, /concluído \(3 passos\)/);
  assert.match(r2, /Tokens do Gemini neste workflow: 2\.300 \(a 1\.000, b 1\.000, c 300\)/);
});

test('maxTokens inválido é recusado e o validador aponta; mudar maxTokens NÃO invalida a retomada', async () => {
  usage.zerar();
  const d = pasta({ 'x.json': { name: 'x', steps: [{ id: 'a', prompt: 'a' }], maxTokens: -5 } });
  assert.match(await wf.execute('run_workflow', { name: 'x' }), /"maxTokens" precisa ser/);
  assert.ok(wf.validarWorkflow({ description: 'd', maxTokens: 1.5, steps: [{ id: 'a', prompt: 'a' }] }).erros.some((e) => /maxTokens/.test(e)));
  assert.deepEqual(wf.validarWorkflow({ description: 'd', maxTokens: 20000, steps: [{ id: 'a', prompt: 'a' }] }).erros, []);

  const W = { name: 'y', description: 'd', maxTokens: 500, steps: [{ id: 'a', prompt: 'a' }, { id: 'b', prompt: 'b' }] };
  fs.writeFileSync(path.join(d, 'y.json'), JSON.stringify(W));
  await quieto(() => wf.execute('run_workflow', { name: 'y' }, { runOnceFn: gasta(1000) }));
  fs.writeFileSync(path.join(d, 'y.json'), JSON.stringify({ ...W, maxTokens: 50000 }));
  const r = await quieto(() => wf.execute('run_workflow', { name: 'y', retomar: true }, { runOnceFn: gasta(10) }));
  assert.match(r, /concluído \(2 passos\)/);
});
