// src/outputCompact.js (v0.33.0)
// Enxuga a saída de comandos ANTES de mandar ao modelo (gasta menos tokens, o erro útil fica visível):
//  - remove códigos de cor/cursor ANSI;
//  - barras de progresso com \r: fica só o último estado de cada linha;
//  - linhas idênticas seguidas viram uma só com "(×N)"; 3+ linhas em branco viram 1.
// Só para saída de run_shell/run_checks. Conteúdo de arquivos (read_file etc.) NUNCA passa por aqui.
'use strict';

// CSI (cores, cursor) e OSC (título/links); sem dependências.
// eslint-disable-next-line no-control-regex -- casar ESC/BEL é o objetivo
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;

function compactar(texto) {
  if (typeof texto !== 'string' || !texto) return texto;
  let t = texto.replace(ANSI, '');
  t = t.replace(/\r\n/g, '\n');
  // "baixando 10%\rbaixando 50%\rbaixando 100%" -> só o último
  t = t.split('\n').map((l) => (l.includes('\r') ? (l.split('\r').filter((p) => p !== '').pop() ?? '') : l)).join('\n');
  const out = [];
  let ultima = null; let rep = 0;
  const fechar = () => {
    if (ultima === null) return;
    out.push(rep > 1 ? `${ultima} (×${rep})` : ultima);
  };
  for (const linha of t.split('\n')) {
    if (linha === ultima) { rep++; continue; }
    fechar(); ultima = linha; rep = 1;
  }
  fechar();
  // 3+ linhas em branco seguidas -> 1 (o "(×N)" de linhas vazias vira " (×N)": trata antes)
  return out.map((l) => (/^\s\(×\d+\)$/.test(l) ? '' : l)).join('\n').replace(/\n{3,}/g, '\n\n');
}

module.exports = { compactar };
