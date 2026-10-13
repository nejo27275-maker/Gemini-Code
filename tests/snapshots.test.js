'use strict';
// v0.12.1: fotos automáticas com git em referência escondida.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const snap = require('../src/snapshots');

const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
function repo() {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gc-snap-repo-')));
  sh(d, 'init', '-q');
  sh(d, 'config', 'user.email', 'a@b.c'); sh(d, 'config', 'user.name', 'x');
  fs.writeFileSync(path.join(d, 'a.txt'), 'v1');
  sh(d, 'add', '.'); sh(d, 'commit', '-qm', 'base');
  return d;
}

test('fora de um repositório git não faz nada', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-snap-nogit-'));
  assert.equal(snap.tirar({ cwd: d }), null);
  assert.deepEqual(snap.listar({ cwd: d }), []);
  assert.throws(() => snap.restaurar({ cwd: d }), /não é um repositório/);
});

test('tira foto sem mexer em branch, índice ou histórico; nada mudou = sem foto nova', () => {
  const d = repo();
  const headAntes = sh(d, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(d, 'a.txt'), 'v2');
  fs.writeFileSync(path.join(d, 'novo.txt'), 'n');
  const f = snap.tirar({ cwd: d, rotulo: 'primeira' });
  assert.ok(f && f.curto.length === 7);
  assert.equal(sh(d, 'rev-parse', 'HEAD'), headAntes);
  assert.equal(sh(d, 'status', '--porcelain', '--untracked-files=all').split('\n').sort().join('|'), '?? novo.txt|M a.txt', 'índice e árvore de trabalho intocados');
  assert.equal(sh(d, 'branch', '--list').split('\n').length, 1);
  assert.equal(snap.tirar({ cwd: d, rotulo: 'igual' }), null);
  assert.equal(snap.listar({ cwd: d }).length, 1);
});

test('segredos ficam fora da foto', () => {
  const d = repo();
  fs.writeFileSync(path.join(d, '.env'), 'KEY=segredo');
  fs.writeFileSync(path.join(d, 'chave.pem'), 'x');
  fs.writeFileSync(path.join(d, 'ok.js'), '1');
  const f = snap.tirar({ cwd: d });
  const arquivos = sh(d, 'ls-tree', '-r', '--name-only', f.commit).split('\n');
  assert.ok(arquivos.includes('ok.js'));
  assert.ok(!arquivos.includes('.env') && !arquivos.includes('chave.pem'));
});

test('restaurar volta o conteúdo (inclusive o que o shell mudou) e é reversível', () => {
  const d = repo();
  fs.writeFileSync(path.join(d, 'a.txt'), 'bom');
  snap.tirar({ cwd: d, rotulo: 'bom' });
  fs.writeFileSync(path.join(d, 'a.txt'), 'estragado');
  fs.rmSync(path.join(d, 'a.txt'));
  const r = snap.restaurar({ n: 1, cwd: d });
  assert.equal(fs.readFileSync(path.join(d, 'a.txt'), 'utf8'), 'bom');
  assert.ok(r.fotoAntes, 'o estado de antes da restauração foi salvo');
  fs.writeFileSync(path.join(d, 'a.txt'), 'outra coisa');
  snap.restaurar({ n: 2, cwd: d }); // 2 = foto "antes de restaurar" (arquivo apagado) -> mais nova é a de n=1
  assert.throws(() => snap.restaurar({ n: 99, cwd: d }), /Só existem/);
});
