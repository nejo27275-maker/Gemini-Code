// src/live/live.js
// "Live": conversa contínua por voz, tipo uma ligação — você fala, o
// gemini-code ouve, pensa, responde falando, e volta a ouvir. Sem precisar
// digitar nada. Usa Termux:API (termux-speech-to-text / termux-tts-speak).
//
// Fluxo de cada "turno":
//   1. ouve o microfone até você parar de falar (termux-speech-to-text)
//   2. manda o texto pro agente (com histórico da conversa)
//   3. fala a resposta em voz alta
//   4. volta pro passo 1
//
// Palavras de saída: "parar", "sair", "encerrar" (ditas por voz) ou Ctrl+C.
'use strict';

const chalk = require('chalk');
const voice = require('../voice/voice');
const { runOnce } = require('../agent');

const PALAVRAS_DE_SAIDA = ['parar', 'sair', 'encerrar', 'tchau', 'stop'];

function pareceComandoDeSaida(texto) {
  const t = texto.trim().toLowerCase();
  return PALAVRAS_DE_SAIDA.some((p) => t === p || t === `${p}.` || t.endsWith(` ${p}`));
}

/**
 * Corta a resposta em pedaços menores pra falar mais rápido (a primeira
 * frase já começa a tocar enquanto o resto ainda seria gerado num cenário
 * de streaming real; aqui falamos em blocos por frase para não ficar um
 * bloco gigante de silêncio antes da fala começar).
 */
function dividirEmFrases(texto, tamanhoMax = 220) {
  const frases = texto.split(/(?<=[.!?])\s+/).filter(Boolean);
  const blocos = [];
  let atual = '';
  for (const frase of frases) {
    if ((atual + ' ' + frase).trim().length > tamanhoMax && atual) {
      blocos.push(atual.trim());
      atual = frase;
    } else {
      atual = (atual + ' ' + frase).trim();
    }
  }
  if (atual) blocos.push(atual);
  return blocos.length ? blocos : [texto];
}

async function runLive({ modelName, vozAtiva = true } = {}) {
  if (!voice.isTermuxApiAvailable()) {
    throw new Error(
      'O modo live precisa do Termux:API. Instale o app "Termux:API" e rode: pkg install termux-api'
    );
  }

  console.log(chalk.bold('\n🔴 gemini-code live — conversa por voz.'));
  console.log(chalk.dim('Fale normalmente. Diga "parar" ou "sair" (ou Ctrl+C) para encerrar.\n'));

  let history = [];
  let rodando = true;

  while (rodando) {
    console.log(chalk.cyan('🎤 ouvindo...'));
    let falaDoUsuario;
    try {
      falaDoUsuario = voice.listen();
    } catch (err) {
      console.error(chalk.red(`Erro ao ouvir o microfone: ${err.message}`));
      break;
    }

    if (!falaDoUsuario || !falaDoUsuario.trim()) {
      console.log(chalk.dim('(não entendi nada, tentando de novo)'));
      continue;
    }

    console.log(chalk.cyan(`você disse: `) + falaDoUsuario);

    if (pareceComandoDeSaida(falaDoUsuario)) {
      const despedida = 'Até mais!';
      console.log(chalk.green('gemini-code: ') + despedida);
      if (vozAtiva) voice.speak(despedida);
      rodando = false;
      break;
    }

    let resposta;
    try {
      const r = await runOnce(falaDoUsuario, { history, modelName });
      resposta = r.text;
      history = r.history;
    } catch (err) {
      resposta = `Deu um erro aqui: ${err.message}`;
    }

    console.log(chalk.green('gemini-code: ') + resposta + '\n');

    if (vozAtiva) {
      for (const bloco of dividirEmFrases(resposta)) {
        voice.speak(bloco);
      }
    }
  }
}

module.exports = { runLive };
