'use strict';

/** 1234.5 -> 'R$ 1.234,50'; -1234.5 -> '-R$ 1.234,50' (arredonda para 2 casas). */
function formatarBRL(valor) {
  const fixo = Math.abs(Number(valor)).toFixed(2);
  const negativo = Number(valor) < 0 && fixo !== '0.00';
  const [inteiro, centavos] = fixo.split('.');
  const comPontos = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negativo ? '-' : ''}R$ ${comPontos},${centavos}`;
}

module.exports = { formatarBRL };
