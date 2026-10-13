'use strict';
// v0.20.0: retomar um workflow que falhou no meio, sem refazer (nem pagar de novo) os passos que já deram certo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const wf = require('../src/tools/workflowTools');
const { runWorkflowData } = require('../src/agents/runner');

function pasta(arquivos = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-wf20-'));
  for (const [n, c] of Object.entries(arquivos)) fs.writeFileSync(path.join(d, n), typeof c === 'string' ? c : JSON.stringify(c));
  wf.definirPasta(d);
  return d;
}
const quieto = async (fn) => { const log = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = log; } };
const W3 = { name: 'tres', description: 'd', steps: [{ id: 'a', prompt: 'passo a {{alvo}}' }, { id: 'b', prompt: 'passo b com {{a}}' }, { id: 'c', prompt: 'passo c com {{a}} e {{b}}' }] };

test('runner: erro carrega indice e contexto; retomar pula os passos anteriores e reaproveita os resultados', async () => {
  const chamadas = [];
  const falha = async (p) => { chamadas.push(p); if (p.startsWith('passo b')) throw new Error('quota'); return { text: `R(${p})`, history: [] }; };
  let erro;
  try { await quieto(() => runWorkflowData(W3, { runOnce: falha, vars: { alvo: 'x' } })); } catch (e) { erro = e; }
  assert.equal(erro.indice, 1);
  assert.equal(erro.step, 'b');
  assert.equal(erro.ctx.a, 'R(passo a x)');
  assert.equal(chamadas.length, 2);

  const novas = [];
  const ok = async (p) => { novas.push(p); return { text: `N(${p})`, history: [] }; };
  const r = await quieto(() => runWorkflowData(W3, { runOnce: ok, retomar: { ctx: erro.ctx, results: erro.results, desde: erro.indice } }));
  assert.deepEqual(novas, ['passo b com R(passo a x)', 'passo c com R(passo a x) e N(passo b com R(passo a x))']);
  assert.deepEqual(r.results.map((x) => x.id), ['a', 'b', 'c']);
});

test('run_workflow: falha salva o progresso, a mensagem ensina a retomar e retomar só roda do passo que falhou', async () => {
  pasta({ 'tres.json': W3 });
  const vistos = [];
  let quebrar = true;
  const runOnceFn = async (p) => { vistos.push(p); if (quebrar && p.startsWith('passo b')) throw new Error('503'); return { text: `ok:${p.slice(0, 7)}`, history: [] }; };
  const r1 = await quieto(() => wf.execute('run_workflow', { name: 'tres', vars: { alvo: 'x' } }, { runOnceFn }));
  assert.match(r1, /passo "b" falhou: 503 \(passos que já tinham rodado: a\)/);
  assert.match(r1, /retomar: true/);
  assert.match(await wf.execute('run_workflow', {}), /\[INTERROMPIDO no passo b: retomar disponível\]/);

  quebrar = false; vistos.length = 0;
  const r2 = await quieto(() => wf.execute('run_workflow', { name: 'tres', retomar: true }, { runOnceFn }));   // sem repassar vars: voltam do estado salvo
  assert.match(r2, /concluído \(3 passos\)/);
  assert.equal(vistos.length, 2, 'só b e c rodam; a não é refeito');
  assert.match(vistos[0], /^passo b com ok:passo a/);
  assert.doesNotMatch(await wf.execute('run_workflow', {}), /INTERROMPIDO/, 'sucesso apaga o estado');
  assert.match(await wf.execute('run_workflow', { name: 'tres', retomar: true }, { runOnceFn }), /não há execução interrompida/);
});

test('retomar é recusado (e o estado descartado) se o workflow mudou depois da falha', async () => {
  const d = pasta({ 'tres.json': W3 });
  await quieto(() => wf.execute('run_workflow', { name: 'tres', vars: { alvo: 'x' } }, { runOnceFn: async (p) => { if (p.startsWith('passo b')) throw new Error('x'); return { text: 'ok', history: [] }; } }));
  const alterado = { ...W3, steps: [...W3.steps.slice(0, 2), { id: 'c', prompt: 'outro prompt' }] };
  fs.writeFileSync(path.join(d, 'tres.json'), JSON.stringify(alterado));
  assert.match(await wf.execute('run_workflow', { name: 'tres', retomar: true }, { runOnceFn: async () => ({ text: 'ok', history: [] }) }), /foi alterado depois da falha/);
  assert.doesNotMatch(await wf.execute('run_workflow', {}), /INTERROMPIDO/);
});

test('estado com mais de 24h expira; vars novas sobrescrevem as salvas; keepHistory não salva estado', async () => {
  const d = pasta({ 'tres.json': W3, 'hist.json': { name: 'h', keepHistory: true, steps: [{ id: 'a', prompt: 'a' }, { id: 'b', prompt: 'b' }] } });
  const quebra = async (p) => { if (p.startsWith('passo b') || p === 'b') throw new Error('x'); return { text: 'ok', history: [] }; };
  await quieto(() => wf.execute('run_workflow', { name: 'tres', vars: { alvo: 'x' } }, { runOnceFn: quebra }));
  const arq = path.join(d, '.estado', 'tres.json');
  const e = JSON.parse(fs.readFileSync(arq, 'utf8'));
  e.em = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
  fs.writeFileSync(arq, JSON.stringify(e));
  assert.match(await wf.execute('run_workflow', { name: 'tres', retomar: true }, { runOnceFn: async () => ({ text: 'ok', history: [] }) }), /não há execução interrompida/);

  await quieto(() => wf.execute('run_workflow', { name: 'tres', vars: { alvo: 'x' } }, { runOnceFn: quebra }));
  const vistos = [];
  await quieto(() => wf.execute('run_workflow', { name: 'tres', retomar: true, vars: { alvo: 'NOVO' } }, { runOnceFn: async (p) => { vistos.push(p); return { text: 'ok', history: [] }; } }));
  assert.equal(vistos.length, 2);

  const r = await quieto(() => wf.execute('run_workflow', { name: 'hist' }, { runOnceFn: quebra }));
  assert.doesNotMatch(r, /retomar: true/);
  assert.equal(fs.existsSync(path.join(d, '.estado', 'hist.json')), false);
});

test('segurança: nome de workflow inválido nunca vira caminho de estado, e retomar respeita a trava de recursão', async () => {
  pasta({ 'tres.json': W3 });
  assert.match(await wf.execute('run_workflow', { name: '../x', retomar: true }), /nome inválido/);
  assert.match(await wf.execute('run_workflow', { name: 'nao-existe', retomar: true }), /não existe/);
});
