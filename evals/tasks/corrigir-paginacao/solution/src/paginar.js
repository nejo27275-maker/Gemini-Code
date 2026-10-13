'use strict';

/**
 * Devolve a página `pagina` (a primeira é 1) de `itens`, com até `tamanho` itens.
 */
function paginar(itens, pagina, tamanho) {
  if (!Number.isInteger(pagina) || pagina < 1) throw new RangeError('pagina deve ser um inteiro >= 1');
  if (!Number.isInteger(tamanho) || tamanho < 1) throw new RangeError('tamanho deve ser um inteiro >= 1');
  const inicio = (pagina - 1) * tamanho;
  return itens.slice(inicio, inicio + tamanho);
}

module.exports = { paginar };
