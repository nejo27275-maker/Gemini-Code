// tests/editFile.test.js
// edit_file substitui um trecho exato por outro, exigindo que o trecho seja
// único no arquivo (ver item 2 da revisão em fileTools.js).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execute, isProtected } = require('../src/tools/fileTools');
const { CONFIG_PATH } = require('../src/config');

function arquivoTemp(conteudo) {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-test-')), 'arquivo.txt');
  fs.writeFileSync(p, conteudo, 'utf8');
  return p;
}

test('substitui um trecho único com sucesso', async () => {
  const p = arquivoTemp('linha 1\nALVO\nlinha 3\n');
  const resultado = await execute('edit_file', { path: p, old_text: 'ALVO', new_text: 'SUBSTITUIDO' });
  assert.match(resultado, /^Editado:/);
  assert.equal(fs.readFileSync(p, 'utf8'), 'linha 1\nSUBSTITUIDO\nlinha 3\n');
});

test('recusa quando old_text não existe no arquivo', async () => {
  const p = arquivoTemp('conteúdo qualquer\n');
  const resultado = await execute('edit_file', { path: p, old_text: 'não existe', new_text: 'x' });
  assert.match(resultado, /não encontrado/);
  // arquivo não deve ter sido tocado
  assert.equal(fs.readFileSync(p, 'utf8'), 'conteúdo qualquer\n');
});

test('recusa quando old_text aparece mais de uma vez', async () => {
  const p = arquivoTemp('repete\nrepete\n');
  const resultado = await execute('edit_file', { path: p, old_text: 'repete', new_text: 'x' });
  assert.match(resultado, /aparece 2 vezes/);
  assert.equal(fs.readFileSync(p, 'utf8'), 'repete\nrepete\n');
});

test('recusa editar um arquivo que não existe', async () => {
  const p = path.join(os.tmpdir(), 'gemini-code-test-nao-existe-' + Date.now(), 'x.txt');
  const resultado = await execute('edit_file', { path: p, old_text: 'a', new_text: 'b' });
  assert.match(resultado, /não existe/);
});

test('bloqueia edição do config.json protegido', async () => {
  assert.equal(isProtected(CONFIG_PATH), true);
  const resultado = await execute('edit_file', { path: CONFIG_PATH, old_text: 'a', new_text: 'b' });
  assert.match(resultado, /Bloqueado/);
});
