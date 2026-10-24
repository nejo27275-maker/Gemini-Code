#!/usr/bin/env node
'use strict';

// ESLint é opcional. Quando presente, usa a configuração do repositório (eslint.config.js, formato do
// ESLint 9/10) e falha também com aviso (--max-warnings 0: o projeto está em zero e assim fica).
// Sem ele (por exemplo, execução em ambiente offline), valida a sintaxe de
// todos os JavaScript rastreados pelas pastas do projeto com o parser do Node.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const eslintCli = path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js');

if (fs.existsSync(eslintCli)) {
  // v0.43.3: sem "--ext", que o ESLint 9+ removeu (o lint quebrava para quem tivesse um ESLint atual).
  const run = spawnSync(process.execPath, [eslintCli, '.', '--max-warnings', '0'], {
    cwd: root, stdio: 'inherit', env: process.env,
  });
  process.exit(run.status ?? 1);
}

const ignored = new Set(['node_modules', '.git', 'coverage', 'dist']);
const files = [];
function visit(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignored.has(entry.name)) visit(path.join(dir, entry.name));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(path.join(dir, entry.name));
    }
  }
}
visit(root);
let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: root, encoding: 'utf8', env: process.env,
  });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(`\nSintaxe inválida: ${path.relative(root, file)}\n`);
    if (result.stderr) process.stderr.write(result.stderr);
  }
}
if (failed) process.exit(1);
console.log(`Verificação sintática aprovada em ${files.length} arquivos JavaScript.`);
console.log('Aviso: ESLint não está instalado; regras de estilo não foram executadas.');
