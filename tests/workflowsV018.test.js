'use strict';
// v0.18.0: workflows mais robustos — variáveis com padrão/obrigatórias, retry, passo opcional, model/tools por passo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const wf = require('../src/tools/workflowTools');
const { interpolate, analisarVariaveis, runWorkflowData } = require('../src/agents/runner');

function pasta(arquivos = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-wf18-'));
  for (const [n, c] of Object.entries(arquivos)) fs.writeFileSync(path.join(d, n), typeof c === 'string' ? c : JSON.stringify(c));
  wf.definirPasta(d);
  return d;
}
const quieto = async (fn) => { const log = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = log; } };

test('interpolate: {{var|padrão}} usa o padrão só quando a variável falta ou está vazia', () => {
  assert.equal(interpolate('n={{n|3}}', {}), 'n=3');
  assert.equal(interpolate('n={{n|3}}', { n: '' }), 'n=3');
  assert.equal(interpolate('n={{n|3}}', { n: '7' }), 'n=7');
  assert.equal(interpolate('{{a|um valor com espaço}}', {}), 'um valor com espaço');
});

test('analisarVariaveis separa obrigatórias, opcionais e referência a passo futuro', () => {
  const r = analisarVariaveis({ steps: [
    { id: 'a', prompt: 'ler {{alvo}} em {{n|3}} linhas, depois {{b}}' },
    { id: 'b', prompt: 'resumir {{a}}' },
  ] });
  assert.deepEqual(r.obrigatorias, ['alvo']);
  assert.deepEqual(r.opcionais, { n: '3' });
  assert.equal(r.futuras.length, 1);
  assert.match(r.futuras[0], /a usa \{\{b\}\}/);
  // variável com padrão em UM lugar e sem padrão em outro não obriga
  assert.deepEqual(analisarVariaveis({ steps: [{ id: 'a', prompt: '{{x}} {{x|ok}}' }] }).obrigatorias, []);
});

test('run_workflow: variável obrigatória faltando vira erro claro e NÃO gasta chamada de IA', async () => {
  pasta({ 'rev.json': { name: 'rev', steps: [{ id: 'a', prompt: 'leia {{alvo}}' }] } });
  let chamadas = 0;
  const runOnceFn = async () => { chamadas++; return { text: 'x', history: [] }; };
  const r = await wf.execute('run_workflow', { name: 'rev' }, { runOnceFn });
  assert.match(r, /precisa de: "alvo"/);
  assert.equal(chamadas, 0);
  assert.match(await wf.execute('run_workflow', { name: 'rev', vars: { alvo: '' } }, { runOnceFn }), /precisa de/);
  assert.match(await wf.execute('run_workflow', { name: 'rev', vars: { alvo: 'a.js' } }, { runOnceFn }), /concluído/);
  assert.equal(chamadas, 1);
});

test('run_workflow: passo que usa resultado de passo futuro é recusado antes de rodar', async () => {
  pasta({ 'x.json': { name: 'x', steps: [{ id: 'a', prompt: 'usa {{b}}' }, { id: 'b', prompt: 'ok' }] } });
  let chamadas = 0;
  const r = await wf.execute('run_workflow', { name: 'x' }, { runOnceFn: async () => { chamadas++; return { text: 'x', history: [] }; } });
  assert.match(r, /mal montado/);
  assert.equal(chamadas, 0);
});

test('listar mostra variáveis obrigatórias e opcionais', async () => {
  pasta({ 'rev.json': { name: 'rev', description: 'd', steps: [{ id: 'a', prompt: '{{alvo}} {{n|3}}' }] } });
  const [w] = wf.listar();
  assert.deepEqual(w.variaveis, ['alvo']);
  assert.deepEqual(w.opcionais, ['n']);
  assert.match(await wf.execute('run_workflow', {}), /\[vars obrigatórias: alvo\] \[opcionais: n\]/);
});

test('retry: tenta de novo e só falha depois de esgotar; mensagem cita as tentativas', async () => {
  let n = 0;
  const flaky = async () => { n++; if (n < 3) throw new Error('503'); return { text: 'ok', history: [] }; };
  const r = await quieto(() => runWorkflowData({ steps: [{ id: 'a', prompt: 'p', retry: 2 }] }, { runOnce: flaky }));
  assert.equal(n, 3);
  assert.deepEqual(r.results, [{ id: 'a', output: 'ok', tentativas: 3 }]);

  n = 0;
  await assert.rejects(quieto(() => runWorkflowData({ steps: [{ id: 'a', prompt: 'p', retry: 1 }] }, { runOnce: async () => { n++; throw new Error('503'); } })), /passo "a" falhou após 2 tentativas: 503/);
  assert.equal(n, 2);

  n = 0; // sem retry = 1 tentativa só (comportamento antigo)
  await assert.rejects(quieto(() => runWorkflowData({ steps: [{ id: 'a', prompt: 'p' }] }, { runOnce: async () => { n++; throw new Error('x'); } })), /passo "a" falhou: x/);
  assert.equal(n, 1);
});

test('retry é limitado a 2 novas tentativas mesmo que o arquivo peça mais (e o arquivo com retry absurdo é recusado)', async () => {
  let n = 0;
  await assert.rejects(quieto(() => runWorkflowData({ steps: [{ id: 'a', prompt: 'p', retry: 99 }] }, { runOnce: async () => { n++; throw new Error('x'); } })));
  assert.equal(n, 3);
  pasta({ 'r.json': { name: 'r', steps: [{ id: 'a', prompt: 'p', retry: 5 }] } });
  assert.match(await wf.execute('run_workflow', { name: 'r' }), /"retry" inválido/);
});

