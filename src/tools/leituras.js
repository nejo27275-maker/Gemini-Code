// src/tools/leituras.js (v0.50.0) — o que o agente já viu de cada arquivo nesta sessão.
// Um editor profissional não sobrescreve o que não leu, nem o que mudou depois da última vez que leu: alguém pode
// ter mexido no arquivo (você, no editor; um comando; um formatador). read_file registra o conteúdo lido; write_file,
// edit_file e edit_files registram o que gravaram. Assim o write_file sabe se pode sobrescrever:
//   'nunca'  o arquivo existe e o agente nunca o leu nem gravou nesta sessão
//   'mudou'  o conteúdo no disco é diferente do último que o agente leu ou gravou
//   'igual'  o agente conhece o conteúdo atual
// Só a impressão digital (sha256) fica guardada, nunca o conteúdo. Por processo; limite de entradas.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_ENTRADAS = 5000;
const vistos = new Map(); // caminho real -> sha256 do último conteúdo lido/gravado pelo agente

function chave(caminho) {
  const abs = path.resolve(String(caminho));
  try { return fs.realpathSync(abs); } catch { return abs; }
}
const digital = (buf) => crypto.createHash('sha256').update(Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf), 'utf8')).digest('hex');

/** Guarda a impressão digital do conteúdo que o agente acabou de ler ou gravar. Nunca lança. */
function registrar(caminho, conteudo) {
  try {
    const k = chave(caminho);
    vistos.delete(k); // reinsere no fim: a ordem do Map vira "mais recente por último"
    vistos.set(k, digital(conteudo));
    while (vistos.size > MAX_ENTRADAS) vistos.delete(vistos.keys().next().value);
  } catch { /* o registro nunca impede a leitura nem a gravação */ }
}

/** 'nunca' | 'mudou' | 'igual' para o conteúdo atual (Buffer ou texto) do arquivo. */
function situacao(caminho, conteudoAtual) {
  const anterior = vistos.get(chave(caminho));
  if (!anterior) return 'nunca';
  return anterior === digital(conteudoAtual) ? 'igual' : 'mudou';
}

function _limpar() { vistos.clear(); }

module.exports = { registrar, situacao, _limpar, MAX_ENTRADAS };
