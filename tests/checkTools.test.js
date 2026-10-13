// tests/checkTools.test.js
// detectarComandos() reconhece o tipo de projeto pelos arquivos marcadores
// no cwd — ver comentário em src/tools/checkTools.js.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const checkTools = require('../src/tools/checkTools');
const { detectarComandos, execute } = checkTools;
// v0.3.9: run_checks pede confirmação 1x por sessão; os testes já partem confirmados.
checkTools.sessao.confirmado = true;

function pastaTemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-checktools-test-'));
}

test('detecta npm test e npm run lint a partir do package.json', () => {
  const dir = pastaTemp();
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ scripts: { test: 'node --test', lint: 'eslint .' } })
  );
  const comandos = detectarComandos(dir);
  assert.deepEqual(comandos.map((c) => c.label), ['npm test', 'npm run lint']);
});

test('ignora package.json sem scripts de test/lint', () => {
  const dir = pastaTemp();
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { build: 'x' } }));
  assert.deepEqual(detectarComandos(dir), []);
});

test('detecta projeto Python por requirements.txt', () => {
  const dir = pastaTemp();
  fs.writeFileSync(path.join(dir, 'requirements.txt'), 'pytest\n');
  const comandos = detectarComandos(dir);
  assert.deepEqual(comandos.map((c) => c.label), ['pytest']);
});

test('não quebra com package.json inválido (JSON malformado)', () => {
  const dir = pastaTemp();
  fs.writeFileSync(path.join(dir, 'package.json'), '{ inválido');
  assert.deepEqual(detectarComandos(dir), []);
});

test('run_checks avisa quando não reconhece nenhum marcador', async () => {
  const dir = pastaTemp();
  const resultado = await execute('run_checks', { cwd: dir });
  assert.match(resultado, /Nenhum comando de teste\/lint reconhecido/);
});

test('run_checks erra com clareza quando o diretório não existe', async () => {
  const resultado = await execute('run_checks', { cwd: path.join(os.tmpdir(), 'nao-existe-' + Date.now()) });
  assert.match(resultado, /Erro: diretório não existe/);
});

test('run_checks roda e reporta sucesso para um script simples que passa', async () => {
  const dir = pastaTemp();
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }));
  const resultado = await execute('run_checks', { cwd: dir });
  assert.match(resultado, /Todas as verificações passaram/);
});

test('run_checks roda e reporta falha para um script que retorna erro', async () => {
  const dir = pastaTemp();
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(1)"' } }));
  const resultado = await execute('run_checks', { cwd: dir });
  assert.match(resultado, /Alguma verificação falhou/);
});

// v0.3.7
test('ignora o script "test" de mentira gerado pelo npm init', () => {
  const dir = pastaTemp();
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } })
  );
  assert.deepEqual(detectarComandos(dir), []);
});

test('pytest sem testes (exit 5) ou sem pytest instalado não conta como falha', async () => {
  const { rodar } = require('../src/tools/checkTools');
  const dir = pastaTemp();
  const r1 = await rodar('echo "no tests ran"; exit 5 # pytest', dir);
  assert.equal(r1.ok, true);
  assert.match(r1.ignorado, /nenhum teste/);
  const r2 = await rodar('echo "No module named pytest" 1>&2; exit 1 # pytest', dir);
  assert.equal(r2.ok, true);
  assert.match(r2.ignorado, /não está instalado/);
  const r3 = await rodar('exit 1', dir);
  assert.equal(r3.ok, false);
});
