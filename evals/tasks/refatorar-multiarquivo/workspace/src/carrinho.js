'use strict';
const { calcTotal } = require('./pedido');

class Carrinho {
  constructor() { this.itens = []; }
  adicionar(nome, preco, qtd = 1) { this.itens.push({ nome, preco, qtd }); return this; }
  // calcTotal sem desconto: total cheio do carrinho.
  total() { return calcTotal(this.itens); }
}

module.exports = { Carrinho };
