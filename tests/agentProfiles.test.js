'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const profiles = require('../src/agentProfiles');
const subagents = require('../src/subagent');

test('profiles provide separate coder, explore, plan, review and test policies', () => {
  const list = profiles.listProfiles();
  assert.deepEqual(list.map((p) => p.name), ['coder', 'explore', 'plan', 'review', 'test']);
  assert.equal(profiles.resolveProfile('revisor').name, 'review');
  assert.equal(profiles.resolveProfile('planejador').name, 'plan');
  assert.equal(profiles.resolveProfile('coder').tools, null);
  for (const name of ['explore', 'plan', 'review']) {
    const profile = profiles.resolveProfile(name);
    assert.ok(profile.tools.length > 0);
    assert.ok(!profile.tools.includes('write_file'));
    assert.ok(!profile.tools.includes('edit_file'));
    assert.ok(!profile.tools.includes('run_shell'));
    assert.ok(!profile.tools.includes('delegate_task'));
  }
  assert.ok(profiles.resolveProfile('test').tools.includes('run_checks'));
  assert.ok(!profiles.resolveProfile('test').tools.includes('run_shell'));
  assert.throws(() => profiles.resolveProfile('unknown-agent'), /Perfil desconhecido/);
});

test('Kimi-style subagent aliases enforce independent read-only/coder toolsets', () => {
  for (const name of ['explore', 'plan', 'reviewer']) {
    assert.equal(subagents.TIPOS[name].somenteLeitura, true);
    assert.ok(!subagents.TIPOS[name].tools.includes('write_file'));
    assert.ok(!subagents.TIPOS[name].tools.includes('delegate_task'));
  }
  assert.equal(subagents.TIPOS.coder.somenteLeitura, false);
  assert.ok(subagents.TIPOS.coder.tools.includes('run_checks'));
  assert.ok(!subagents.TIPOS.coder.tools.includes('delegate_task'));
});


test('run CLI arguments support profile value, equals syntax, checkpoints and legacy read-only', () => {
  const a = profiles.parseRunArgs(['--profile', 'plan', 'refatore', 'o', 'módulo']);
  assert.equal(a.profile.name, 'plan');
  assert.equal(a.instruction, 'refatore o módulo');
  assert.equal(a.createCheckpoint, false);

  const b = profiles.parseRunArgs(['--profile=review', '--checkpoint', 'revise', 'segurança']);
  assert.equal(b.profile.name, 'review');
  assert.equal(b.createCheckpoint, true);
  assert.equal(b.instruction, 'revise segurança');

  const c = profiles.parseRunArgs(['--read-only', 'mapeie', 'o', 'projeto']);
  assert.equal(c.profile.name, 'explore');
  assert.equal(c.instruction, 'mapeie o projeto');
  assert.throws(() => profiles.parseRunArgs(['--profile']), /Informe o nome/);
  assert.throws(() => profiles.parseRunArgs(['--read-only', '--profile', 'plan', 'x']), /não os dois/);
  assert.throws(() => profiles.parseRunArgs(['--dangerous', 'x']), /Opção desconhecida/);
});
