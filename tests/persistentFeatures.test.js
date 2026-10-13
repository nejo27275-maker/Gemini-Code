'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-persistent-'));
process.env.HOME = tmpHome;
const sessionsMod = require('../src/sessions');
const checkpointsMod = require('../src/checkpoints');
const artifactsMod = require('../src/artifacts');
const knowledge = require('../src/knowledge');

test('sessions persist history, active ID, and rename across store instances', () => {
  const dataPath = path.join(tmpHome, 'test-sessions.json');
  const a = sessionsMod.createSessionStore({ dataPath, clock: () => new Date('2026-10-10T20:00:00.000Z') });
  const made = a.create('Projeto de teste', { cwd: tmpHome, history: [{ role: 'user', parts: [{ text: 'olá' }] }] });
  a.save(made.id, { name: 'Projeto renomeado', modelName: 'ollama:model', history: [{ role: 'user', parts: [{ text: 'olá' }] }, { role: 'model', parts: [{ text: 'oi' }] }] });
  const b = sessionsMod.createSessionStore({ dataPath });
  assert.equal(b.getActive().id, made.id);
  assert.equal(b.get(made.id).history.length, 2);
  assert.equal(b.list()[0].name, 'Projeto renomeado');
  assert.equal(b.get(made.id).modelName, 'ollama:model');
});

test('sessions validates input and requires explicit delete confirmation', () => {
  const store = sessionsMod.createSessionStore({ dataPath: path.join(tmpHome, 'validated-sessions.json') });
  const made = store.create('ok');
  assert.throws(() => store.save(made.id, { history: 'invalid' }), /Histórico/);
  assert.throws(() => store.remove(made.id), /confirmação/);
  assert.equal(store.remove(made.id, { yes: true }), true);
});

test('checkpoint excludes credentials, records hashes, and restores files without deleting newer files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-workspace-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'version one');
  fs.writeFileSync(path.join(root, '.env'), 'API_KEY=private');
  fs.writeFileSync(path.join(root, '.env.example'), 'API_KEY=replace-me');
  const cp = checkpointsMod.createCheckpoint({ root, label: 'before edit' });
  assert.ok(cp.files.some((f) => f.path === path.join('src', 'app.js')));
  assert.ok(!cp.files.some((f) => f.path === '.env'));
  assert.ok(cp.files.some((f) => f.path === '.env.example'));
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'version two');
  fs.writeFileSync(path.join(root, 'new.txt'), 'keep me');
  assert.throws(() => checkpointsMod.restoreCheckpoint(cp.id, { root }), /--yes|confirmação/);
  const result = checkpointsMod.restoreCheckpoint(cp.id, { root, yes: true });
  assert.equal(fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8'), 'version one');
  assert.equal(fs.readFileSync(path.join(root, 'new.txt'), 'utf8'), 'keep me');
  assert.ok(result.safetyCheckpointId);
});

test('checkpoint refuses tampered snapshots before changing workspace', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-tamper-'));
  fs.writeFileSync(path.join(root, 'a.txt'), 'baseline');
  const cp = checkpointsMod.createCheckpoint({ root });
  fs.writeFileSync(path.join(root, 'a.txt'), 'edited');
  const stored = path.join(checkpointsMod.CHECKPOINTS_DIR, cp.id, 'files', 'a.txt');
  fs.writeFileSync(stored, 'tampered');
  assert.throws(() => checkpointsMod.restoreCheckpoint(cp.id, { root, yes: true }), /corrompido/);
  assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'edited');
});

test('artifacts are retrievable and SHA-256 corruption is detected', () => {
  const item = artifactsMod.createArtifact({ title: 'Relatório de teste', type: 'test', content: '# Resultado\nOK', cwd: tmpHome });
  assert.equal(artifactsMod.readArtifact(item.id).content, '# Resultado\nOK');
  assert.equal(artifactsMod.listArtifacts({ type: 'test' })[0].id, item.id);
  fs.writeFileSync(path.join(artifactsMod.ARTIFACTS_DIR, item.fileName), 'mudou');
  assert.throws(() => artifactsMod.readArtifact(item.id), /SHA-256/);
});

test('project context recognizes instructions used by multiple coding agents', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-context-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), 'instruções comuns');
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'instruções Claude');
  fs.writeFileSync(path.join(root, '.hermes.md'), 'instruções Hermes');
  fs.writeFileSync(path.join(root, 'KIMI.md'), 'instruções Kimi');
  fs.writeFileSync(path.join(root, 'SYSTEM.md'), 'instruções de sistema do projeto');
  const result = knowledge.loadKnowledge({ cwd: root, maxChars: 5000 });
  assert.ok(result.text.includes('instruções comuns'));
  assert.ok(result.text.includes('instruções Claude'));
  assert.ok(result.text.includes('instruções Hermes'));
  assert.ok(result.text.includes('instruções Kimi'));
  assert.ok(result.text.includes('instruções de sistema do projeto'));
});
