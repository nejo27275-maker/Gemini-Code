'use strict';

/** 1234.5 -> 'R$ 1.234,50' (arredonda para 2 casas). */
function formatarBRL(valor) {
  const [inteiro, centavos] = Number(valor).toFixed(2).split('.');
  const comPontos = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${comPontos},${centavos}`;
}

module.exports = { formatarBRL };
