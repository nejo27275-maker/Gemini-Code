// tests/projetos.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME_TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-projetos-test-'));
process.env.HOME = HOME_TEMP;
delete require.cache[require.resolve('../src/config')];
delete require.cache[require.resolve('../src/projetos')];
const projetos = require('../src/projetos');

test.after(() => fs.rmSync(HOME_TEMP, { recursive: true, force: true }));

test('adicionarProjeto + listarProjetos: guarda e lista ordenado por nome', () => {
  projetos.adicionarProjeto('Zebra');
  projetos.adicionarProjeto('Abelha');
  const nomes = projetos.listarProjetos().map((p) => p.nome);
  assert.deepEqual(nomes, ['Abelha', 'Zebra']);
});

test('adicionarProjeto: rejeita nome vazio', () => {
  assert.throws(() => projetos.adicionarProjeto('  '));
});

test('adicionarProjeto: rejeita nome duplicado (case-insensitive)', () => {
  projetos.adicionarProjeto('Duplicado');
  assert.throws(() => projetos.adicionarProjeto('duplicado'));
});

test('atualizarNota: atualiza a nota de um projeto existente', () => {
  projetos.adicionarProjeto('ComNota');
  const atualizado = projetos.atualizarNota('ComNota', 'em andamento');
  assert.equal(atualizado.nota, 'em andamento');
});

test('atualizarNota: devolve null se o projeto não existe', () => {
  assert.equal(projetos.atualizarNota('não existe', 'x'), null);
});

test('removerProjeto: remove pelo nome e devolve true/false corretamente', () => {
  projetos.adicionarProjeto('Removível');
  assert.equal(projetos.removerProjeto('Removível'), true);
  assert.equal(projetos.listarProjetos().some((p) => p.nome === 'Removível'), false);
  assert.equal(projetos.removerProjeto('Removível'), false);
});
