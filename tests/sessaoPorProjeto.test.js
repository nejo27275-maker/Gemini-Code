'use strict';
// v0.41.0: a sessão ativa era global — o chat aberto no projeto B retomava a conversa do projeto A.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSessionStore } = require('../src/sessions');

test('cada pasta retoma a própria sessão; pasta nova não herda a de outro projeto', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-sessoes-'));
  let t = 0;
  const store = createSessionStore({ dataPath: path.join(base, 'sessions.json'), clock: () => new Date(Date.UTC(2026, 0, 1, 0, 0, t++)) });
  const a = path.join(base, 'projeto-a');
  const b = path.join(base, 'projeto-b');
  const sa = store.create('A', { cwd: a, history: [{ role: 'user', parts: [{ text: 'sobre A' }] }] });
  // Antes: getActive() devolvia a de A em qualquer pasta.
  assert.equal(store.getActive().id, sa.id);
  assert.equal(store.getActiveFor(b), null, 'projeto B não herda a conversa de A');
  const sb = store.create('B', { cwd: b });
  assert.equal(store.getActiveFor(b).id, sb.id);
  // Voltando para A: retoma a de A (a mais recente daquela pasta) e ela vira a ativa.
  assert.equal(store.getActiveFor(a).id, sa.id);
  assert.equal(store.getActive().id, sa.id);
  // Duas sessões na mesma pasta: vale a atualizada por último.
  const sa2 = store.create('A2', { cwd: a });
  store.save(sa.id, { name: 'A renomeada' });
  store.setActive(sb.id);
  assert.equal(store.getActiveFor(a).id, sa.id);
  assert.notEqual(store.getActiveFor(a).id, sa2.id);
});
