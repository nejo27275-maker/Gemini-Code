'use strict';
// v0.40.0: config.json (apiKey em texto puro sem passphrase) e o token do cowork
// eram gravados com 0644 — legíveis por qualquer usuário da máquina.
const fs = require('fs');
const os = require('os');
const path = require('path');
const HOME_FALSO = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-permissoes-'));
process.env.HOME = HOME_FALSO;
process.env.USERPROFILE = HOME_FALSO;

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const cowork = require('../src/cowork/server');

const skip = process.platform === 'win32';
const modo = (p) => fs.statSync(p).mode & 0o777;
const COWORK_TOKEN_PATH = path.join(config.HOME_DIR, 'cowork-token.txt');

test('config.json e config.json.bak são criados só para o dono', { skip }, () => {
  const antigo = process.umask(0o022);
  try {
    config.saveConfig({ apiKey: 'CHAVE-FICTICIA-DE-TESTE' });
    assert.equal(modo(config.CONFIG_PATH), 0o600);
    assert.equal(modo(`${config.CONFIG_PATH}.bak`), 0o600);
    assert.equal(modo(config.HOME_DIR), 0o700);
  } finally { process.umask(antigo); }
});

test('config antigo com 0644 é restringido ao ser lido', { skip }, () => {
  config.loadConfig();
  fs.chmodSync(config.CONFIG_PATH, 0o644);
  fs.chmodSync(`${config.CONFIG_PATH}.bak`, 0o644);
  assert.equal(config.loadConfig().apiKey, 'CHAVE-FICTICIA-DE-TESTE');
  assert.equal(modo(config.CONFIG_PATH), 0o600);
  assert.equal(modo(`${config.CONFIG_PATH}.bak`), 0o600);
});

test('token do cowork é criado com 0600 e um token antigo 0644 é restringido', { skip }, () => {
  const antigo = process.umask(0o022);
  try {
    const token = cowork.getOrCreateToken();
    assert.match(token, /^[0-9a-f]{32}$/);
    assert.equal(modo(COWORK_TOKEN_PATH), 0o600);
    fs.chmodSync(COWORK_TOKEN_PATH, 0o644);
    assert.equal(cowork.getOrCreateToken(), token, 'o token existente é mantido');
    assert.equal(modo(COWORK_TOKEN_PATH), 0o600);
  } finally { process.umask(antigo); }
});

test('servidor cowork limita o tamanho das mensagens (padrão do ws seria 100 MiB)', () => {
  assert.equal(cowork.MAX_PAYLOAD_BYTES, 1024 * 1024);
});