test('optional: passo que falha vira "[falhou: ...]" para os próximos e o workflow termina', async () => {
  const prompts = [];
  const runOnce = async (p) => { prompts.push(p); if (p === 'busca') throw new Error('sem rede'); return { text: 'feito', history: [] }; };
  const r = await quieto(() => runWorkflowData({ steps: [
    { id: 'web', prompt: 'busca', optional: true },
    { id: 'final', prompt: 'use: {{web}}' },
  ] }, { runOnce }));
  assert.equal(r.results[0].falhou, true);
  assert.equal(prompts[1], 'use: [falhou: sem rede]');
  assert.equal(r.results[1].output, 'feito');
});

test('run_workflow resume passos opcionais que falharam e o que já rodou quando um passo obrigatório falha', async () => {
  pasta({ 'o.json': { name: 'o', steps: [{ id: 'a', prompt: 'a', optional: true }, { id: 'b', prompt: 'b' }] } });
  const r = await wf.execute('run_workflow', { name: 'o' }, { runOnceFn: async (p) => { if (p === 'a') throw new Error('x'); return { text: 'bom', history: [] }; } });
  assert.match(r, /1 opcional\(is\) falhou\(aram\): a/);
  assert.match(r, /- a \(FALHOU, opcional\)/);
  pasta({ 'f.json': { name: 'f', steps: [{ id: 'a', prompt: 'a' }, { id: 'b', prompt: 'b' }] } });
  const f = await wf.execute('run_workflow', { name: 'f' }, { runOnceFn: async (p) => { if (p === 'b') throw new Error('quota'); return { text: 'ok', history: [] }; } });
  assert.match(f, /passo "b" falhou: quota \(passos que já tinham rodado: a\)/);
});

test('model e tools por passo chegam ao runOnce; tools só restringe (interseção com o agente que chamou) e nunca libera run_workflow', async () => {
  const vistos = [];
  await quieto(() => runWorkflowData({ steps: [{ id: 'a', prompt: 'p', model: ' @local ', tools: ['read_file', 'run_workflow'] }, { id: 'b', prompt: 'q' }] }, {
    runOnce: async (p, o) => { vistos.push(o); return { text: 'x', history: [] }; },
  }));
  assert.equal(vistos[0].modelName, '@local');
  assert.deepEqual(vistos[0].allowedTools, ['read_file', 'run_workflow']); // o runner repassa; a trava fica em workflowTools
  assert.equal(vistos[1].modelName, undefined);
  assert.equal(vistos[1].allowedTools, undefined);

  // trava real: simula o runOnce do agente e confere o que ele receberia
  pasta({ 't.json': { name: 't', steps: [{ id: 'a', prompt: 'p', tools: ['read_file', 'write_file', 'run_workflow'] }] } });
  const agent = require('../src/agent');
  const original = agent.runOnce;
  const recebidos = [];
  agent.runOnce = async (p, o) => { recebidos.push(o.allowedTools); return { text: 'ok', history: [] }; };
  try {
    await quieto(() => wf.execute('run_workflow', { name: 't' }, { allowedPai: ['read_file', 'list_dir', 'run_workflow'] }));
    await quieto(() => wf.execute('run_workflow', { name: 't' }, {}));
  } finally { agent.runOnce = original; }
  assert.deepEqual(recebidos[0], ['read_file']);                      // interseção com o pai, sem run_workflow
  assert.deepEqual(recebidos[1], ['read_file', 'write_file']);        // sem pai: só a lista do passo, sem run_workflow
});

test('"tools" que não é lista de textos é recusado ao ler o workflow', async () => {
  pasta({ 'b.json': { name: 'b', steps: [{ id: 'a', prompt: 'p', tools: 'read_file' }] } });
  assert.match(await wf.execute('run_workflow', { name: 'b' }), /"tools" inválido/);
});

test('SEGURANÇA: "nenhuma ferramenta" nunca vira "todas" (lista vazia = todas na camada de ferramentas)', async () => {
  const tools = require('../src/tools');
  assert.deepEqual(await tools.getAllDeclarations(wf.NENHUMA), [], 'o marcador NENHUMA não libera nada');
  const agent = require('../src/agent');
  const original = agent.runOnce;
  const recebidos = [];
  agent.runOnce = async (p, o) => { recebidos.push(o.allowedTools); return { text: 'ok', history: [] }; };
  try {
    pasta({ 'vazio.json': { name: 'v', steps: [{ id: 'a', prompt: 'p', tools: [] }] }, 'inter.json': { name: 'i', steps: [{ id: 'a', prompt: 'p', tools: ['write_file'] }] } });
    await quieto(() => wf.execute('run_workflow', { name: 'vazio' }, {}));                                   // passo sem ferramentas
    await quieto(() => wf.execute('run_workflow', { name: 'inter' }, { allowedPai: ['read_file'] }));        // interseção vazia
    await quieto(() => wf.execute('run_workflow', { name: 'inter' }, { allowedPai: ['run_workflow'] }));     // pai só tinha run_workflow
  } finally { agent.runOnce = original; }
  for (const r of recebidos) assert.deepEqual(r, wf.NENHUMA);
  assert.equal(recebidos.length, 3);
});

test('exemplos de workflow da pasta workflows/exemplos são válidos e têm as variáveis esperadas', async () => {
  const dir = path.join(__dirname, '..', 'workflows', 'exemplos');
  pasta({});
  wf.definirPasta(dir);
  const l = wf.listar();
  assert.ok(l.length >= 3, 'os 3 exemplos carregam');
  const d = l.find((x) => x.nome === 'diagnosticar-e-resumir');
  assert.deepEqual(d.opcionais.sort(), ['linhas', 'pasta']);
  assert.deepEqual(d.variaveis, []);
});
