'use strict';

/** Primeira letra de cada palavra em maiúscula: 'olá mundo' -> 'Olá Mundo'. */
function capitalizar(texto) {
  return String(texto)
    .split(' ')
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
    .join(' ');
}

/** 'Ação Rápida!  2026' -> 'acao-rapida-2026'. */
function slugify(texto) {
  return String(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = { capitalizar, slugify };
