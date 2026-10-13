'use strict';
// v0.25.1: "paralelo" (1 a 3) no passo com "each": itens em lotes, na ordem, só com ferramentas de leitura.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const wf = require('../src/tools/workflowTools');
const usage = require('../src/usage');
const { runWorkflowData } = require('../src/agents/runner');

const quieto = async (fn) => { const log = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = log; } };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const W = (extra = {}) => ({ steps: [{ id: 'l', prompt: 'l' }, { id: 'r', prompt: 'r {{item}}', each: '{{l}}', tools: ['read_file'], ...extra }] });

function contador(lista = 'a\nb\nc\nd\ne', { falha = new Set(), atraso = 20 } = {}) {
  const st = { ativos: 0, maximo: 0, chamadas: [] };
  const run = async (p) => {
    if (p === 'l') return { text: lista, history: [] };
    st.chamadas.push(p); st.ativos++; st.maximo = Math.max(st.maximo, st.ativos);
    await espera(atraso); st.ativos--;
    if (falha.has(p)) throw new Error('503');
    return { text: `ok(${p})`, history: [] };
  };
  return { st, run };
}

test('paralelo 3: no máximo 3 ao mesmo tempo, saída na ordem da lista', async () => {
  usage.zerar();
  const { st, run } = contador();
  const r = await quieto(() => runWorkflowData(W({ paralelo: 3 }), { runOnce: run }));
  assert.equal(st.maximo, 3);
  assert.equal(r.results[1].itens, 5);
  assert.equal(r.results[1].output, ['a', 'b', 'c', 'd', 'e'].map((x, i) => `--- ${i + 1}. ${x} ---\nok(r ${x})`).join('\n\n'));
});

test('sem "paralelo" (ou 1) continua um item de cada vez', async () => {
  usage.zerar();
  const a = contador(); await quieto(() => runWorkflowData(W(), { runOnce: a.run }));
  const b = contador(); await quieto(() => runWorkflowData(W({ paralelo: 1 }), { runOnce: b.run }));
  assert.equal(a.st.maximo, 1);
  assert.equal(b.st.maximo, 1);
});

test('falha de item no lote: guarda só os itens ANTES dele e a retomada continua dali', async () => {
  usage.zerar();
  const { run } = contador('a\nb\nc\nd', { falha: new Set(['r b']) });
  let erro;
  try { await quieto(() => runWorkflowData(W({ paralelo: 3 }), { runOnce: run })); } catch (e) { erro = e; }
  assert.match(erro.message, /falhou no item 2 de 4/);
  assert.equal(erro.parcial.partes.length, 1);
  const ok = contador('a\nb\nc\nd');
  const r = await quieto(() => runWorkflowData(W({ paralelo: 3 }), { runOnce: ok.run, retomar: { ctx: erro.ctx, results: erro.results, desde: erro.indice, parcial: erro.parcial } }));
  assert.deepEqual(ok.st.chamadas.sort(), ['r b', 'r c', 'r d']);
  assert.match(r.results[1].output, /^--- 1\. a ---\nok\(r a\)\n\n--- 2\. b ---/);
});

test('optional + paralelo: item que falha vira [falhou] e o resto segue', async () => {
  usage.zerar();
  const { run } = contador('a\nb\nc', { falha: new Set(['r b']) });
  const r = await quieto(() => runWorkflowData(W({ paralelo: 2, optional: true }), { runOnce: run }));
  assert.equal(r.results[1].falhasItens, 1);
  assert.match(r.results[1].output, /--- 2\. b ---\n\[falhou: 503\]/);
  assert.match(r.results[1].output, /--- 3\. c ---\nok\(r c\)/);
});

test('orçamento é checado antes de cada LOTE', async () => {
  usage.zerar();
  const gasta = async (p) => { usage.registrar({ modelo: 'm', uso: { promptTokenCount: 500, totalTokenCount: 1000 } }); return { text: p === 'l' ? 'a\nb\nc\nd\ne\nf' : 'ok', history: [] }; };
  let erro;
  try { await quieto(() => runWorkflowData({ maxTokens: 3500, ...W({ paralelo: 2 }) }, { runOnce: gasta })); } catch (e) { erro = e; }
  assert.equal(erro.orcamento, true);
  assert.equal(erro.parcial.partes.length, 4, 'l=1000, lote1=2000 (3000), lote2=2000 (5000 > 3500) → para antes do item 5');
  assert.match(erro.message, /item 5 de 6/);
});

test('validação: paralelo fora de 1-3, sem each ou com ferramenta que grava é recusado', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-wf251-'));
  wf.definirPasta(d);
  const grava = (nome, passo) => fs.writeFileSync(path.join(d, `${nome}.json`), JSON.stringify({ name: nome, description: 'd', steps: [{ id: 'l', prompt: 'l' }, passo] }));
  grava('a', { id: 'r', prompt: '{{item}}', each: '{{l}}', tools: ['read_file'], paralelo: 9 });
  grava('b', { id: 'r', prompt: '{{item}}', each: '{{l}}', tools: ['write_file'], paralelo: 2 });
  grava('c', { id: 'r', prompt: '{{item}}', each: '{{l}}', paralelo: 2 });
  grava('d', { id: 'r', prompt: 'sem each', tools: [], paralelo: 2 });
  grava('e', { id: 'r', prompt: '{{item}}', each: '{{l}}', tools: [], paralelo: 3 });
  assert.match(await wf.execute('run_workflow', { name: 'a' }), /"paralelo" inválido \(1 a 3\)/);
  for (const n of ['b', 'c', 'd']) assert.match(await wf.execute('run_workflow', { name: n }), /só de leitura/, n);
  const v = wf.validarWorkflow(JSON.parse(fs.readFileSync(path.join(d, 'e.json'), 'utf8')));
  assert.deepEqual(v.erros, []);
  assert.ok(v.avisos.some((x) => /3 chamadas ao mesmo tempo/.test(x)));
  assert.ok(wf.validarWorkflow(JSON.parse(fs.readFileSync(path.join(d, 'b.json'), 'utf8'))).erros.some((x) => /só de leitura/.test(x)));
  assert.ok(wf.validarWorkflow(JSON.parse(fs.readFileSync(path.join(d, 'a.json'), 'utf8'))).erros.some((x) => /de 1 a 3/.test(x)));
  assert.ok(!wf.validarWorkflow({ description: 'd', steps: [{ id: 'r', prompt: 'x', paralelo: 1 }] }).avisos.some((x) => /não existe/.test(x)), 'paralelo é campo conhecido');
});
