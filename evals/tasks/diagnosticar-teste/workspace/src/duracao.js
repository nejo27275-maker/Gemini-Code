'use strict';

const FATOR = { h: 3600, m: 60, s: 1 };

/** Converte '1h30m', '90s', '2h 5m 10s' em segundos. */
function parseDuracao(texto) {
  const padrao = /(\d)\s*(h|m|s)/g;
  let total = 0;
  let m;
  while ((m = padrao.exec(String(texto)))) total += Number(m[1]) * FATOR[m[2]];
  return total;
}

module.exports = { parseDuracao };
