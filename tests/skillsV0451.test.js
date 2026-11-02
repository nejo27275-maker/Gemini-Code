'use strict';
// v0.45.1: read_skill aceita a pasta da skill e o nome dela; SKILL.md ilegível não derruba a lista.
const fs = require('fs');
const os = require('os');
const path = require('path');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-skills-'));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
const test = require('node:test');
const assert = require('node:assert/strict');
const { SKILLS_DIR } = require('../src/config');
const loader = require('../src/skills/loader');

const pasta = path.join(SKILLS_DIR, 'revisao-de-codigo');
fs.mkdirSync(pasta, { recursive: true });
fs.writeFileSync(path.join(pasta, 'SKILL.md'), '---\nname: revisao\ndescription: revisa código\n---\nOlhe os testes primeiro.\n');

test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

test('pelo caminho do SKILL.md, pela pasta e pelo nome (do front matter ou da pasta)', async () => {
  for (const pedido of [path.join(pasta, 'SKILL.md'), pasta, 'revisao', 'revisao-de-codigo', 'REVISAO']) {
    assert.equal(await loader.execute('read_skill', { path: pedido }), 'Olhe os testes primeiro.', pedido);
  }
});

test('não encontrada: lista as instaladas; nome com barra não procura por nome', async () => {
  assert.match(await loader.execute('read_skill', { path: 'nao-existe' }), /^Erro: skill não encontrada: nao-existe \(instaladas: revisao\)$/);
  assert.match(await loader.execute('read_skill', { path: 'x/revisao' }), /^Erro: skill não encontrada/);
});

test('SKILL.md que é uma pasta (ilegível como arquivo) não derruba a lista', () => {
  const quebrada = path.join(SKILLS_DIR, 'quebrada', 'SKILL.md');
  fs.mkdirSync(quebrada, { recursive: true });
  try {
    assert.deepEqual(loader.listSkills().map((s) => s.name), ['revisao']);
  } finally { fs.rmSync(path.dirname(quebrada), { recursive: true, force: true }); }
});

test('arquivo grande demais é recusado', async () => {
  const grande = path.join(HOME, 'grande.md');
  fs.writeFileSync(grande, 'x'.repeat(600 * 1024));
  assert.match(await loader.execute('read_skill', { path: grande }), /grande demais para uma skill/);
});
