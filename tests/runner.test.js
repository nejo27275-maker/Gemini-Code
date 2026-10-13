// tests/runner.test.js
// runWorkflowData é o coração do comando "gemini-code agent run" para
// arquivos de workflow (lista de "steps"). Aqui usamos deps.runOnce (ver
// comentário em src/agents/runner.js) para simular o Gemini sem chamar a
// API de verdade.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runWorkflowData } = require('../src/agents/runner');

function fakeRunOnce(respostas) {
  const chamadas = [];
  return {
    chamadas,
    runOnce: async (prompt, opts) => {
      chamadas.push({ prompt, opts });
      const text = respostas.shift() ?? '';
      return { text, history: [...(opts.history || []), { role: 'user', parts: [{ text: prompt }] }] };
    },
  };
}

test('roda os passos em ordem e devolve os resultados', async () => {
  const { runOnce } = fakeRunOnce(['resultado 1', 'resultado 2']);
  const workflow = {
    name: 'teste',
    steps: [
      { id: 'a', prompt: 'primeiro passo' },
      { id: 'b', prompt: 'segundo passo' },
    ],
  };

  const { name, results } = await runWorkflowData(workflow, { runOnce });

  assert.equal(name, 'teste');
  assert.deepEqual(results, [
    { id: 'a', output: 'resultado 1' },
    { id: 'b', output: 'resultado 2' },
  ]);
});

test('interpola a saída de um passo anterior no prompt do próximo', async () => {
  const { runOnce, chamadas } = fakeRunOnce(['Maria', 'oi']);
  const workflow = {
    steps: [
      { id: 'nome', prompt: 'diga um nome' },
      { id: 'saudacao', prompt: 'cumprimente {{nome}}' },
    ],
  };

  await runWorkflowData(workflow, { runOnce });

  assert.equal(chamadas[1].prompt, 'cumprimente Maria');
});

test('sem keepHistory, cada passo começa sem histórico', async () => {
  const { runOnce, chamadas } = fakeRunOnce(['1', '2']);
  const workflow = {
    steps: [
      { id: 'a', prompt: 'a' },
      { id: 'b', prompt: 'b' },
    ],
  };

  await runWorkflowData(workflow, { runOnce });

  assert.deepEqual(chamadas[0].opts.history, []);
  assert.deepEqual(chamadas[1].opts.history, []);
});

test('com keepHistory no workflow, o histórico acumula entre passos', async () => {
  const { runOnce, chamadas } = fakeRunOnce(['1', '2']);
  const workflow = {
    keepHistory: true,
    steps: [
      { id: 'a', prompt: 'a' },
      { id: 'b', prompt: 'b' },
    ],
  };

  await runWorkflowData(workflow, { runOnce });

  assert.deepEqual(chamadas[0].opts.history, []);
  assert.equal(chamadas[1].opts.history.length, 1);
});

test('keepHistory por passo tem prioridade sobre o do workflow', async () => {
  const { runOnce, chamadas } = fakeRunOnce(['1', '2', '3']);
  const workflow = {
    keepHistory: true,
    steps: [
      { id: 'a', prompt: 'a' },
      { id: 'b', prompt: 'b', keepHistory: false },
      { id: 'c', prompt: 'c' },
    ],
  };

  await runWorkflowData(workflow, { runOnce });

  // "b" desligou o histórico explicitamente: não recebe o que "a" acumulou
  // e não contribui nada para o que vem depois.
  assert.deepEqual(chamadas[1].opts.history, []);
  // "c" (que herda "keepHistory: true" do workflow de novo) só vê o que "a"
  // deixou acumulado — o que "b" fez fica de fora, já que não participou.
  assert.equal(chamadas[2].opts.history.length, 1);
});

test('rejeita workflow sem array "steps"', async () => {
  const { runOnce } = fakeRunOnce([]);
  await assert.rejects(
    () => runWorkflowData({ name: 'sem steps' }, { runOnce }),
    TypeError
  );
});
