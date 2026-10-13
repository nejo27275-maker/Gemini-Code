// tests/touchesProtectedFile.test.js
// touchesProtectedFile() decide se um comando de shell deve forçar
// confirmação por mexer no config.json/mcp.json do próprio gemini-code,
// mesmo com confirmShell:false (ver comentário no topo de shellTools.js).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { touchesProtectedFile } = require('../src/tools/shellTools');
const { CONFIG_PATH, MCP_PATH } = require('../src/config');

test('detecta o caminho completo do config.json', () => {
  assert.equal(touchesProtectedFile(`cat ${CONFIG_PATH}`), true);
});

test('detecta o caminho completo do mcp.json', () => {
  assert.equal(touchesProtectedFile(`rm ${MCP_PATH}`), true);
});

test('detecta pelo nome do arquivo, sem o caminho completo', () => {
  assert.equal(touchesProtectedFile(`echo oi > ${path.basename(CONFIG_PATH)}`), true);
});

test('não marca comando comum como protegido', () => {
  assert.equal(touchesProtectedFile('ls -la'), false);
  assert.equal(touchesProtectedFile('git status'), false);
});

test('não marca um arquivo de nome totalmente diferente', () => {
  assert.equal(touchesProtectedFile('cat notas.txt'), false);
});

test('é conservador por segurança: nomes que CONTÊM "config.json" também disparam confirmação', () => {
  // Comportamento intencional (erra para o lado seguro): um arquivo como
  // "meuconfig.json" contém a substring "config.json" e também força
  // confirmação, mesmo não sendo o config.json do gemini-code de verdade.
  assert.equal(touchesProtectedFile('cat meuconfig.json'), true);
});
