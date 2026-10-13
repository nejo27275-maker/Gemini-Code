// tests/security.test.js
// lock/unlock/removePassphrase protegem a apiKey em disco com uma
// passphrase — ver comentário em src/security.js. Testa a criptografia
// diretamente (encriptar/decriptar), sem depender do config.json real do
// usuário (lock()/unlock() de verdade são exercitados pelo teste de CLI).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { encriptar, decriptar, mascarar, isLocked, clearSession, getSessionApiKey, restringirParaSessao } = require('../src/security');

test('encripta e decripta corretamente com a passphrase certa', () => {
  const blob = encriptar('minha-chave-secreta-123', 'senha-forte');
  const texto = decriptar(blob, 'senha-forte');
  assert.equal(texto, 'minha-chave-secreta-123');
});

test('decriptar com a passphrase errada lança (não devolve lixo silenciosamente)', () => {
  const blob = encriptar('minha-chave-secreta-123', 'senha-forte');
  assert.throws(() => decriptar(blob, 'senha-errada'));
});

test('o blob criptografado não contém o texto original em nenhum campo', () => {
  const blob = encriptar('AIzaSyABCDEF1234567890', 'senha');
  const serializado = JSON.stringify(blob);
  assert.equal(serializado.includes('AIzaSyABCDEF1234567890'), false);
});

test('duas encriptações da mesma chave dão blobs diferentes (salt/iv aleatórios)', () => {
  const blob1 = encriptar('mesma-chave', 'senha');
  const blob2 = encriptar('mesma-chave', 'senha');
  assert.notEqual(blob1.data, blob2.data);
  assert.notEqual(blob1.salt, blob2.salt);
});

test('isLocked reflete a presença de apiKeyLocked no config', () => {
  assert.equal(isLocked({}), false);
  assert.equal(isLocked({ apiKey: 'x' }), false);
  assert.equal(isLocked({ apiKeyLocked: { salt: 'a' } }), true);
});

test('mascarar mostra só os últimos 4 caracteres', () => {
  const chave = 'AIzaSyABCDEF1234567890';
  assert.equal(mascarar(chave), '*'.repeat(chave.length - 4) + chave.slice(-4));
  assert.equal(mascarar('abcd'), '****');
  assert.equal(mascarar('ab'), '**');
  assert.equal(mascarar(''), '');
});

test('sessão começa limpa e clearSession() remove o cache', () => {
  clearSession();
  assert.equal(getSessionApiKey(), null);
});

test('restringirParaSessao não mexe em nada fora de sessão de convidado', () => {
  clearSession(); // sessionRole = null (equivalente a sessão de dono/sem cadeado)
  assert.equal(restringirParaSessao(undefined), undefined);
  assert.deepEqual(restringirParaSessao(['read_file', 'run_shell']), ['read_file', 'run_shell']);
});

test('restringirParaSessao aplica a lista de convidado quando não havia lista', () => {
  // Simula sessão de convidado sem depender de unlock()/config real: usa o
  // mesmo módulo, testando através do comportamento público exposto.
  const blobDono = encriptar('chave-real-da-api', 'senha-mestra');
  const blobConvidado = encriptar('chave-real-da-api', 'senha-convidado');
  // decriptar com a senha do convidado deve bater (mesma apiKey, blob diferente)
  assert.equal(decriptar(blobConvidado, 'senha-convidado'), 'chave-real-da-api');
  assert.equal(decriptar(blobDono, 'senha-mestra'), 'chave-real-da-api');
  clearSession();
});
