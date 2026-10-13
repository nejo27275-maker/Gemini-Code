// src/modoCiencia.js
// Pedido do usuário: um "modo ciência" que explica curiosidade científica
// (ex.: "um segundo perto de um buraco negro") de um jeito profissional e
// sempre com a mesma estrutura, em vez de um texto corrido solto.
//
// Reaproveita o agente/runOnce que já existe (mesma chamada única de API que
// qualquer pergunta normal) — não faz chamada extra nem chama nenhum
// provedor novo, então não custa mais cota do que uma pergunta comum.
'use strict';

const INSTRUCAO_MODO_CIENCIA = (
  'MODO CIÊNCIA ativado. Responda a pergunta científica a seguir sempre com ' +
  'estas seções, nesta ordem, em português, de forma direta e sem enrolação ' +
  '(pule uma seção só se ela genuinamente não fizer sentido pro tema):\n\n' +
  '📏 Os números — a grandeza física central da pergunta (tempo, distância, ' +
  'energia, velocidade etc.), com o valor aproximado e a fórmula ou o motivo ' +
  'físico por trás, sem inventar precisão que a física não garante (deixe ' +
  'claro quando é uma estimativa ou depende de premissas, ex.: massa do ' +
  'buraco negro, distância ao horizonte de eventos).\n' +
  '🔍 Na prática, o que isso significa — uma comparação concreta do dia a dia ' +
  '(ex.: "1 segundo lá equivale a X aqui", "isso é Y vezes mais rápido que Z") ' +
  'pra dar noção real de escala, não só o número seco.\n' +
  '🚪 Dá pra sair/reverter/evitar? — responda objetivamente se existe algum ' +
  'jeito de escapar, reverter ou evitar o fenômeno descrito, e por quê (ou por ' +
  'que não), sem floreio.\n\n' +
  'Tom: professor bom, não sensacionalista — sem clickbait, sem afirmar coisa ' +
  'que a ciência atual não sabe responder (nesse caso, diga que é desconhecido ' +
  'ou hipotético).'
);

module.exports = { INSTRUCAO_MODO_CIENCIA };
