// src/voice/voice.js
// Voz no Termux, usando o pacote Termux:API (precisa instalar o app
// "Termux:API" da mesma loja de onde veio o Termux, + `pkg install termux-api`).
// - Fala (texto -> voz): termux-tts-speak
// - Reconhecimento de voz (voz -> texto): termux-speech-to-text
'use strict';

// Item 10 da revisão (set/2026): execSync/execFileSync bloqueiam a thread
// principal do Node por INTEIRO enquanto o comando roda. No modo "live"
// isso significa que, enquanto o TTS está falando ou o STT está ouvindo,
// nada mais no processo roda — nem um Ctrl+C limpo (o handler de SIGINT só
// dispara quando o event loop volta a girar), nem cancelar a fala no meio.
// Trocado por execFile assíncrono (com await), do mesmo jeito que já foi
// feito para run_shell (ver comentário no topo de shellTools.js).
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

let disponibilidadeCache = null;

// Bug real encontrado (set/2026): os testes deste módulo (tests/voice.test.js
// e os testes de CLI em tests/cli.test.js) assumiam que a máquina rodando os
// testes NUNCA teria o Termux:API instalado — premissa válida só em CI/PC
// comum, mas falsa exatamente no ambiente principal que este projeto suporta:
// um Termux de verdade, com termux-api instalado, rodando os próprios testes
// (foi assim que o problema apareceu: rodando `npm test` num Termux real, os
// testes que esperavam "API ausente" passaram a falhar porque a API estava
// genuinamente disponível). Esse flag de ambiente deixa os testes
// determinísticos em qualquer máquina, sem mudar o comportamento real do
// comando pra quem usa (ninguém define essa variável no uso normal).
async function isTermuxApiAvailable() {
  if (disponibilidadeCache !== null) return disponibilidadeCache;
  if (process.env.GEMINI_CODE_FORCE_NO_TERMUX_API === '1') {
    disponibilidadeCache = false;
    return disponibilidadeCache;
  }
  try {
    await execFileAsync('command', ['-v', 'termux-tts-speak'], { shell: '/bin/sh' });
    disponibilidadeCache = true;
  } catch {
    disponibilidadeCache = false;
  }
  return disponibilidadeCache;
}

async function speak(text) {
  if (!(await isTermuxApiAvailable())) {
    console.log('[voz] Termux:API não encontrado. Instale com: pkg install termux-api');
    console.log(`[voz] (diria): ${text}`);
    return;
  }
  await execFileAsync('termux-tts-speak', [text]);
}

/** Escuta o microfone e devolve o texto reconhecido. */
async function listen() {
  if (!(await isTermuxApiAvailable())) {
    throw new Error('Termux:API não encontrado. Instale com: pkg install termux-api');
  }
  const { stdout } = await execFileAsync('termux-speech-to-text', { encoding: 'utf8' });
  return stdout.trim();
}

/** Tira uma foto com a câmera do celular, salva no caminho dado. */
async function takePhoto(outPath, cameraId = 0) {
  if (!(await isTermuxApiAvailable())) {
    throw new Error('Termux:API não encontrado. Instale com: pkg install termux-api');
  }
  await execFileAsync('termux-camera-photo', ['-c', String(cameraId), outPath]);
  return outPath;
}

module.exports = { isTermuxApiAvailable, speak, listen, takePhoto };
