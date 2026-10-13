// tests/live.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runLive, pareceComandoDeSaida, dividirEmFrases } = require('../src/live/live');

test('pareceComandoDeSaida reconhece as palavras de saída isoladas', () => {
  assert.ok(pareceComandoDeSaida('parar'));
  assert.ok(pareceComandoDeSaida('Sair'));
  assert.ok(pareceComandoDeSaida('encerrar.'));
  assert.ok(pareceComandoDeSaida('  tchau  '));
});

test('pareceComandoDeSaida reconhece a palavra no final de uma frase maior', () => {
  assert.ok(pareceComandoDeSaida('ok, pode parar'));
  assert.ok(pareceComandoDeSaida('por hoje é só, vou sair'));
});

test('pareceComandoDeSaida não confunde palavra parecida no meio da frase', () => {
  assert.equal(pareceComandoDeSaida('sair de férias mês que vem'), false);
  assert.equal(pareceComandoDeSaida('crie um arquivo chamado parar.txt'), false);
});

test('pareceComandoDeSaida não reconhece uma instrução normal', () => {
  assert.equal(pareceComandoDeSaida('qual a capital da França?'), false);
});

test('dividirEmFrases mantém texto curto num único bloco', () => {
  assert.deepEqual(dividirEmFrases('Oi. Tudo bem?'), ['Oi. Tudo bem?']);
});

test('dividirEmFrases quebra texto longo em blocos dentro do tamanho máximo', () => {
  const frase = 'Esta é uma frase de tamanho razoável para o teste.';
  const texto = Array(6).fill(frase).join(' ');
  const blocos = dividirEmFrases(texto, 100);

  assert.ok(blocos.length > 1);
  for (const bloco of blocos) assert.ok(bloco.length <= 100 + frase.length);
  // Nenhuma frase se perde na divisão.
  assert.equal(blocos.join(' '), texto);
});

test('dividirEmFrases nunca devolve lista vazia, mesmo sem pontuação', () => {
  assert.deepEqual(dividirEmFrases('sem pontuação nenhuma aqui'), ['sem pontuação nenhuma aqui']);
});

function fakeVoice({ listenSequence, speakLog = [] }) {
  let i = 0;
  return {
    isTermuxApiAvailable: async () => true,
    listen: async () => {
      const item = listenSequence[i++];
      if (item instanceof Error) throw item;
      return item;
    },
    speak: async (texto) => { speakLog.push(texto); },
  };
}

test('runLive lança um erro claro quando o Termux:API não está disponível', async () => {
  const voiceIndisponivel = { isTermuxApiAvailable: async () => false };
  await assert.rejects(
    () => runLive({ deps: { voice: voiceIndisponivel } }),
    /Termux:API/
  );
});

test('runLive ignora fala vazia e continua ouvindo', async () => {
  const speakLog = [];
  const voiceFake = fakeVoice({ listenSequence: ['', '   ', 'sair'], speakLog });

  await runLive({ deps: { voice: voiceFake } });

  assert.deepEqual(speakLog, ['Até mais!']);
});

test('runLive encerra ao ouvir uma palavra de saída, sem chamar o agente', async () => {
  let runOnceChamado = false;
  const voiceFake = fakeVoice({ listenSequence: ['sair'] });
  const runOnceFake = async () => { runOnceChamado = true; return { text: '', history: [] }; };

  await runLive({ deps: { voice: voiceFake, runOnce: runOnceFake } });

  assert.equal(runOnceChamado, false);
});

test('runLive manda a fala pro agente e fala a resposta em blocos', async () => {
  const speakLog = [];
  const voiceFake = fakeVoice({ listenSequence: ['que horas são?', 'sair'], speakLog });
  const historicosRecebidos = [];
  const runOnceFake = async (msg, { history }) => {
    historicosRecebidos.push(history);
    return { text: 'São 10 horas.', history: [...history, { role: 'user', parts: [{ text: msg }] }] };
  };

  await runLive({ deps: { voice: voiceFake, runOnce: runOnceFake } });

  assert.deepEqual(speakLog, ['São 10 horas.', 'Até mais!']);
  assert.deepEqual(historicosRecebidos[0], []);
});

test('runLive com vozAtiva:false não fala nada, só imprime', async () => {
  const speakLog = [];
  const voiceFake = fakeVoice({ listenSequence: ['oi', 'sair'], speakLog });
  const runOnceFake = async () => ({ text: 'olá!', history: [] });

  await runLive({ vozAtiva: false, deps: { voice: voiceFake, runOnce: runOnceFake } });

  assert.deepEqual(speakLog, []);
});

test('runLive continua a conversa mesmo se o agente der erro num turno', async () => {
  const speakLog = [];
  const voiceFake = fakeVoice({ listenSequence: ['pergunta 1', 'sair'], speakLog });
  const runOnceFake = async () => { throw new Error('sem API key'); };

  await runLive({ deps: { voice: voiceFake, runOnce: runOnceFake } });

  assert.ok(speakLog[0].includes('sem API key'));
  assert.equal(speakLog.at(-1), 'Até mais!');
});

test('runLive para o loop se o microfone der erro (sem travar)', async () => {
  const voiceFake = fakeVoice({ listenSequence: [new Error('mic ocupado')] });
  // Não deve rejeitar nem entrar em loop infinito — só encerra.
  await runLive({ deps: { voice: voiceFake } });
});
