// src/voice/voice.js
// Voz no Termux, usando o pacote Termux:API (precisa instalar o app
// "Termux:API" da mesma loja de onde veio o Termux, + `pkg install termux-api`).
// - Fala (texto -> voz): termux-tts-speak
// - Reconhecimento de voz (voz -> texto): termux-speech-to-text
'use strict';

const { execSync, execFileSync } = require('child_process');

function isTermuxApiAvailable() {
  try {
    execSync('command -v termux-tts-speak', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function speak(text) {
  if (!isTermuxApiAvailable()) {
    console.log('[voz] Termux:API não encontrado. Instale com: pkg install termux-api');
    console.log(`[voz] (diria): ${text}`);
    return;
  }
  execFileSync('termux-tts-speak', [text]);
}

/** Escuta o microfone e devolve o texto reconhecido. */
function listen() {
  if (!isTermuxApiAvailable()) {
    throw new Error('Termux:API não encontrado. Instale com: pkg install termux-api');
  }
  const out = execSync('termux-speech-to-text', { encoding: 'utf8' });
  return out.trim();
}

/** Tira uma foto com a câmera do celular, salva no caminho dado. */
function takePhoto(outPath, cameraId = 0) {
  if (!isTermuxApiAvailable()) {
    throw new Error('Termux:API não encontrado. Instale com: pkg install termux-api');
  }
  execFileSync('termux-camera-photo', ['-c', String(cameraId), outPath]);
  return outPath;
}

module.exports = { isTermuxApiAvailable, speak, listen, takePhoto };
