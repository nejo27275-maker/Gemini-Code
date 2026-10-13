'use strict';
// v0.17.0: run_workflow — o agente aciona workflows salvos.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const wf = require('../src/tools/workflowTools');
const tools = require('../src/tools');
const { buildSystemInstruction } = require('../src/agent');

function pasta(arquivos = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-wf-'));
  for (const [n, c] of Object.entries(arquivos)) fs.writeFileSync(path.join(d, n), typeof c === 'string' ? c : JSON.stringify(c));
  wf.definirPasta(d);
  return d;
}
const W = { name: 'rev', description: 'revisa {{alvo}}', steps: [{ id: 'a', prompt: 'leia {{alvo}}' }, { id: 'b', prompt: 'resuma: {{a}}' }] };

test('declarada nas ferramentas e sem argumentos lista; sem pasta/arquivos avisa como criar', async () => {
  assert.ok((await tools.getAllDeclarations()).some((d) => d.name === 'run_workflow'));
  pasta({});
  assert.match(await wf.execute('run_workflow', {}), /Nenhum workflow salvo/);
  pasta({ 'rev.json': W, 'quebrado.json': '{ x', 'semsteps.json': { name: 'x' } });
  const l = await wf.execute('run_workflow', {});
  assert.match(l, /- rev \(2 passos\) \[vars obrigatórias: alvo\]: revisa \{\{alvo\}\}/);
  assert.doesNotMatch(l, /quebrado|semsteps/, 'inválidos são ignorados');
  assert.deepEqual(wf.listar().map((x) => x.nome), ['rev']);
});

test('roda os passos em ordem, com vars e encadeando {{passo}}; devolve o resultado final', async () => {
  pasta({ 'rev.json': W });
  const prompts = [];
  const runOnceFn = async (p) => { prompts.push(p); return { text: `saida${prompts.length}`, history: [] }; };
  const r = await wf.execute('run_workflow', { name: 'rev', vars: { alvo: 'src/a.js' } }, { runOnceFn });
  assert.deepEqual(prompts, ['leia src/a.js', 'resuma: saida1']);
  assert.match(r, /concluído \(2 passos\)/);
  assert.match(r, /Resultado final \(b\):\nsaida2/);
  assert.match(r, /- a: saida1/);
});

test('trava: nome com caminho, inexistente, sem recursão e erro no passo viram texto de erro (não lançam)', async () => {
  pasta({ 'rev.json': W });
  assert.match(await wf.execute('run_workflow', { name: '../etc/passwd' }), /nome inválido/);
  assert.match(await wf.execute('run_workflow', { name: 'nao-existe' }), /não existe/);
  let aninhado;
  const runOnceFn = async () => { aninhado = await wf.execute('run_workflow', { name: 'rev', vars: { alvo: 'x' } }, { runOnceFn: async () => ({ text: 'x', history: [] }) }); return { text: 'ok', history: [] }; };
  await wf.execute('run_workflow', { name: 'rev', vars: { alvo: 'x' } }, { runOnceFn });
  assert.match(aninhado, /não pode chamar outro workflow/);
  const falha = await wf.execute('run_workflow', { name: 'rev', vars: { alvo: 'x' } }, { runOnceFn: async () => { throw new Error('quota'); } });
  assert.match(falha, /Erro no workflow "rev": passo "a" falhou: quota/);
  assert.match(await wf.execute('run_workflow', { name: 'rev', vars: { alvo: 'x' } }, { runOnceFn: async () => ({ text: 'ok', history: [] }) }), /concluído/, 'a trava de recursão é liberada depois do erro');
});

test('limites: mais de 10 passos e passo sem prompt são recusados', async () => {
  const muitos = { name: 'g', steps: Array.from({ length: 11 }, (_, i) => ({ id: `p${i}`, prompt: 'x' })) };
  pasta({ 'g.json': muitos, 'v.json': { name: 'v', steps: [{ id: 'a' }] } });
  assert.match(await wf.execute('run_workflow', { name: 'g' }), /mais de 10 passos/);
  assert.match(await wf.execute('run_workflow', { name: 'v' }), /precisa de "id"/);
});

test('prompt do sistema cita os workflows só quando existem', () => {
  pasta({});
  assert.doesNotMatch(buildSystemInstruction(), /Workflows salvos/);
  pasta({ 'rev.json': W });
  assert.match(buildSystemInstruction(), /Workflows salvos \(rode com run_workflow\): rev\./);
});
