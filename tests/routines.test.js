'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createRoutineStore, parseDuration, parseCron, cronMatches, nextCronDate,
  STATUSES,
} = require('../src/routines');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-routines-'));
  return createRoutineStore({ dataPath: path.join(dir, 'routines.json'), executionsPath: path.join(dir, 'executions.json') });
}

const base = (overrides = {}) => ({
  name: 'Health check', action: { type: 'http-check', url: 'https://example.com', timeoutMs: 1000 },
  trigger: { type: 'interval', intervalMs: 60000, timezone: 'America/Recife' }, ...overrides,
});

test('parseDuration converte unidades comuns e rejeita formato inválido', () => {
  assert.equal(parseDuration('30s'), 30000);
  assert.equal(parseDuration('5m'), 300000);
  assert.equal(parseDuration('2h'), 7200000);
  assert.throws(() => parseDuration('muitas vezes'), /Duração inválida/);
});

test('cron valida campos, aceita domingo 7 e calcula próxima execução', () => {
  assert.equal(parseCron('*/5 * * * *').minute.size, 12);
  assert.equal(cronMatches('0 8 * * 1-5', new Date('2026-10-05T11:00:00Z'), 'America/Recife'), true);
  assert.equal(cronMatches('0 8 * * 1-5', new Date('2026-10-04T11:00:00Z'), 'America/Recife'), false);
  assert.equal(cronMatches('0 8 * * 7', new Date('2026-10-04T11:00:00Z'), 'America/Recife'), true);
  assert.equal(nextCronDate('*/5 * * * *', new Date('2026-10-10T12:01:00Z'), 'UTC'), '2026-10-10T12:05:00.000Z');
  assert.throws(() => parseCron('* * *'), /cinco campos/);
});

test('cria rotinas como rascunho e preserva dados em novo store', () => {
  const store = setup();
  const now = new Date('2026-10-10T12:00:00.000Z');
  const routine = store.create(base(), now);
  assert.equal(routine.status, STATUSES.DRAFT);
  assert.equal(routine.nextRunAt, '2026-10-10T12:01:00.000Z');
  const reopened = createRoutineStore({ dataPath: store.dataPath, executionsPath: store.executionsPath });
  assert.equal(reopened.get(routine.id).name, 'Health check');
});

test('valida ação, fuso, intervalo e execução única futura', () => {
  const store = setup();
  assert.throws(() => store.create(base({ action: { type: 'shell', command: 'rm -rf /' } })), /Use http-check .*, agente .* ou adb/);
  assert.throws(() => store.create(base({ action: { type: 'http-check', url: 'file:///etc/passwd' } })), /HTTP\/HTTPS/);
  assert.throws(() => store.create(base({ trigger: { type: 'interval', intervalMs: 1000, timezone: 'UTC' } })), /entre 1 minuto/);
  assert.throws(() => store.create(base({ trigger: { type: 'interval', intervalMs: 60000, timezone: 'Fuso/Inventado' } })), /Fuso horário inválido/);
  assert.throws(() => store.create(base({ trigger: { type: 'once', runAt: '2020-01-01T00:00:00Z', timezone: 'UTC' } })), /precisa estar no futuro/);
});

test('ativar, pausar, retomar e remover respeitam estados', () => {
  const store = setup();
  const routine = store.create(base());
  assert.equal(store.activate(routine.id).status, STATUSES.ACTIVE);
  assert.equal(store.pause(routine.id).status, STATUSES.PAUSED);
  assert.equal(store.resume(routine.id).status, STATUSES.ACTIVE);
  assert.throws(() => store.remove(routine.id), /Pause a rotina/);
  store.pause(routine.id);
  assert.equal(store.remove(routine.id), true);
});

test('cron due só ocorre na próxima janela configurada', () => {
  const store = setup();
  const now = new Date('2026-10-10T12:01:30Z');
  const routine = store.create({
    name: 'Cron', action: { type: 'http-check', url: 'https://example.com' },
    trigger: { type: 'cron', expression: '* * * * *', timezone: 'UTC' },
  }, now);
  store.activate(routine.id, now);
  assert.equal(store.due(new Date('2026-10-10T12:01:45Z')).length, 0);
  assert.equal(store.due(new Date('2026-10-10T12:02:00Z')).length, 1);
});


test('skip descarta períodos atrasados sem executar em lote; run_once recupera uma vez', () => {
  const store = setup();
  const createdAt = new Date('2026-10-10T12:00:00.000Z');
  const skipped = store.create(base({ missedPolicy: 'skip' }), createdAt);
  store.activate(skipped.id, createdAt);
  assert.equal(store.due(new Date('2026-10-10T12:02:30.000Z')).length, 0);
  assert.equal(store.get(skipped.id).nextRunAt, '2026-10-10T12:03:30.000Z');
  assert.equal(store.executions({ routineId: skipped.id })[0].status, 'ignorada');

  const recovered = store.create(base({ name: 'recover', missedPolicy: 'run_once' }), createdAt);
  store.activate(recovered.id, createdAt);
  assert.equal(store.due(new Date('2026-10-10T12:02:30.000Z')).some((r) => r.id === recovered.id), true);
});

test('recupera rotinas e marca execuções órfãs após um encerramento', () => {
  const store = setup();
  const createdAt = new Date('2026-10-10T12:00:00.000Z');
  const routine = store.create(base(), createdAt);
  store.activate(routine.id, createdAt);
  store.update(routine.id, { status: STATUSES.RUNNING });
  const execution = store.appendExecution({ id: 'execution-test', routineId: routine.id, routineName: routine.name, status: 'em_execucao', startedAt: createdAt.toISOString(), finishedAt: null, attempts: [], result: null, error: null });
  assert.equal(execution.status, 'em_execucao');
  assert.equal(store.recoverInterrupted(new Date('2026-10-10T12:01:00.000Z')), 1);
  assert.equal(store.get(routine.id).status, STATUSES.ACTIVE);
  assert.equal(store.get(routine.id).lastRunAt, null);
  assert.equal(store.executions({ routineId: routine.id })[0].status, 'falhou');
});
