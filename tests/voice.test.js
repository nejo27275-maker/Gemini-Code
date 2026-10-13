// tests/voice.test.js
// Bug real encontrado (set/2026): esse arquivo assumia que a máquina rodando
// os testes NUNCA teria o Termux:API instalado — verdade em CI/PC comum, mas
// falso exatamente no ambiente principal deste projeto (um Termux real com
// termux-api instalado, que é onde qualquer usuário de verdade vai rodar
// `npm test`). Nesse caso `isTermuxApiAvailable()` corretamente detectava a
// API disponível e os 3 testes abaixo (que exercitam o caminho "API
// ausente") quebravam — não por bug em voice.js, mas porque o teste
// dependia de estado ambiente em vez de simular a condição que queria
// testar. Corrigido: força a condição via GEMINI_CODE_FORCE_NO_TERMUX_API,
// suportado em voice.js, deixando o teste determinístico em qualquer
// máquina (CI, PC comum ou Termux real com a API instalada).
'use strict';

process.env.GEMINI_CODE_FORCE_NO_TERMUX_API = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isTermuxApiAvailable, speak, listen, takePhoto } = require('../src/voice/voice');

test('isTermuxApiAvailable() é false quando forçado via env (simula ausência do Termux:API)', async () => {
  assert.equal(await isTermuxApiAvailable(), false);
});

test('speak() não lança erro quando o Termux:API não está disponível (cai no fallback)', async () => {
  await assert.doesNotReject(() => speak('teste'));
});

test('listen() rejeita com mensagem clara quando o Termux:API não está disponível', async () => {
  await assert.rejects(() => listen(), /Termux:API não encontrado/);
});

test('takePhoto() rejeita com mensagem clara quando o Termux:API não está disponível', async () => {
  await assert.rejects(() => takePhoto('/tmp/foto.jpg'), /Termux:API não encontrado/);
});
