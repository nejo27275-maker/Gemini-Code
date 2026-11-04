// src/midiaGerada.js (v0.51.0) — avisa quem quer saber que uma ferramenta acabou de criar um arquivo de mídia (a foto
// editada, o vídeo, a capa, o áudio). Quem ouve é o modo site (src/site/servidor.js), para mostrar o resultado na
// página; sem ninguém ouvindo, não faz nada. Só passa o caminho: quem ouve confere o arquivo (tipo, tamanho, segredo).
'use strict';

const path = require('path');

const ouvintes = new Set();

/** As ferramentas chamam com o(s) arquivo(s) que acabaram de criar. Nunca lança (não atrapalha a ferramenta). */
function registrar(...caminhos) {
  for (const c of caminhos.flat()) {
    if (typeof c !== 'string' || !c || c.includes('\0')) continue;
    const abs = path.resolve(c);
    for (const fn of [...ouvintes]) {
      try { fn(abs); } catch { /* um ouvinte com problema não derruba a ferramenta */ }
    }
  }
}

/** @returns {() => void} para de ouvir */
function observar(fn) {
  ouvintes.add(fn);
  return () => { ouvintes.delete(fn); };
}

module.exports = { registrar, observar };
