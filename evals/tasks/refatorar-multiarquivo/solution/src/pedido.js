'use strict';

/** Soma preço × quantidade de cada item; desconto em porcentagem (0 a 100). */
function calcularTotalPedido(itens, desconto = 0) {
  const bruto = itens.reduce((soma, item) => soma + item.preco * item.qtd, 0);
  return Math.round(bruto * (1 - desconto / 100) * 100) / 100;
}

module.exports = { calcularTotalPedido };
