'use strict';
// v0.12.0: /rewind — desfazer por turno (write_file/edit_file).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const rewind = require('../src/rewind');
const fileTools = require('../src/tools/fileTools');

function ambiente() {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-rw-proj-'));
  rewind.definirPasta(fs.mkdtempSync(path.join(os.tmpdir(), 'gc-rw-dir-')));
  return proj;
}

test('desfaz criação, sobrescrita e edição de um turno', async () => {
  const proj = ambiente();
  const a = path.join(proj, 'a.txt');
  const novo = path.join(proj, 'sub', 'novo.txt');
  fs.writeFileSync(a, 'original');
  rewind.iniciarTurno('mexe nos arquivos', { cwd: proj });
  await fileTools.execute('write_file', { path: a, content: 'trocado' });
  await fileTools.execute('edit_file', { path: a, old_text: 'trocado', new_text: 'editado' });
  await fileTools.execute('write_file', { path: novo, content: 'criado' });
  assert.deepEqual(rewind.finalizarTurno(), { id: rewind.listar({ cwd: proj })[0].id, arquivos: 2 });
  const r = rewind.desfazer({ cwd: proj });
  assert.equal(fs.readFileSync(a, 'utf8'), 'original', 'volta ao estado de ANTES do turno, não ao intermediário');
  assert.equal(fs.existsSync(novo), false);
  assert.deepEqual([r.restaurados.length, r.removidos.length, r.conflitos.length], [1, 1, 0]);
  assert.equal(rewind.listar({ cwd: proj }).length, 0, 'turno desfeito sai da lista');
});

test('não sobrescreve o que mudou depois do agente, a menos que --force', async () => {
  const proj = ambiente();
  const a = path.join(proj, 'a.txt');
  fs.writeFileSync(a, 'v0');
  rewind.iniciarTurno('x', { cwd: proj });
  await fileTools.execute('write_file', { path: a, content: 'v1' });
  rewind.finalizarTurno();
  fs.writeFileSync(a, 'v2 (eu mexi)');
  const r = rewind.desfazer({ cwd: proj });
  assert.equal(r.conflitos.length, 1);
  assert.equal(fs.readFileSync(a, 'utf8'), 'v2 (eu mexi)');
  assert.match(rewind.formatar(r), /--force/);
  rewind.desfazer({ cwd: proj, force: true });
  assert.equal(fs.readFileSync(a, 'utf8'), 'v0');
});

test('turno sem arquivos não grava nada; /rewind N volta vários turnos na ordem certa', async () => {
  const proj = ambiente();
  const a = path.join(proj, 'a.txt');
  rewind.iniciarTurno('só conversa', { cwd: proj });
  assert.equal(rewind.finalizarTurno(), null);
  assert.match(rewind.formatar(rewind.desfazer({ cwd: proj })), /Nada para desfazer/);
  for (const v of ['1', '2', '3']) {
    rewind.iniciarTurno('v' + v, { cwd: proj });
    await fileTools.execute('write_file', { path: a, content: v });
    rewind.finalizarTurno();
  }
  assert.equal(rewind.listar({ cwd: proj }).length, 3);
  rewind.desfazer({ cwd: proj, n: 2 });
  assert.equal(fs.readFileSync(a, 'utf8'), '1');
  rewind.desfazer({ cwd: proj });
  assert.equal(fs.existsSync(a), false, 'o primeiro turno criou o arquivo, então some');
});

test('turnos de outro projeto não são afetados; mantém no máximo MAX_TURNOS', async () => {
  const proj = ambiente();
  const outro = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-rw-outro-'));
  rewind.iniciarTurno('outro', { cwd: outro });
  await fileTools.execute('write_file', { path: path.join(outro, 'o.txt'), content: 'o' });
  rewind.finalizarTurno();
  assert.equal(rewind.listar({ cwd: proj }).length, 0);
  assert.equal(rewind.desfazer({ cwd: proj }).turnos, 0);
  for (let i = 0; i < rewind.MAX_TURNOS + 3; i++) {
    rewind.iniciarTurno('t' + i, { cwd: proj });
    await fileTools.execute('write_file', { path: path.join(proj, `f${i}.txt`), content: 'x' });
    rewind.finalizarTurno();
  }
  assert.ok(rewind.listar({ cwd: proj, limite: 100 }).length <= rewind.MAX_TURNOS);
});

test('arquivo grande demais é avisado, não apagado em silêncio', async () => {
  const proj = ambiente();
  const g = path.join(proj, 'grande.bin');
  fs.writeFileSync(g, Buffer.alloc(rewind.MAX_BYTES_ARQUIVO + 1, 1));
  rewind.iniciarTurno('g', { cwd: proj });
  await fileTools.execute('write_file', { path: g, content: 'pequeno' });
  rewind.finalizarTurno();
  const r = rewind.desfazer({ cwd: proj });
  assert.equal(r.naoRastreados.length, 1);
  assert.equal(fs.readFileSync(g, 'utf8'), 'pequeno');
});

test('fora de um turno, registrar() não faz nada e não lança', async () => {
  const proj = ambiente();
  rewind.registrar(path.join(proj, 'x'));
  await fileTools.execute('write_file', { path: path.join(proj, 'x'), content: '1' });
  assert.equal(rewind.finalizarTurno(), null);
});

test('v0.18.0: ids de turnos criados no mesmo milissegundo continuam em ordem crescente', () => {
  const rw = require('../src/rewind');
  const ids = Array.from({ length: 50 }, () => rw.iniciarTurno('x'));
  assert.deepEqual([...ids].sort(), ids);
  assert.equal(new Set(ids).size, 50);
});
