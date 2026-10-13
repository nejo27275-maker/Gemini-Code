'use strict';
// v0.41.0: integração de edit_files, glob_files e web_fetch com o resto do agente — o que cada
// ferramenta não tinha como testar sozinha: /passo, modos restritos, análise de risco e o loop real.
const fs = require('fs');
const os = require('os');
const path = require('path');
const HOME_FALSO = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-integradas-'));
process.env.HOME = HOME_FALSO;
process.env.USERPROFILE = HOME_FALSO;

const test = require('node:test');
const assert = require('node:assert/strict');
const tools = require('../src/tools');
const security = require('../src/security');
const planMode = require('../src/planMode');
const stepApproval = require('../src/stepApproval');
const workflowTools = require('../src/tools/workflowTools');
const { runOnce } = require('../src/agent');

const NOVAS = ['edit_files', 'glob_files', 'web_fetch'];

test('as ferramentas novas estão registradas e executam pela camada de ferramentas', async () => {
  const nomes = (await tools.getAllDeclarations()).map((d) => d.name);
  for (const n of NOVAS) assert.ok(nomes.includes(n), n);
  const dir = fs.mkdtempSync(path.join(HOME_FALSO, 'glob-'));
  fs.writeFileSync(path.join(dir, 'a.test.js'), '');
  assert.match(await tools.execute('glob_files', { pattern: '*.test.js', path: dir }), /a\.test\.js/);
});

test('modos restritos não recebem as ferramentas de escrita e rede', () => {
  for (const n of ['edit_files', 'web_fetch']) {
    assert.equal(security.GUEST_ALLOWED_TOOLS.includes(n), false, `convidado: ${n}`);
    assert.equal(planMode.opcoes(true).allowedTools.includes(n), false, `modo plano: ${n}`);
  }
});

test('/passo pede aprovação também para edit_files, com prévia de cada arquivo', async () => {
  const perguntas = [];
  let resposta = 'n';
  stepApproval.configurar({ ativo: true, perguntar: async (q) => { perguntas.push(q); return resposta; } });
  try {
    const args = { edits: [{ path: 'a.js', old_text: 'x', new_text: 'y' }, { path: 'b.js', old_text: 'velho', new_text: 'novo', replace_all: true }] };
    const recusa = await stepApproval.checar('edit_files', args);
    assert.equal(recusa.permitido, false);
    assert.match(recusa.motivo, /edit_files em a\.js, b\.js/);
    assert.match(perguntas[0], /edit_files — 2 edição\(ões\)[\s\S]*\[1\/2\] a\.js[\s\S]*- x[\s\S]*\+ y[\s\S]*\[2\/2\] b\.js \(todas as ocorrências\)/);
    resposta = 's';
    assert.equal((await stepApproval.checar('edit_files', args)).permitido, true);
  } finally { stepApproval.configurar({ ativo: false }); }
});

test('análise de risco de workflow gerado por IA marca edit_files e web_fetch', () => {
  const riscos = workflowTools.riscosDoWorkflow({ steps: [{ id: 'a', tools: ['read_file', 'edit_files'] }, { id: 'b', tools: ['web_fetch'] }, { id: 'c', tools: ['glob_files'] }] });
  assert.equal(riscos.length, 2);
  assert.match(riscos[0], /passo "a": pode usar edit_files/);
  assert.match(riscos[1], /passo "b": pode usar web_fetch/);
});

test('loop do agente: edit_files muda dois arquivos numa chamada só', async () => {
  const dir = fs.mkdtempSync(path.join(HOME_FALSO, 'proj-'));
  fs.writeFileSync(path.join(dir, 'a.js'), 'const nome = calcTotal();\n');
  fs.writeFileSync(path.join(dir, 'b.js'), 'module.exports = { calcTotal };\n');
  let passo = 0;
  const resp = (calls, text = '') => ({ functionCalls: () => calls, text: () => text, rawParts: () => calls.map((c) => ({ functionCall: c })) });
  const modelo = async () => (++passo === 1
    ? resp([{ name: 'edit_files', args: { edits: [
      { path: path.join(dir, 'a.js'), old_text: 'calcTotal', new_text: 'calcularTotal' },
      { path: path.join(dir, 'b.js'), old_text: 'calcTotal', new_text: 'calcularTotal' },
    ] } }])
    : resp([], 'feito'));
  const log = console.log;
  console.log = () => {}; // o log de ferramenta no stdout atrapalha o parser do node --test sob carga
  let r;
  try { r = await runOnce('renomeie', { deps: { chatWithTools: modelo, buildSystemInstruction: () => '', loadConfig: () => ({}) } }); } finally { console.log = log; }
  assert.equal(r.text, 'feito');
  assert.equal(fs.readFileSync(path.join(dir, 'a.js'), 'utf8'), 'const nome = calcularTotal();\n');
  assert.equal(fs.readFileSync(path.join(dir, 'b.js'), 'utf8'), 'module.exports = { calcularTotal };\n');
});
