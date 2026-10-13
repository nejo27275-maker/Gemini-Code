'use strict';

/** Primeira letra de cada palavra em maiúscula: 'olá mundo' -> 'Olá Mundo'. */
function capitalizar(texto) {
  return String(texto)
    .split(' ')
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
    .join(' ');
}

module.exports = { capitalizar };
