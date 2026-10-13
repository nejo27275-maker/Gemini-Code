// tests/agenda.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// agenda.js lê HOME_DIR de src/config.js na hora do require, então
// aponta pra uma pasta temporária ANTES de exigir os módulos (mesmo
// truque usado nos outros testes que tocam ~/.gemini-code).
const HOME_TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-agenda-test-'));
process.env.HOME = HOME_TEMP;
delete require.cache[require.resolve('../src/config')];
delete require.cache[require.resolve('../src/agenda')];
const agenda = require('../src/agenda');

test.after(() => fs.rmSync(HOME_TEMP, { recursive: true, force: true }));

test('resolverData: --dia no futuro deste mês fica neste mês', () => {
  const agora = new Date(2026, 8, 19); // 19/set/2026
  assert.equal(agenda.resolverData({ dia: 25 }, agora), '2026-09-25');
});

test('resolverData: --dia já passado neste mês vira o mês seguinte', () => {
  const agora = new Date(2026, 8, 19);
  assert.equal(agenda.resolverData({ dia: 5 }, agora), '2026-10-05');
});

test('resolverData: --data explícita sempre vence', () => {
  assert.equal(agenda.resolverData({ data: '2027-01-01' }), '2027-01-01');
});

test('resolverData: rejeita dia inexistente no mês', () => {
  assert.throws(() => agenda.resolverData({ dia: 31, mes: 2, ano: 2026 }));
});

test('resolverData: rejeita quando não dá nem data nem dia', () => {
  assert.throws(() => agenda.resolverData({}));
});

test('adicionarEvento + eventosDoDia: encontra o que foi marcado naquele dia', () => {
  agenda.adicionarEvento('Reunião com o time', { data: '2026-10-07' });
  const { data, eventos } = agenda.eventosDoDia({ data: '2026-10-07' });
  assert.equal(data, '2026-10-07');
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].texto, 'Reunião com o time');
});

test('adicionarEvento: rejeita texto vazio', () => {
  assert.throws(() => agenda.adicionarEvento('   ', { data: '2026-10-07' }));
});

test('listarEventos: vem ordenado por data', () => {
  agenda.adicionarEvento('B', { data: '2026-12-01' });
  agenda.adicionarEvento('A', { data: '2026-11-01' });
  const datas = agenda.listarEventos().map((e) => e.data);
  const ordenado = [...datas].sort();
  assert.deepEqual(datas, ordenado);
});

test('removerEvento: some da lista e devolve true; id inexistente devolve false', () => {
  const evento = agenda.adicionarEvento('Removível', { data: '2026-10-10' });
  assert.equal(agenda.removerEvento(evento.id), true);
  assert.equal(agenda.eventosDoDia({ data: '2026-10-10' }).eventos.length, 0);
  assert.equal(agenda.removerEvento('id-que-nao-existe'), false);
});
