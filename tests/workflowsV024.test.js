'use strict';
// v0.24.0: retomar o laço "each" do item que parou, histórico do `agent run` (terminal) e resumo por workflow.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const wf = require('../src/tools/workflowTools');
const usage = require('../src/usage');
const { runWorkflowData } = require('../src/agents/runner');

function pasta(arquivos = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-wf24-'));
  for (const [n, c] of Object.entries(arquivos)) fs.writeFileSync(path.join(d, n), typeof c === 'string' ? c : JSON.stringify(c));
  wf.definirPasta(d);
  return d;
}
const quieto = async (fn) => { const log = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = log; } };
const EACH = { name: 'e', description: 'd', steps: [{ id: 'l', prompt: 'l' }, { id: 'r', prompt: 'r {{item}}', each: '{{l}}' }, { id: 's', prompt: 's {{r}}' }] };

test('each: ao retomar, continua do item que parou (não refaz os itens já feitos)', async () => {
  usage.zerar();
  pasta({ 'e.json': EACH });
  const chamadas = [];
  let quebrar = true;
  const run = async (p) => {
    chamadas.push(p);
    if (quebrar && p === 'r c') throw new Error('503');
    return { text: p === 'l' ? 'a\nb\nc\nd' : `ok(${p})`, history: [] };
  };
  const erro = await quieto(() => wf.execute('run_workflow', { name: 'e' }, { runOnceFn: run }));
  assert.match(erro, /falhou no item 3 de 4/);
  assert.match(erro, /retomar: true/);
  assert.deepEqual(chamadas, ['l', 'r a', 'r b', 'r c']);

  quebrar = false; chamadas.length = 0;
  const out = await quieto(() => wf.execute('run_workflow', { name: 'e', retomar: true }, { runOnceFn: run }));
  assert.deepEqual(chamadas, ['r c', 'r d', 's --- 1. a ---\nok(r a)\n\n--- 2. b ---\nok(r b)\n\n--- 3. c ---\nok(r c)\n\n--- 4. d ---\nok(r d)'], 'só c e d rodam de novo; a e b vêm do estado salvo');
  assert.match(out, /concluído/);
});

test('each: se a lista mudou de tamanho entre a falha e a retomada, recomeça do item 1 (seguro)', async () => {
  usage.zerar();
  const w = { steps: [{ id: 'r', prompt: 'r {{item}}', each: '{{l}}' }] };
  const chamadas = [];
  const run = async (p) => { chamadas.push(p); return { text: 'ok', history: [] }; };
  const r = await quieto(() => runWorkflowData(w, {
    runOnce: run, vars: { l: 'a\nb\nc' },
    retomar: { ctx: { l: 'a\nb\nc' }, results: [], desde: 0, parcial: { id: 'r', total: 5, partes: ['--- 1. a ---\nok', '--- 2. b ---\nok'], falhasItens: 0 } },
  }));
  assert.deepEqual(chamadas, ['r a', 'r b', 'r c']);
  assert.equal(r.results[0].itens, 3);
});

test('each + orçamento: o estouro no meio do laço também guarda os itens feitos', async () => {
  usage.zerar();
  const gasta = (n) => async (p) => { usage.registrar({ modelo: 'm', uso: { promptTokenCount: n / 2, totalTokenCount: n } }); return { text: p === 'l' ? 'a\nb\nc\nd' : 'ok', history: [] }; };
  let erro;
  try { await quieto(() => runWorkflowData({ maxTokens: 2500, steps: [{ id: 'l', prompt: 'l' }, { id: 'r', prompt: 'r {{item}}', each: '{{l}}' }] }, { runOnce: gasta(1000) })); } catch (e) { erro = e; }
  assert.equal(erro.orcamento, true);
  assert.equal(erro.parcial.id, 'r');
  assert.equal(erro.parcial.total, 4);
  assert.equal(erro.parcial.partes.length, 2);
});

