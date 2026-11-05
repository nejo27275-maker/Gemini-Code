// src/abrir.js (v0.46.0)
// Abre um arquivo ou um link no aplicativo padrão (navegador, visualizador) e copia texto para a área de
// transferência — no celular (Termux:API), no Linux, no macOS e no Windows. Sempre por argumento (execFile),
// nunca por uma linha de shell: o caminho ou o link não é interpretado.
'use strict';

const { execFile } = require('child_process');

function comandoAbrir(alvo, plataforma) {
  if (plataforma === 'android') return ['termux-open', [alvo]];
  if (plataforma === 'darwin') return ['open', [alvo]];
  if (plataforma === 'win32') return ['explorer.exe', [alvo]];
  return ['xdg-open', [alvo]];
}

function comandoCopiar(plataforma) {
  if (plataforma === 'android') return ['termux-clipboard-set', []];
  if (plataforma === 'darwin') return ['pbcopy', []];
  if (plataforma === 'win32') return ['clip', []];
  return ['xclip', ['-selection', 'clipboard']];
}

/** Abre no app padrão. Devolve true se o comando rodou (não garante que havia um app para abrir). */
function abrir(alvo, { plataforma = process.platform, execFileFn = execFile } = {}) {
  const [cmd, args] = comandoAbrir(String(alvo), plataforma);
  return new Promise((resolve) => {
    try {
      const filho = execFileFn(cmd, args, { timeout: 15000 }, (err) => resolve(!err));
      if (filho && filho.unref) filho.unref();
    } catch { resolve(false); }
  });
}

/** Copia o texto para a área de transferência. Devolve true se deu certo. */
function copiar(texto, { plataforma = process.platform, execFileFn = execFile } = {}) {
  const [cmd, args] = comandoCopiar(plataforma);
  return new Promise((resolve) => {
    try {
      const filho = execFileFn(cmd, args, { timeout: 10000 }, (err) => resolve(!err));
      if (filho && filho.stdin) { filho.stdin.on('error', () => {}); filho.stdin.end(String(texto)); }
    } catch { resolve(false); }
  });
}

module.exports = { abrir, copiar, comandoAbrir, comandoCopiar };
