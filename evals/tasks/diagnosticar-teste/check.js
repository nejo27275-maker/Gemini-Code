'use strict';
// Verificador oculto. Uso: node check.js <workspace>
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ws = process.argv[2];
const testeRel = path.join('test', 'duracao.test.js');
assert.equal(
  fs.readFileSync(path.join(ws, testeRel), 'utf8'),
  fs.readFileSync(path.join(__dirname, 'workspace', testeRel), 'utf8'),
  'o arquivo de teste não podia ser alterado',
);

const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;
const r = spawnSync(process.execPath, ['--test', testeRel], { cwd: ws, encoding: 'utf8', timeout: 30000, env });
assert.equal(r.status, 0, `os testes do projeto continuam falhando:\n${(r.stdout || '').slice(-1500)}`);

const { parseDuracao } = require(path.join(ws, 'src', 'duracao.js'));
assert.equal(parseDuracao('2h 5m 10s'), 7510);
assert.equal(parseDuracao('12m'), 720);
assert.equal(parseDuracao('100s'), 100);
assert.equal(parseDuracao(''), 0);
console.log('ok');
