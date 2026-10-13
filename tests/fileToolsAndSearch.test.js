// tests/fileToolsAndSearch.test.js
// Cobre os itens 1 e 3 da revisão: read_file/list_dir com tratamento de
// erro, e a tool search_files (grep) nova.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fileTools = require('../src/tools/fileTools');
const searchTools = require('../src/tools/searchTools');

function pastaTemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-test-'));
}

test('read_file avisa quando o arquivo não existe (em vez de lançar exceção crua)', async () => {
  const resultado = await fileTools.execute('read_file', { path: path.join(os.tmpdir(), 'nao-existe-' + Date.now()) });
  assert.match(resultado, /não existe/);
});

test('read_file avisa quando o caminho é um diretório', async () => {
  const dir = pastaTemp();
  const resultado = await fileTools.execute('read_file', { path: dir });
  assert.match(resultado, /diretório/);
});

test('read_file detecta conteúdo binário e não tenta ler como texto', async () => {
  const dir = pastaTemp();
  const p = path.join(dir, 'binario.dat');
  fs.writeFileSync(p, Buffer.from([0, 1, 2, 3, 0, 4]));
  const resultado = await fileTools.execute('read_file', { path: p });
  assert.match(resultado, /binário/);
});

test('list_dir avisa quando o diretório não existe', async () => {
  const resultado = await fileTools.execute('list_dir', { path: path.join(os.tmpdir(), 'nao-existe-' + Date.now()) });
  assert.match(resultado, /não existe/);
});

test('list_dir mostra "(vazio)" para pasta sem conteúdo', async () => {
  const dir = pastaTemp();
  const resultado = await fileTools.execute('list_dir', { path: dir });
  assert.equal(resultado, '(vazio)');
});

test('search_files encontra uma ocorrência literal e reporta o número da linha', async () => {
  const dir = pastaTemp();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'linha 1\nprocurando ALVO aqui\nlinha 3\n');
  const resultado = await searchTools.execute('search_files', { pattern: 'ALVO', path: dir });
  assert.match(resultado, /a\.txt:2:/);
});

test('search_files respeita file_glob (filtro de extensão)', async () => {
  const dir = pastaTemp();
  fs.writeFileSync(path.join(dir, 'certo.js'), 'const alvo = 1;');
  fs.writeFileSync(path.join(dir, 'errado.md'), 'const alvo = 1;');
  const resultado = await searchTools.execute('search_files', { pattern: 'alvo', path: dir, file_glob: '.js' });
  assert.match(resultado, /certo\.js/);
  assert.doesNotMatch(resultado, /errado\.md/);
});

test('search_files ignora node_modules', async () => {
  const dir = pastaTemp();
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'node_modules', 'lib.js'), 'ALVO aqui');
  const resultado = await searchTools.execute('search_files', { pattern: 'ALVO', path: dir });
  assert.match(resultado, /Nenhuma ocorrência/);
});

// v0.3.6
test('read_file com start_line/end_line devolve só o trecho, numerado', async () => {
  const dir = pastaTemp();
  const p = path.join(dir, 'a.txt');
  fs.writeFileSync(p, Array.from({ length: 20 }, (_, i) => `linha${i + 1}`).join('\n'));
  const r = await fileTools.execute('read_file', { path: p, start_line: 5, end_line: 7 });
  assert.match(r, /5\tlinha5/);
  assert.match(r, /7\tlinha7/);
  assert.ok(!r.includes('linha8'));
  assert.match(r, /\[linhas 5-7 de 20\]/);
});

test('read_file só com start_line lê até o fim; intervalo inválido dá erro claro', async () => {
  const dir = pastaTemp();
  const p = path.join(dir, 'b.txt');
  fs.writeFileSync(p, 'a\nb\nc');
  assert.match(await fileTools.execute('read_file', { path: p, start_line: 2 }), /\[linhas 2-3 de 3\]/);
  assert.match(await fileTools.execute('read_file', { path: p, start_line: 0 }), /intervalo inválido/);
  assert.match(await fileTools.execute('read_file', { path: p, start_line: 3, end_line: 2 }), /intervalo inválido/);
  assert.match(await fileTools.execute('read_file', { path: p, start_line: 99 }), /passa do fim/);
});

test('write_file sem content não grava "undefined" no arquivo', async () => {
  const dir = pastaTemp();
  const p = path.join(dir, 'c.txt');
  const r = await fileTools.execute('write_file', { path: p });
  assert.match(r, /content/);
  assert.ok(!fs.existsSync(p));
});

test('edit_file recusa old_text vazio e new_text ausente', async () => {
  const dir = pastaTemp();
  const p = path.join(dir, 'd.txt');
  fs.writeFileSync(p, 'abc');
  assert.match(await fileTools.execute('edit_file', { path: p, old_text: '', new_text: 'x' }), /vazio/);
  assert.match(await fileTools.execute('edit_file', { path: p, old_text: 'a' }), /new_text/);
  assert.equal(fs.readFileSync(p, 'utf8'), 'abc');
});

// v0.3.7
test('search_files com ignore_case encontra independente de maiúsculas e valida pattern', async () => {
  const dir = pastaTemp();
  fs.writeFileSync(path.join(dir, 'x.txt'), 'Olá MUNDO\nsegunda');
  assert.match(await searchTools.execute('search_files', { pattern: 'mundo', path: dir }), /Nenhuma ocorrência/);
  assert.match(await searchTools.execute('search_files', { pattern: 'mundo', path: dir, ignore_case: true }), /x\.txt:1/);
  assert.match(await searchTools.execute('search_files', { path: dir }), /precisa de "pattern"/);
});
