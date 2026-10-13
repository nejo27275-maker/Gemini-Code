'use strict';
// v0.16.0: /passo — aprovação passo a passo de gravações.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sa = require('../src/stepApproval');
const { runOnce } = require('../src/agent');

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gc-passo-'));

test('desligado: não pergunta nada; leitura nunca pergunta', async () => {
  let perguntas = 0;
  sa.configurar({ ativo: false, perguntar: async () => { perguntas++; return 'n'; } });
  assert.equal((await sa.checar('write_file', { path: 'x' })).permitido, true);
  sa.configurar({ ativo: true });
  assert.equal((await sa.checar('read_file', { path: 'x' })).permitido, true);
  assert.equal((await sa.checar('run_shell', { command: 'ls' })).permitido, true, 'run_shell tem confirmação própria');
  assert.equal(perguntas, 0);
});

test('s grava, n recusa com motivo, t grava e desliga o modo', async () => {
  const respostas = ['s', 'n', 't', 'sim'];
  sa.configurar({ ativo: true, perguntar: async () => respostas.shift() });
  assert.equal((await sa.checar('edit_file', { path: 'a', old_text: 'x', new_text: 'y' })).permitido, true);
  const nao = await sa.checar('edit_file', { path: 'a.js', old_text: 'x', new_text: 'y' });
  assert.equal(nao.permitido, false);
  assert.match(nao.motivo, /Recusado pelo usuário: edit_file em a\.js/);
  assert.equal((await sa.checar('write_file', { path: 'a', content: 'z' })).permitido, true);
  assert.equal(sa.ativo(), false, 't desligou o /passo');
  assert.equal((await sa.checar('write_file', { path: 'a', content: 'z' })).permitido, true, 'desligado não pergunta mais');
});

test('resposta vazia, estranha, erro ao perguntar ou sem terminal = recusa (nunca grava por engano)', async () => {
  sa.configurar({ ativo: true, perguntar: async () => '' });
  assert.equal((await sa.checar('write_file', { path: 'a', content: '' })).permitido, false);
  sa.configurar({ perguntar: async () => 'talvez' });
  assert.equal((await sa.checar('write_file', { path: 'a', content: '' })).permitido, false);
  sa.configurar({ perguntar: async () => { throw new Error('stdin fechado'); } });
  assert.equal((await sa.checar('write_file', { path: 'a', content: '' })).permitido, false);
  sa.configurar({ ativo: false });
});

test('prévia: arquivo novo, sobrescrita e edição, cortando textos longos', () => {
  const d = dir(); const f = path.join(d, 'a.txt');
  assert.match(sa.previa('write_file', { path: f, content: 'a\nb' }), /arquivo NOVO \(2 linhas\)/);
  fs.writeFileSync(f, '1\n2\n3');
  assert.match(sa.previa('write_file', { path: f, content: 'x' }), /SOBRESCREVE \(3 → 1 linhas\)/);
  const longa = sa.previa('write_file', { path: f, content: Array.from({ length: 40 }, (_, i) => `l${i}`).join('\n') });
  assert.match(longa, /\+28 linhas/);
  const e = sa.previa('edit_file', { path: f, old_text: 'velho', new_text: 'novo' });
  assert.match(e, /- velho\n\+ novo/);
  assert.match(sa.previa('edit_file', undefined), /sem caminho/);
});

test('no loop do agente: recusa não executa a ferramenta e o modelo recebe o motivo', async () => {
  const alvo = path.join(dir(), 'x.txt');
  sa.configurar({ ativo: true, perguntar: async () => 'n' });
  const respostas = [{ fc: [{ name: 'write_file', args: { path: alvo, content: 'oi' } }] }, { texto: 'ok, não gravei' }];
  let i = 0; const executadas = [];
  const chatWithTools = async () => { const r = respostas[i++]; return { functionCalls: () => r.fc || [], rawParts: () => (r.fc ? r.fc.map((c) => ({ functionCall: c })) : [{ text: r.texto }]), text: () => r.texto || '' }; };
  const { history } = await runOnce('grava x', { deps: { loadConfig: () => ({}), chatWithTools, getAllDeclarations: async () => [], buildSystemInstruction: () => '', execute: async (n) => { executadas.push(n); return 'feito'; } } });
  assert.deepEqual(executadas, []);
  assert.equal(fs.existsSync(alvo), false);
  const resp = history.flatMap((m) => m.parts).find((p) => p.functionResponse).functionResponse.response.result;
  assert.match(resp, /Recusado pelo usuário/);
  sa.configurar({ ativo: false });
});
