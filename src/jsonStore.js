// src/jsonStore.js
// v0.3.10: leitura/escrita segura dos JSONs locais (agenda, projetos).
// Antes: (1) um arquivo corrompido (Termux morto no meio da escrita é comum)
// virava "vazio" em silêncio e a PRÓXIMA gravação apagava tudo de vez;
// (2) a escrita era direta, justamente o que causa a corrupção.
// Agora: escrita atômica (tmp + rename) e, se o arquivo existe mas não
// parseia, ele é guardado como `<arquivo>.corrompido-<data>` antes de começar vazio.
'use strict';

const fs = require('fs');
const path = require('path');

function lerJson(caminho, valido, vazio) {
  let bruto;
  try {
    bruto = fs.readFileSync(caminho, 'utf8');
  } catch {
    return vazio(); // não existe ainda
  }
  try {
    const json = JSON.parse(bruto);
    if (valido(json)) return json;
  } catch { /* cai na quarentena abaixo */ }
  try {
    const destino = `${caminho}.corrompido-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.renameSync(caminho, destino);
    console.error(`[gemini-code] ${path.basename(caminho)} estava ilegível; guardei uma cópia em ${destino}`);
  } catch { /* melhor esforço */ }
  return vazio();
}

function escreverJson(caminho, dados) {
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  const tmp = `${caminho}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(dados, null, 2), 'utf8');
  fs.renameSync(tmp, caminho);
}

module.exports = { lerJson, escreverJson };
