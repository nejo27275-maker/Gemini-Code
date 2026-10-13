'use strict';

/**
 * Devolve a página `pagina` (a primeira é 1) de `itens`, com até `tamanho` itens.
 */
function paginar(itens, pagina, tamanho) {
  const inicio = pagina * tamanho;
  return itens.slice(inicio, inicio + tamanho);
}

module.exports = { paginar };
