'use strict';
// v0.41.0: a sessão de convidado ("só leitura") lia qualquer arquivo da máquina (ex.: ~/.ssh/id_rsa).
// Agora só dentro da pasta em que o gemini-code foi aberto; a sessão do dono não muda.
const fs = require('fs');
const os = require('os');
const path = require('path');
const HOME_FALSO = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-convidado-'));
process.env.HOME = HOME_FALSO;
process.env.USERPROFILE = HOME_FALSO;

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const security = require('../src/security');
const fileTools = require('../src/tools/fileTools');
const searchTools = require('../src/tools/searchTools');
const skills = require('../src/skills/loader');

const projeto = fs.mkdtempSync(path.join(HOME_FALSO, 'projeto-'));
fs.writeFileSync(path.join(projeto, 'README.md'), 'texto do projeto');
const ssh = path.join(HOME_FALSO, '.ssh');
fs.mkdirSync(ssh);
fs.writeFileSync(path.join(ssh, 'id_rsa'), 'CHAVE-PRIVADA-FICTICIA');
const skill = path.join(config.SKILLS_DIR, 'minha', 'SKILL.md');
fs.mkdirSync(path.dirname(skill), { recursive: true });
fs.writeFileSync(skill, '---\nname: minha\n---\nconteúdo da skill');

function comoConvidado(fn) {
  return async () => {
    config.saveConfig({ apiKeyLocked: security.encriptar('K', 'dono'), apiKeyLockedGuest: security.encriptar('K', 'convidado'), apiKey: '' });
    const cwdAntes = process.cwd();
    process.chdir(projeto);
    assert.equal(security.unlock('convidado'), true);
    try { await fn(); } finally { security.clearSession(); process.chdir(cwdAntes); }
  };
}

test('convidado lê o projeto, mas não fora dele', comoConvidado(async () => {
  assert.equal(await fileTools.execute('read_file', { path: 'README.md' }), 'texto do projeto');
  assert.match(await fileTools.execute('read_file', { path: path.join(ssh, 'id_rsa') }), /^Bloqueado: a sessão de convidado só lê/);
  assert.match(await fileTools.execute('read_file', { path: '../.ssh/id_rsa' }), /^Bloqueado/);
  assert.match(await fileTools.execute('list_dir', { path: ssh }), /^Bloqueado/);
  assert.match(await searchTools.execute('search_files', { pattern: 'CHAVE', path: HOME_FALSO }), /^Bloqueado/);
  assert.match(await searchTools.execute('search_files', { pattern: 'texto', path: '.' }), /README\.md:1:/);
}));

test('convidado não escapa por symlink dentro do projeto', { skip: process.platform === 'win32' }, comoConvidado(async () => {
  fs.symlinkSync(path.join(ssh, 'id_rsa'), path.join(projeto, 'atalho'));
  assert.match(await fileTools.execute('read_file', { path: 'atalho' }), /^Bloqueado/);
}));

test('convidado ainda lê as skills instaladas', comoConvidado(async () => {
  assert.equal(await skills.execute('read_skill', { path: skill }), 'conteúdo da skill');
  assert.match(await skills.execute('read_skill', { path: path.join(ssh, 'id_rsa') }), /^Bloqueado/);
}));

test('sessão do dono não muda', async () => {
  security.clearSession();
  assert.equal(await fileTools.execute('read_file', { path: path.join(ssh, 'id_rsa') }), 'CHAVE-PRIVADA-FICTICIA');
});
