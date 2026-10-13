'use strict';
// v0.19.0: when/unless (passo condicional) e validação completa de workflow sem rodar.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const wf = require('../src/tools/workflowTools');
const { avaliarCondicao, runWorkflowData, analisarVariaveis } = require('../src/agents/runner');

function pasta(arquivos = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-wf19-'));
  for (const [n, c] of Object.entries(arquivos)) fs.writeFileSync(path.join(d, n), typeof c === 'string' ? c : JSON.stringify(c));
  wf.definirPasta(d);
  return d;
}
const quieto = async (fn) => { const log = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = log; } };

test('avaliarCondicao: texto (vazio/false/não/0/[falhou: = falso) e objeto (contains/equals/empty)', () => {
  const ctx = { a: 'Achei um BUG no login', vazio: '', f: '[falhou: sem rede]', n: 'Não', modo: 'Rapido' };
  assert.equal(avaliarCondicao(undefined, ctx), true);
  assert.equal(avaliarCondicao('{{a}}', ctx), true);
  for (const k of ['vazio', 'f', 'n', 'inexistente']) assert.equal(avaliarCondicao(`{{${k}}}`, ctx), false, k);
  assert.equal(avaliarCondicao({ var: 'a', contains: 'bug' }, ctx), true);
  assert.equal(avaliarCondicao({ var: 'a', contains: 'xyz' }, ctx), false);
  assert.equal(avaliarCondicao({ var: 'modo', equals: ' rapido ' }, ctx), true);
  assert.equal(avaliarCondicao({ var: 'vazio', empty: true }, ctx), true);
  assert.equal(avaliarCondicao({ var: 'f', empty: true }, ctx), true, 'passo opcional que falhou conta como vazio');
  assert.equal(avaliarCondicao({ var: 'a', empty: true }, ctx), false);
  assert.equal(avaliarCondicao({ var: 'a' }, ctx), true);
});

test('when/unless: passo pulado NÃO chama a IA, deixa a variável vazia e os próximos seguem', async () => {
  const prompts = [];
  const runOnce = async (p) => { prompts.push(p); return { text: p.startsWith('achar') ? 'tudo limpo' : 'feito', history: [] }; };
  const r = await quieto(() => runWorkflowData({ steps: [
    { id: 'achados', prompt: 'achar bugs' },
    { id: 'corrigir', prompt: 'corrija: {{achados}}', when: { var: 'achados', contains: 'bug' } },
    { id: 'confirmar', prompt: 'tudo certo? [{{corrigir}}]', unless: { var: 'achados', contains: 'bug' } },
  ] }, { runOnce }));
  assert.deepEqual(prompts, ['achar bugs', 'tudo certo? []']);
  assert.deepEqual(r.results.map((x) => [x.id, !!x.pulado]), [['achados', false], ['corrigir', true], ['confirmar', false]]);
  assert.equal(r.results[1].output, '');
});

test('when depois de passo opcional que falhou: pula o que dependia dele', async () => {
  const prompts = [];
  const runOnce = async (p) => { prompts.push(p); if (p === 'a') throw new Error('x'); return { text: 'ok', history: [] }; };
  const r = await quieto(() => runWorkflowData({ steps: [
    { id: 'a', prompt: 'a', optional: true },
    { id: 'b', prompt: 'b', when: '{{a}}' },
    { id: 'c', prompt: 'c' },
  ] }, { runOnce }));
  assert.deepEqual(prompts, ['a', 'c']);
  assert.equal(r.results[1].pulado, true);
});

test('analisarVariaveis enxerga when/unless (obrigatória e passo futuro)', () => {
  const r = analisarVariaveis({ steps: [
    { id: 'a', prompt: 'x', when: '{{modo}}' },
    { id: 'b', prompt: 'y', unless: { var: 'c', contains: 'k' } },
    { id: 'c', prompt: 'z' },
  ] });
  assert.deepEqual(r.obrigatorias, ['modo']);
  assert.equal(r.futuras.length, 1);
  assert.match(r.futuras[0], /b usa \{\{c\}\}/);
});

