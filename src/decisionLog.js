// src/decisionLog.js
// Item 5 do roadmap "top 1" (set/2026): cada chamada de ferramenta do agente
// acontecia e sumia — sem registro, debugar "por que ele fez isso?" depois
// dependia só da memória do usuário ou de rolar o terminal pra cima. Agora
// cada chamada de ferramenta é gravada em ~/.gemini-code/history/actions.log
// (JSON Lines, um objeto por linha: fácil de grep/tail, sem precisar de
// parser especial). Puramente aditivo — nunca lê nem apaga o log, só anexa.
'use strict';

const fs = require('fs');
const path = require('path');
const { HISTORY_DIR } = require('./config');

const LOG_PATH = path.join(HISTORY_DIR, 'actions.log');
const MAX_CAMPO_CHARS = 500; // args/resultado podem ser grandes; guarda só um resumo

// v0.3.8: o log só crescia. Acima de MAX_LOG_BYTES vira actions.log.1
// (substitui o anterior) e começa um novo — no máximo ~2x o limite em disco.
const MAX_LOG_BYTES = 5 * 1024 * 1024;

function rotacionarSeGrande() {
  try {
    if (fs.statSync(LOG_PATH).size > MAX_LOG_BYTES) fs.renameSync(LOG_PATH, LOG_PATH + '.1');
  } catch { /* log ainda não existe */ }
}

function resumir(valor) {
  // v0.41.0: um comando com chave (ex.: curl -H "Authorization: Bearer ...") ia em texto puro para o log.
  const texto = require('./securityScan').mascararSegredos(typeof valor === 'string' ? valor : JSON.stringify(valor));
  if (!texto) return '';
  return texto.length > MAX_CAMPO_CHARS
    ? texto.slice(0, MAX_CAMPO_CHARS) + `...(+${texto.length - MAX_CAMPO_CHARS} chars)`
    : texto;
}

/**
 * Registra uma chamada de ferramenta no log. Nunca lança — logging não deve
 * derrubar o agente se, por exemplo, o disco estiver cheio ou sem permissão.
 */
function logAcao({ tool, args, resultado, erro }) {
  try {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
    rotacionarSeGrande();
    const entrada = {
      ts: new Date().toISOString(),
      tool,
      args: resumir(args),
      ...(erro ? { erro: resumir(erro) } : { resultado: resumir(resultado) }),
    };
    fs.appendFileSync(LOG_PATH, JSON.stringify(entrada) + '\n', 'utf8');
  } catch { /* log é best-effort */ }
}

module.exports = { logAcao, LOG_PATH, MAX_LOG_BYTES };
