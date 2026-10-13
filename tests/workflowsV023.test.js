'use strict';
// v0.23.0: histórico das execuções de workflow (sem guardar saídas nem variáveis).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const wf = require('../src/tools/workflowTools');
const usage = require('../src/usage');

function pasta(arquivos = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-wf23-'));
  for (const [n, c] of Object.entries(arquivos)) fs.writeFileSync(path.join(d, n), typeof c === 'string' ? c : JSON.stringify(c));
  wf.definirPasta(d);
  return d;
}
const quieto = async (fn) => { const log = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = log; } };
const W = { name: 'w', description: 'd', steps: [{ id: 'a', prompt: 'a {{segredo}}' }, { id: 'b', prompt: 'b {{a}}' }] };
const gasta = (n) => async (p) => { usage.registrar({ modelo: 'm', uso: { promptTokenCount: n / 2, totalTokenCount: n } }); return { text: 'SAIDA-CONFIDENCIAL', history: [] }; };

test('execução com sucesso e com erro entram no histórico, mais nova primeiro, com passos/tokens/duração', async () => {
  usage.zerar();
  pasta({ 'w.json': W });
  assert.equal(wf.formatarHistorico(wf.historico()), 'Nenhuma execução registrada ainda.');
  await quieto(() => wf.execute('run_workflow', { name: 'w', vars: { segredo: 'SENHA123' } }, { runOnceFn: gasta(1000) }));
  await quieto(() => wf.execute('run_workflow', { name: 'w', vars: { segredo: 'SENHA123' } }, { runOnceFn: async (p) => { if (p.startsWith('b')) throw new Error('quota estourada'); return gasta(400)(p); } }));
  const h = wf.historico();
  assert.equal(h.length, 2);
  assert.equal(h[0].status, 'erro');
  assert.equal(h[0].passo, 'b');
  assert.equal(h[0].passos, 1);
  assert.equal(h[0].tokens, 400);
  assert.match(h[0].erro, /quota estourada/);
  assert.equal(h[1].status, 'ok');
  assert.equal(h[1].passos, 2);
  assert.equal(h[1].tokens, 2000);
  assert.ok(h[1].ms >= 0);
  const txt = wf.formatarHistorico(h);
  assert.match(txt, /w {2}ERRO no passo b {2}1 passo\(s\) {2}400 tokens/);
  assert.match(txt, /↳ passo "b" falhou: quota estourada/);
  assert.match(txt, /w {2}OK {2}2 passo\(s\) {2}2\.000 tokens/);
});

test('privacidade: o arquivo de histórico não contém saídas dos passos nem variáveis', async () => {
  usage.zerar();
  const d = pasta({ 'w.json': W });
  await quieto(() => wf.execute('run_workflow', { name: 'w', vars: { segredo: 'SENHA123' } }, { runOnceFn: gasta(10) }));
  const bruto = fs.readFileSync(path.join(d, '.estado', 'historico.jsonl'), 'utf8');
  assert.doesNotMatch(bruto, /SENHA123|SAIDA-CONFIDENCIAL/);
});

test('retomada aparece marcada; filtro por nome e limite funcionam; run_workflow historico:true devolve o texto', async () => {
  usage.zerar();
  pasta({ 'w.json': W, 'x.json': { name: 'x', description: 'd', steps: [{ id: 'a', prompt: 'a' }] } });
  let quebrar = true;
  const run = async (p) => { if (quebrar && p.startsWith('b')) throw new Error('503'); return gasta(100)(p); };
  await quieto(() => wf.execute('run_workflow', { name: 'w', vars: { segredo: 's' } }, { runOnceFn: run }));
  quebrar = false;
  await quieto(() => wf.execute('run_workflow', { name: 'w', retomar: true }, { runOnceFn: run }));
  await quieto(() => wf.execute('run_workflow', { name: 'x' }, { runOnceFn: run }));
  assert.equal(wf.historico({ nome: 'w' }).length, 2);
  assert.equal(wf.historico({ nome: 'w' })[0].retomado, true);
  assert.equal(wf.historico({ limite: 1 }).length, 1);
  assert.equal(wf.historico({ limite: 1 })[0].nome, 'x');
  const t = await wf.execute('run_workflow', { historico: true, name: 'w' });
  assert.match(t, /w \(retomado\)/);
  assert.doesNotMatch(t, /^.*\bx {2}OK/m);
});

test('o histórico guarda só as últimas 200 execuções e ignora linhas estragadas', async () => {
  usage.zerar();
  const d = pasta({ 'x.json': { name: 'x', description: 'd', steps: [{ id: 'a', prompt: 'a' }] } });
  fs.mkdirSync(path.join(d, '.estado'), { recursive: true });
  const velhas = Array.from({ length: 205 }, (_, i) => JSON.stringify({ em: new Date(2026, 0, 1).toISOString(), nome: 'velho', status: 'ok', passos: i, tokens: 0, ms: 1 }));
  fs.writeFileSync(path.join(d, '.estado', 'historico.jsonl'), velhas.join('\n') + '\n{ quebrada\n');
  await quieto(() => wf.execute('run_workflow', { name: 'x' }, { runOnceFn: gasta(1) }));
  const linhas = fs.readFileSync(path.join(d, '.estado', 'historico.jsonl'), 'utf8').split('\n').filter(Boolean);
  assert.equal(linhas.length, 200);
  assert.equal(wf.historico({ limite: 1 })[0].nome, 'x');
});

test('erros de validação (antes de rodar) não poluem o histórico', async () => {
  pasta({ 'w.json': W });
  await wf.execute('run_workflow', { name: 'w' }, { runOnceFn: gasta(1) }); // falta {{segredo}}
  await wf.execute('run_workflow', { name: 'nao-existe' });
  assert.deepEqual(wf.historico(), []);
});
