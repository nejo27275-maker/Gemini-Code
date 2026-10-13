'use strict';
// Conhecimento fixo (src/knowledge.js) e sua entrada no prompt do sistema.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-know-'));
process.env.HOME = home;
const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-proj-'));

const k = require('../src/knowledge');
const { buildSystemInstruction } = require('../src/agent');

test('sem nada carregado: texto vazio e prompt sem a seção', () => {
  const r = k.loadKnowledge({ cwd: proj });
  assert.equal(r.text, '');
  assert.ok(!buildSystemInstruction(undefined, { cwd: proj }).includes('Conhecimento fixo'));
});

test('knowledge add copia .md e vai pro prompt', () => {
  const spec = path.join(proj, 'netolang.md');
  fs.writeFileSync(spec, '# NetoLang\nfn soma(a, b) => a + b');
  const [copiado] = k.addKnowledge(spec);
  assert.ok(copiado.startsWith(k.knowledgeDir()));
  assert.equal(k.listKnowledge().length, 1);
  const prompt = buildSystemInstruction('extra da persona', { cwd: proj });
  assert.ok(prompt.includes('fn soma(a, b) => a + b'));
  assert.ok(prompt.includes('Conhecimento fixo'));
  assert.ok(prompt.endsWith('extra da persona'));
});

test('GEMINI.md do projeto vem antes do conhecimento global', () => {
  fs.writeFileSync(path.join(proj, 'GEMINI.md'), 'REGRA DO PROJETO');
  const r = k.loadKnowledge({ cwd: proj });
  assert.ok(r.text.indexOf('REGRA DO PROJETO') < r.text.indexOf('NetoLang'));
  assert.equal(r.files.length, 2);
});

test('acha GEMINI.md subindo de subpastas', () => {
  const sub = path.join(proj, 'a', 'b');
  fs.mkdirSync(sub, { recursive: true });
  assert.ok(k.loadKnowledge({ cwd: sub }).text.includes('REGRA DO PROJETO'));
});

test('respeita o orçamento e avisa que cortou', () => {
  fs.writeFileSync(path.join(proj, 'GEMINI.md'), 'A'.repeat(5000));
  const r = k.loadKnowledge({ cwd: proj, maxChars: 1000 });
  assert.ok(r.text.length <= 1000);
  assert.equal(r.truncated, true);
  assert.ok(r.text.includes('cortado'));
});

test('addKnowledge recusa extensão errada e arquivo inexistente', () => {
  const bin = path.join(proj, 'x.exe');
  fs.writeFileSync(bin, 'x');
  assert.throws(() => k.addKnowledge(bin), /\.md ou \.txt/);
  assert.throws(() => k.addKnowledge(path.join(proj, 'nao-existe.md')), /ENOENT/);
});
