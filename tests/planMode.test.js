'use strict';
// v0.14.0: modo plano com aprovação.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pm = require('../src/planMode');
const { runOnce } = require('../src/agent');

test('PLAN_TOOLS só tem leitura e todo_write (nada que grave ou execute)', () => {
  for (const proibida of ['write_file', 'edit_file', 'run_shell', 'delegate_task', 'run_checks']) assert.ok(!pm.PLAN_TOOLS.includes(proibida), proibida);
  for (const ok of ['read_file', 'list_dir', 'search_files', 'todo_write']) assert.ok(pm.PLAN_TOOLS.includes(ok), ok);
});

test('interpretar: entrar, sair, aprovar e avisos', () => {
  assert.equal(pm.interpretar('/compact'), null);
  assert.equal(pm.interpretar('/planos'), null);
  const e = pm.interpretar('/plano');
  assert.deepEqual([e.acao, e.ativo, e.enviar], ['entrar', true, null]);
  const e2 = pm.interpretar('/plano migrar para SQLite');
  assert.deepEqual([e2.acao, e2.ativo, e2.enviar], ['entrar', true, 'migrar para SQLite']);
  assert.equal(pm.interpretar('/plano off', { ativo: true }).ativo, false);
  assert.match(pm.interpretar('/plano sair', { ativo: false }).aviso, /já estava desligado/);
  assert.equal(pm.interpretar('/aprovar', { ativo: false }).acao, 'aviso');
  const a = pm.interpretar('/aprovar sem mexer no README', { ativo: true });
  assert.deepEqual([a.acao, a.ativo], ['aprovar', false]);
  assert.match(a.enviar, /Plano aprovado com este ajuste: sem mexer no README/);
  assert.match(pm.interpretar('/aprovar', { ativo: true }).enviar, /^Plano aprovado\. Execute-o/);
});

test('opcoes: só restringe quando o modo está ligado', () => {
  assert.deepEqual(pm.opcoes(false), {});
  const o = pm.opcoes(true);
  assert.deepEqual(o.allowedTools, [...pm.PLAN_TOOLS]);
  assert.match(o.extraSystemInstruction, /aprovação/i);
});

test('trava real no loop do agente: modelo insiste em write_file e nada é gravado', async () => {
  const alvo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gc-plano-')), 'x.txt');
  const respostas = [{ fc: [{ name: 'write_file', args: { path: alvo, content: 'oi' } }] }, { texto: 'plano pronto' }];
  let i = 0;
  const chatWithTools = async () => {
    const r = respostas[i++];
    return { functionCalls: () => r.fc || [], rawParts: () => (r.fc ? r.fc.map((c) => ({ functionCall: c })) : [{ text: r.texto }]), text: () => r.texto || '' };
  };
  const { history } = await runOnce('muda o x', {
    ...pm.opcoes(true),
    deps: { loadConfig: () => ({}), chatWithTools, getAllDeclarations: async () => [], buildSystemInstruction: () => '' },
  });
  assert.equal(fs.existsSync(alvo), false, 'o arquivo não pode ter sido criado');
  const resp = history.flatMap((m) => m.parts).find((p) => p.functionResponse).functionResponse.response.result;
  assert.match(resp, /não está liberada/);
});
