'use strict';
const { calcularTotalPedido } = require('./pedido');

class Carrinho {
  constructor() { this.itens = []; }
  adicionar(nome, preco, qtd = 1) { this.itens.push({ nome, preco, qtd }); return this; }
  // calcularTotalPedido sem desconto: total cheio do carrinho.
  total() { return calcularTotalPedido(this.itens); }
}

module.exports = { Carrinho };