test('run_workflow: resultado final é o último passo QUE RODOU; todos pulados explica; resumo conta os pulados', async () => {
  pasta({ 'w.json': { name: 'w', steps: [{ id: 'a', prompt: 'a' }, { id: 'b', prompt: 'b', when: { var: 'a', contains: 'nunca' } }] },
    'todos.json': { name: 't', steps: [{ id: 'a', prompt: 'a', when: '{{nada|}}' }] } });
  const runOnceFn = async () => ({ text: 'resposta A', history: [] });
  const r = await quieto(() => wf.execute('run_workflow', { name: 'w' }, { runOnceFn }));
  assert.match(r, /concluído \(1 passos, 1 pulado\(s\)\)/);
  assert.match(r, /Resultado final \(a\):\nresposta A/);
  assert.match(r, /- b: \(pulado\)/);
  const t = await quieto(() => wf.execute('run_workflow', { name: 'todos' }, { runOnceFn }));
  assert.match(t, /Nenhum passo rodou/);
});

test('"when" inválido é recusado ao ler o workflow', async () => {
  pasta({ 'x.json': { name: 'x', steps: [{ id: 'a', prompt: 'p', when: 5 }] } });
  assert.match(await wf.execute('run_workflow', { name: 'x' }), /"when" inválido/);
});

test('validarWorkflow junta TODOS os erros e avisos de uma vez', () => {
  const { erros, avisos } = wf.validarWorkflow({ steps: [
    { id: 'a', prompt: 'x {{b}}', retries: 2, tools: ['web_search'] },
    { id: 'a', prompt: '' },
    { id: 'b', prompt: 'y', when: 5 },
  ] });
  assert.equal(erros.length, 4);
  assert.ok(erros.some((e) => /"id" repetido/.test(e)));
  assert.ok(erros.some((e) => /falta "prompt"/.test(e)));
  assert.ok(erros.some((e) => /"when" inválido/.test(e)));
  assert.ok(erros.some((e) => /a usa \{\{b\}\} antes/.test(e)));
  assert.ok(avisos.some((a) => /sem "description"/.test(a)));
  assert.ok(avisos.some((a) => /"retries" não existe/.test(a) && /retry/.test(a)));
  assert.ok(avisos.some((a) => /ferramenta "web_search" não existe/.test(a)));
  assert.ok(avisos.some((a) => /ÚLTIMO passo é opcional\/condicional/.test(a)));
});

test('validarWorkflow: workflow bom passa limpo; mcp__ é aceito; sem steps e JSON quebrado viram erro', () => {
  const ok = wf.validarWorkflow({ description: 'd', steps: [{ id: 'a', prompt: 'x', tools: ['read_file', 'mcp__srv__ferr'], retry: 1 }, { id: 'b', prompt: '{{a}}' }] });
  assert.deepEqual(ok, { erros: [], avisos: [] });
  assert.match(wf.validarWorkflow({ name: 'x' }).erros[0], /não tem "steps"/);
  const d = pasta({ 'q.json': '{ quebrado' });
  assert.match(wf.validarArquivo(path.join(d, 'q.json')).erros[0], /não consegui ler o JSON/);
  assert.match(wf.validarWorkflow({ steps: Array.from({ length: 11 }, (_, i) => ({ id: `p${i}`, prompt: 'x' })) }).erros[0], /mais de 10 passos/);
});

test('todos os exemplos que vêm no projeto passam na validação sem ERRO', () => {
  const dir = path.join(__dirname, '..', 'workflows', 'exemplos');
  const arqs = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  assert.ok(arqs.length >= 4);
  for (const n of arqs) assert.deepEqual(wf.validarArquivo(path.join(dir, n)).erros, [], n);
});
