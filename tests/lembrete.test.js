'use strict';
// v0.46.0: rotina "lembrete" — só uma notificação no horário, sem IA.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const HOME_FALSO = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-lembrete-'));
process.env.HOME = HOME_FALSO;
process.env.USERPROFILE = HOME_FALSO;

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoutineStore } = require('../src/routines');
const { createRoutineRunner } = require('../src/routineRunner');

const BIN = path.join(__dirname, '..', 'bin', 'gemini-code.js');
const gatilho = { type: 'cron', expression: '0 8 * * *', timezone: 'UTC' };

function loja() {
  const dir = fs.mkdtempSync(path.join(HOME_FALSO, 'rotinas-'));
  return createRoutineStore({ dataPath: path.join(dir, 'routines.json'), executionsPath: path.join(dir, 'executions.json') });
}

test.after(() => fs.rmSync(HOME_FALSO, { recursive: true, force: true }));

test('validação: texto obrigatório e limitado; título padrão; controles invisíveis saem', () => {
  const store = loja();
  const r = store.create({ name: 'Remédio', trigger: gatilho, action: { type: 'lembrete', texto: 'Tomar‮ losartana' } });
  assert.deepEqual(r.action, { type: 'lembrete', titulo: 'Lembrete', texto: 'Tomar losartana' });
  assert.equal(r.category, 'lembrete');
  assert.throws(() => store.create({ name: 'x', trigger: gatilho, action: { type: 'lembrete', texto: '' } }), /precisa de um texto/);
  assert.throws(() => store.create({ name: 'x', trigger: gatilho, action: { type: 'lembrete', texto: 'a'.repeat(501) } }), /até 500/);
});

test('execução: notifica com título e texto; sem notificação disponível falha (e não repete)', async () => {
  const store = loja();
  const r = store.create({ name: 'Remédio', trigger: gatilho, action: { type: 'lembrete', titulo: 'Remédio', texto: 'Losartana 50mg' } });
  const avisos = [];
  const log = () => {};
  let runner = createRoutineRunner({ store, lembrete: { notificarFn: async (t, x) => { avisos.push([t, x]); return 'enviada'; }, log } });
  const ok = await runner.execute(r.id);
  assert.equal(ok.status, 'concluida');
  assert.deepEqual(avisos, [['Remédio', 'Losartana 50mg']]);
  let chamadas = 0;
  runner = createRoutineRunner({ store, maxRetries: 3, baseRetryMs: 1, lembrete: { notificarFn: async () => { chamadas++; return 'indisponível'; }, log } });
  const falha = await runner.execute(r.id);
  assert.equal(falha.status, 'falhou');
  assert.match(falha.error, /Termux:API/);
  assert.equal(chamadas, 1, 'lembrete não repete');
});

test('terminal: routines create --lembrete cria o rascunho', () => {
  const r = spawnSync(process.execPath, [BIN, 'routines', 'create', '--name', 'Conta de luz', '--lembrete', 'Pagar a conta de luz', '--titulo', 'Contas', '--cron', '0 9 10 * *'], {
    encoding: 'utf8', env: { ...process.env, HOME: HOME_FALSO, USERPROFILE: HOME_FALSO },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Rotina criada como rascunho[\s\S]*\| lembrete \|/);
});
