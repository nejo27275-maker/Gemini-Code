'use strict';
const pedido = require('./pedido');

/** Fecha a compra: aplica o cupom (porcentagem) e devolve o resumo. */
function fecharCompra(carrinho, cupom = 0) {
  const total = pedido.calcularTotalPedido(carrinho.itens, cupom);
  return { itens: carrinho.itens.length, total, recalcTotal: () => pedido.calcularTotalPedido(carrinho.itens, cupom) };
}

module.exports = { fecharCompra };