test('rodarComHistorico: workflow do terminal entra no histórico (ok e erro), marcado "terminal", sem saídas', async () => {
  usage.zerar();
  const d = pasta();
  const gasta = (n) => async () => { usage.registrar({ modelo: 'm', uso: { promptTokenCount: n / 2, totalTokenCount: n } }); return { text: 'SEGREDO-NA-SAIDA', history: [] }; };
  const W = { name: 'meu wf!', steps: [{ id: 'a', prompt: 'a' }, { id: 'b', prompt: 'b' }] };
  const r = await quieto(() => wf.rodarComHistorico(W.name, () => runWorkflowData(W, { runOnce: gasta(300) }).then((result) => ({ type: 'workflow', result }))));
  assert.equal(r.type, 'workflow');
  await assert.rejects(() => quieto(() => wf.rodarComHistorico('meuwf', () => runWorkflowData(W, { runOnce: async (p) => { if (p === 'b') throw new Error('quota'); return gasta(50)(); } }))), /quota/);
  const h = wf.historico();
  assert.equal(h.length, 2);
  assert.equal(h[0].status, 'erro');
  assert.equal(h[0].passo, 'b');
  assert.equal(h[0].origem, 'terminal');
  assert.equal(h[1].nome, 'meu wf');
  assert.equal(h[1].tokens, 600);
  assert.match(wf.formatarHistorico(h), /meuwf \(terminal\) {2}ERRO no passo b/);
  assert.doesNotMatch(fs.readFileSync(path.join(d, '.estado', 'historico.jsonl'), 'utf8'), /SEGREDO-NA-SAIDA/);
});

test('estatisticas: taxa de sucesso, médias, retomadas e o passo que mais falha, por workflow', async () => {
  usage.zerar();
  pasta();
  const reg = (nome, status, extra = {}) => ({ em: new Date().toISOString(), nome, status, passos: 2, pulados: 0, tokens: 1000, ms: 2000, ...extra });
  // grava direto no arquivo de histórico (mesma forma que registrarExecucao)
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-wf24b-'));
  wf.definirPasta(d);
  fs.mkdirSync(path.join(d, '.estado'), { recursive: true });
  const linhas = [reg('a', 'ok'), reg('a', 'erro', { passo: 'x', tokens: 500 }), reg('a', 'erro', { passo: 'x', retomado: true }), reg('a', 'ok'), reg('b', 'ok', { ms: 4000 })];
  fs.writeFileSync(path.join(d, '.estado', 'historico.jsonl'), linhas.map((l) => JSON.stringify(l)).join('\n') + '\nlinha estragada\n');
  const st = wf.estatisticas();
  assert.equal(st.length, 2);
  assert.equal(st[0].nome, 'a', 'o mais executado vem primeiro');
  assert.equal(st[0].execucoes, 4);
  assert.equal(st[0].ok, 2);
  assert.equal(st[0].erros, 2);
  assert.equal(st[0].taxaOk, 50);
  assert.equal(st[0].tokensTotal, 3500);
  assert.equal(st[0].tokensMedio, 875);
  assert.equal(st[0].retomadas, 1);
  assert.equal(st[0].passoQueMaisFalha, 'x');
  assert.equal(st[0].falhasDoPasso, 2);
  assert.equal(st[1].passoQueMaisFalha, undefined);
  assert.equal(wf.estatisticas({ nome: 'b' }).length, 1);
  assert.deepEqual(wf.estatisticas({ nome: 'nao-existe' }), []);
  const txt = wf.formatarEstatisticas(st);
  assert.match(txt, /a: 4 execução\(ões\), 2 OK e 2 com erro \(50% OK\)/);
  assert.match(txt, /passo que mais falha: x \(2x\)/);
  assert.match(txt, /1 retomada\(s\)/);
});

test('run_workflow resumo:true devolve as estatísticas; sem histórico, avisa', async () => {
  usage.zerar();
  pasta({ 'w.json': { name: 'w', description: 'd', steps: [{ id: 'a', prompt: 'a' }] } });
  assert.equal(await wf.execute('run_workflow', { resumo: true }), 'Nenhuma execução registrada ainda.');
  await quieto(() => wf.execute('run_workflow', { name: 'w' }, { runOnceFn: async () => ({ text: 'x', history: [] }) }));
  assert.match(await wf.execute('run_workflow', { resumo: true }), /^w: 1 execução\(ões\), 1 OK e 0 com erro \(100% OK\)/);
  assert.match(await wf.execute('run_workflow', { resumo: true, name: 'w' }), /^w: 1 execução/);
  assert.ok(wf.declarations[0].parameters.properties.resumo);
});
