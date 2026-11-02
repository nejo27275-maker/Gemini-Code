'use strict';
// v0.45.1: search_files — arquivo como "path", \r\n, file_glob com glob, .gitignore, regex com prazo e trecho centrado.
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const PROJ = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gc-busca-')));
const antes = process.cwd();
process.chdir(PROJ);
const search = require('../src/tools/searchTools');

fs.mkdirSync('src/sub', { recursive: true });
fs.mkdirSync('saida', { recursive: true });
fs.writeFileSync('src/a.js', 'const alvo = 1;\n');
fs.writeFileSync('src/sub/b.ts', 'export const alvo = 2;\n');
fs.writeFileSync('src/c.md', 'alvo no texto\n');
fs.writeFileSync('windows.txt', 'primeira linha fim\r\nsegunda\r\n');
fs.writeFileSync('saida/gerado.js', 'const alvo = "gerado";\n');
fs.writeFileSync('.gitignore', 'saida/\n');
fs.writeFileSync('longa.txt', `${'x'.repeat(500)} AQUI_ESTA ${'y'.repeat(500)}\n`);
fs.writeFileSync('lento.txt', `${'a'.repeat(40)}!\n`);

test.after(() => { process.chdir(antes); fs.rmSync(PROJ, { recursive: true, force: true }); });

test('"path" pode ser um arquivo', async () => {
  const r = await search.execute('search_files', { pattern: 'alvo', path: 'src/a.js' });
  assert.match(r, /^src\/a\.js:1: const alvo = 1;$/);
});

test('linhas \\r\\n: âncora $ funciona e o \\r não aparece', async () => {
  const r = await search.execute('search_files', { pattern: 'fim$', is_regex: true, path: 'windows.txt' });
  assert.match(r, /windows\.txt:1: primeira linha fim$/);
  assert.ok(!r.includes('\r'));
});

test('file_glob aceita glob ("*.js", "src/**/*.ts") e continua aceitando sufixo (".md")', async () => {
  const js = await search.execute('search_files', { pattern: 'alvo', file_glob: '*.js' });
  assert.match(js, /src\/a\.js:1/);
  assert.doesNotMatch(js, /b\.ts|c\.md/);
  const ts = await search.execute('search_files', { pattern: 'alvo', file_glob: 'src/**/*.ts' });
  assert.match(ts, /src\/sub\/b\.ts:1/);
  assert.doesNotMatch(ts, /a\.js/);
  assert.match(await search.execute('search_files', { pattern: 'alvo', file_glob: '.md' }), /src\/c\.md:1/);
  assert.match(await search.execute('search_files', { pattern: 'alvo', file_glob: '[z-a]*' }), /^Erro: file_glob inválido/);
});

test('o que o .gitignore ignora fica de fora', async () => {
  const r = await search.execute('search_files', { pattern: 'gerado' });
  assert.match(r, /^Nenhuma ocorrência/);
  // pedir a pasta ignorada de propósito continua funcionando
  assert.match(await search.execute('search_files', { pattern: 'gerado', path: 'saida' }), /gerado\.js:1/);
});

test('linha longa mostra o trecho em volta da ocorrência', async () => {
  const r = await search.execute('search_files', { pattern: 'AQUI_ESTA', path: 'longa.txt' });
  assert.match(r, /longa\.txt:1: …x+ AQUI_ESTA y+…$/);
  assert.ok(r.length < 260, `trecho curto (${r.length})`);
});

test('regex com backtracking catastrófico é interrompida no prazo e o processo segue vivo', async () => {
  const inicio = Date.now();
  const r = await search.execute('search_files', { pattern: '^(a+)+$', is_regex: true, path: 'lento.txt' }, { prazoMs: 500 });
  assert.match(r, /^Erro: a regex levou mais de 0\.5 s/);
  assert.ok(Date.now() - inicio < 5000, 'não esperou a regex terminar');
  // uma regex normal continua funcionando (na thread separada)
  assert.match(await search.execute('search_files', { pattern: 'alv[o]', is_regex: true, file_glob: '*.js' }), /src\/a\.js:1/);
});
