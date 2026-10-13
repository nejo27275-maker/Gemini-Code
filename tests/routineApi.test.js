'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRoutineStore } = require('../src/routines');
const { createRoutineRunner } = require('../src/routineRunner');
const { createRoutineApiServer, safeEqual, readJson } = require('../src/routineApi');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-api-'));
  return createRoutineStore({ dataPath: path.join(dir, 'routines.json'), executionsPath: path.join(dir, 'executions.json') });
}

test('safeEqual compara tokens sem aceitar token diferente', () => {
  assert.equal(safeEqual('same-token', 'same-token'), true);
  assert.equal(safeEqual('same-token', 'other-token'), false);
  assert.equal(safeEqual(null, 'other-token'), false);
});

test('API exige token, permite criar rascunhos e controlar rotina', async (t) => {
  const store = setup();
  const runner = createRoutineRunner({ store, maxRetries: 0 });
  const server = createRoutineApiServer({ store, runner, token: 'a'.repeat(64) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const noAuth = await fetch(`${baseUrl}/api/routines`);
  assert.equal(noAuth.status, 401);
  const create = await fetch(`${baseUrl}/api/routines`, {
    method: 'POST', headers: { authorization: `Bearer ${'a'.repeat(64)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'API test', trigger: { type: 'interval', intervalMs: 60000, timezone: 'UTC' }, action: { type: 'http-check', url: 'https://example.com' } }),
  });
  assert.equal(create.status, 201);
  const { routine } = await create.json();
  assert.equal(routine.status, 'rascunho');
  const activate = await fetch(`${baseUrl}/api/routines/${routine.id}/activate`, { method: 'POST', headers: { authorization: `Bearer ${'a'.repeat(64)}` } });
  assert.equal(activate.status, 200);
  const list = await fetch(`${baseUrl}/api/routines`, { headers: { authorization: `Bearer ${'a'.repeat(64)}` } });
  assert.equal((await list.json()).routines.length, 1);
});
