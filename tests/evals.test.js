'use strict';
// v0.40.0: as tarefas de avaliação (evals/) só valem se os verificadores
// distinguem certo de errado. Aqui: autoteste (falha sem solução, passa com a de
// referência) e controles negativos com um agente roteirizado.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const evals = require('../evals/run');

const AGENTE = `"${process.execPath}" "${path.join(__dirname, 'fixtures', 'fake-eval-agent.js')}"`;
const semShellPosix = process.platform === 'win32';
const rodar = (modo, id, extra = {}) => evals.avaliarAgente({ agente: `${AGENTE} ${modo} {prompt}`, ids: [id], log: () => {}, ...extra });

test('autoteste: todo verificador falha no workspace original e passa com a solução', () => {
  const r = evals.autoTeste();
  assert.ok(r.length >= 6);
  for (const x of r) assert.ok(x.ok, `${x.id}: falha sem solução=${x.falhaSemSolucao}, passa com solução=${x.passaComSolucao}\n${x.detalhe}`);
});

test('modo agente: solução correta passa e o relatório traz ambiente e contagem', { skip: semShellPosix }, async () => {
  const rel = await rodar('solucao:corrigir-paginacao', 'corrigir-paginacao');
  assert.deepEqual(rel.resumo, { tarefas: 1, passaram: 1 });
  const [r] = rel.resultados;
  assert.equal(r.passou, true, r.detalhe);
  assert.equal(r.codigoSaida, 0);
  assert.equal(r.arquivosAlterados, 1);
  assert.equal(rel.ambiente.node, process.version);
});

test('controle negativo: obedecer a instrução injetada reprova', { skip: semShellPosix }, async () => {
  const [r] = (await rodar('obedecer-injecao', 'resistir-injecao')).resultados;
  assert.equal(r.passou, false);
  assert.match(r.detalhe, /apagado/);
});

test('controle negativo: substituir todas as ocorrências reprova a edição cirúrgica', { skip: semShellPosix }, async () => {
  const [r] = (await rodar('substituir-tudo', 'edicao-cirurgica')).resultados;
  assert.equal(r.passou, false);
  assert.match(r.detalhe, /linhas alteradas/);
});

test('controle negativo: alterar o teste em vez do código reprova', { skip: semShellPosix }, async () => {
  const [r] = (await rodar('mexer-no-teste', 'diagnosticar-teste')).resultados;
  assert.equal(r.passou, false);
  assert.match(r.detalhe, /não podia ser alterado/);
});

test('tempo esgotado: o agente é encerrado e a tarefa reprova', { skip: semShellPosix }, async () => {
  const t0 = Date.now();
  const [r] = (await rodar('dormir', 'corrigir-paginacao', { timeoutSec: 1 })).resultados;
  assert.equal(r.estourouTempo, true);
  assert.equal(r.passou, false);
  assert.equal(r.arquivosAlterados, 0, 'git funcionou e nada mudou: 0, não null');
  assert.ok(Date.now() - t0 < 15000);
});

test('o enunciado chega intacto ao agente, mesmo com aspas simples e acentos', { skip: semShellPosix }, async () => {
  const rel = await rodar('eco', 'implementar-slug', { manter: true });
  const [r] = rel.resultados;
  try {
    const tarefa = evals.listarTarefas(['implementar-slug'])[0];
    assert.ok(tarefa.prompt.includes("'"), 'o enunciado de teste precisa ter aspas simples');
    assert.equal(fs.readFileSync(path.join(r.workspace, 'PROMPT.txt'), 'utf8'), tarefa.prompt);
  } finally { fs.rmSync(path.dirname(r.workspace), { recursive: true, force: true }); }
});

test('argumentos: tarefa desconhecida e comando sem {prompt} são recusados', async () => {
  assert.throws(() => evals.listarTarefas(['nao-existe']), /desconhecida/);
  await assert.rejects(evals.avaliarAgente({ agente: 'echo oi', log: () => {} }), /\{prompt\}/);
  assert.throws(() => evals.lerArgs(['--agent']), /precisa de um valor/);
  assert.deepEqual(evals.lerArgs(['--tasks', 'a, b', '--timeout', '5']), { ids: ['a', 'b'], timeoutSec: 5 });
});
