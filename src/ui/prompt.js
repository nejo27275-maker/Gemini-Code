// src/ui/prompt.js
// Item 8 da revisão (set/2026): o chatLoop (bin/gemini-code.js) e a
// confirmação de run_shell (tools/shellTools.js) criavam CADA UM sua própria
// `readline.createInterface({ input: process.stdin, ... })`. As duas
// interfaces ficavam anexadas ao mesmo stdin ao mesmo tempo — funcionava na
// maioria dos terminais, mas em alguns (relatado: alguns emuladores no
// Termux) o caractere digitado para confirmar ("s") era engolido por uma das
// duas interfaces competindo pelo mesmo evento 'data' do stream, deixando a
// pergunta de confirmação travada esperando para sempre.
//
// Correção: uma única readline.Interface por processo, compartilhada entre
// tudo que precisa perguntar algo no terminal (chat, persona chat, e a
// confirmação do run_shell). Cada ponto de uso chama getShared() ou ask()
// em vez de criar sua própria interface.
'use strict';

const readline = require('readline');

let rl = null;

// v0.40.0: sem terminal (cron, CI, `< /dev/null`, pipe já lido), a readline
// fecha no fim do stdin e a pergunta pendente nunca era respondida — sem nada
// mais no event loop, o processo SAÍA no meio da tarefa com código 0 e sem
// resposta (ex.: `gemini-code run` pedindo para confirmar um run_shell).
// Agora a pergunta resolve com '' (quem chama trata como "não") e, se o stdin
// acabou, as próximas também, sem recriar a interface.
let semEntrada = false;
const AVISO_SEM_ENTRADA = '[sem resposta: a entrada (stdin) foi encerrada — tratado como "não"]\n';

function getShared() {
  if (!rl) {
    const atual = readline.createInterface({ input: process.stdin, output: process.stdout });
    atual.on('close', () => {
      if (process.stdin.readableEnded) semEntrada = true;
      if (rl === atual) rl = null;
    });
    rl = atual;
  }
  return rl;
}

/** Pergunta algo e devolve a resposta (trim), usando a interface compartilhada. */
function ask(question) {
  return new Promise((resolve) => {
    if (semEntrada) {
      process.stdout.write(`${question}\n${AVISO_SEM_ENTRADA}`);
      return resolve('');
    }
    const atual = getShared();
    let feito = false;
    const terminar = (resposta) => {
      if (feito) return;
      feito = true;
      atual.removeListener('close', aoFechar);
      resolve(resposta);
    };
    function aoFechar() {
      process.stdout.write(`\n${AVISO_SEM_ENTRADA}`);
      terminar('');
    }
    atual.once('close', aoFechar);
    atual.question(question, (answer) => terminar(answer.trim()));
  });
}

/**
 * Igual a rl.question, mas entrega colagens de várias linhas como UMA mensagem.
 *
 * Bug real (Termux, set/2026): ao colar um prompt com várias linhas, o
 * rl.question só pegava a PRIMEIRA linha; as outras chegavam como eventos
 * 'line' sem ninguém ouvindo e eram descartadas — o modelo recebia só a
 * primeira frase do prompt e respondia fora do assunto.
 * Solução: depois da primeira linha, escuta 'line' por uma janelinha curta
 * (colar entrega tudo de uma vez) e junta tudo com \n. Digitar uma linha
 * normal só custa esse atraso pequeno.
 */
function perguntarColando(rl, promptText, callback, janelaMs = 150) {
  rl.question(promptText, (primeira) => {
    const extras = [];
    const onLine = (linha) => extras.push(linha);
    rl.on('line', onLine);
    setTimeout(() => {
      rl.removeListener('line', onLine);
      // Bug real (Termux, v0.2.7): a ÚLTIMA linha de uma colagem costuma vir
      // sem \n no fim, então ela fica no buffer de edição da readline (o
      // texto "digitado" ainda sem Enter). Ela era esquecida ali, reaparecia
      // em cada redesenho e sujava a próxima pergunta — inclusive o (s/n) do
      // run_shell, onde virava parte da resposta. Agora entra na mensagem e o
      // buffer é limpo.
      const resto = typeof rl.line === 'string' ? rl.line : '';
      if (resto) {
        extras.push(resto);
        rl.write(null, { ctrl: true, name: 'e' }); // cursor pro fim
        rl.write(null, { ctrl: true, name: 'u' }); // apaga a linha
      }
      callback([primeira, ...extras].join('\n').replace(/\s+$/, ''));
    }, janelaMs);
  });
}

/** Fecha a interface compartilhada, se existir (uso: saída limpa do processo). */
function closeShared() {
  if (rl) {
    rl.close();
    rl = null;
  }
}

module.exports = { getShared, ask, closeShared, perguntarColando };
