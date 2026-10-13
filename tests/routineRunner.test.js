'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createRoutineStore, STATUSES } = require('../src/routines');
const { createRoutineRunner, ensurePublicTarget, privateAddress } = require('../src/routineRunner');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-runner-'));
  return createRoutineStore({ dataPath: path.join(dir, 'routines.json'), executionsPath: path.join(dir, 'executions.json') });
}
function listen(server) { return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address()))); }
function close(server) { return new Promise((resolve) => server.close(resolve)); }

test('executor regista sucesso e recupera de um HTTP 503 transitório', async (t) => {
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    res.statusCode = hits === 1 ? 503 : 200;
    res.end('ok');
  });
  const address = await listen(server);
  t.after(() => close(server));
  const store = setup();
  const routine = store.create({ name: 'local health', trigger: { type: 'interval', intervalMs: 60000, timezone: 'UTC' }, action: { type: 'http-check', url: `http://127.0.0.1:${address.port}/health`, timeoutMs: 1500 } });
  store.activate(routine.id);
  const runner = createRoutineRunner({ store, maxRetries: 2, baseRetryMs: 5, allowPrivateTargets: true });
  const result = await runner.execute(routine.id);
  assert.equal(result.status, 'concluida');
  assert.equal(result.result.statusCode, 200);
  assert.equal(hits, 2);
  assert.equal(store.executions({ routineId: routine.id })[0].attempts.length, 2);
  assert.equal(store.get(routine.id).status, STATUSES.ACTIVE);
});

test('executor registra falha definitiva depois de retentativas limitadas', async (t) => {
  const server = http.createServer((req, res) => { res.statusCode = 500; res.end('error'); });
  const address = await listen(server);
  t.after(() => close(server));
  const store = setup();
  const routine = store.create({ name: 'failing check', trigger: { type: 'interval', intervalMs: 60000, timezone: 'UTC' }, action: { type: 'http-check', url: `http://127.0.0.1:${address.port}`, timeoutMs: 1500 } });
  store.activate(routine.id);
  const runner = createRoutineRunner({ store, maxRetries: 1, baseRetryMs: 5, allowPrivateTargets: true });
  const result = await runner.execute(routine.id);
  assert.equal(result.status, 'falhou');
  assert.equal(result.attempts.length, 2);
  assert.equal(store.get(routine.id).status, STATUSES.FAILED);
});

test('não executa a mesma rotina duas vezes em paralelo', async (t) => {
  const server = http.createServer((req, res) => setTimeout(() => { res.statusCode = 200; res.end('ok'); }, 100));
  const address = await listen(server);
  t.after(() => close(server));
  const store = setup();
  const routine = store.create({ name: 'slow check', trigger: { type: 'interval', intervalMs: 60000, timezone: 'UTC' }, action: { type: 'http-check', url: `http://127.0.0.1:${address.port}`, timeoutMs: 1500 } });
  store.activate(routine.id);
  const runner = createRoutineRunner({ store, maxRetries: 0, allowPrivateTargets: true });
  const first = runner.execute(routine.id);
  await assert.rejects(() => runner.execute(routine.id), /já está em execução/);
  await first;
});


test('bloqueia destinos privados/reservados por padrão', async () => {
  assert.equal(privateAddress('127.0.0.1'), true);
  assert.equal(privateAddress('10.2.3.4'), true);
  assert.equal(privateAddress('8.8.8.8'), false);
  await assert.rejects(() => ensurePublicTarget('http://127.0.0.1:1234'), /privado\/reservado/);
  await assert.rejects(() => ensurePublicTarget('http://localhost:1234'), /Destino local bloqueado/);
  await assert.doesNotReject(() => ensurePublicTarget('http://127.0.0.1:1234', true));
});
