// tests/backup.test.js
// backupBeforeWrite() salva o conteúdo anterior de um arquivo existente
// antes de write_file/edit_file sobrescreverem — ver comentário em
// src/tools/backup.js.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { backupBeforeWrite, pastaBackupPara } = require('../src/tools/backup');

function arquivoTemp(conteudo) {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-backup-test-')), 'arquivo.txt');
  fs.writeFileSync(p, conteudo, 'utf8');
  return p;
}

test('cria um backup com o conteúdo anterior quando o arquivo já existe', () => {
  const p = arquivoTemp('conteúdo original\n');
  const destino = backupBeforeWrite(p);
  assert.ok(destino, 'deveria ter criado um backup');
  assert.equal(fs.readFileSync(destino, 'utf8'), 'conteúdo original\n');
  fs.rmSync(path.dirname(destino), { recursive: true, force: true });
});

test('não cria backup quando o arquivo ainda não existe (criação nova)', () => {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-backup-test-')), 'novo.txt');
  const destino = backupBeforeWrite(p);
  assert.equal(destino, null);
});

test('não cria backup para um diretório passado por engano', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-backup-test-'));
  const destino = backupBeforeWrite(dir);
  assert.equal(destino, null);
});

test('backups sucessivos do mesmo arquivo vão para a mesma pasta espelhada', () => {
  const p = arquivoTemp('v1\n');
  const d1 = backupBeforeWrite(p);
  fs.writeFileSync(p, 'v2\n', 'utf8');
  const d2 = backupBeforeWrite(p);
  assert.equal(path.dirname(d1), path.dirname(d2));
  assert.equal(path.dirname(d1), pastaBackupPara(path.resolve(p)));
  fs.rmSync(path.dirname(d1), { recursive: true, force: true });
});

// v0.3.7
test('caminhos muito longos geram nome de backup curto e único (não estoura 255 bytes)', () => {
  const longo = '/' + Array.from({ length: 30 }, (_, i) => `pasta-bem-comprida-${i}`).join('/') + '/arquivo.js';
  const a = pastaBackupPara(longo);
  const b = pastaBackupPara(longo.replace('arquivo.js', 'outro.js'));
  assert.ok(Buffer.byteLength(path.basename(a)) < 255);
  assert.notEqual(a, b);
  assert.equal(pastaBackupPara(longo), a); // determinístico
});
