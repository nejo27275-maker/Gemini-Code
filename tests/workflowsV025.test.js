'use strict';
// v0.25.0: comandos /workflows em src/workflowCommands.js (testáveis), /workflows limpar e historico --erros.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const wf = require('../src/tools/workflowTools');
const usage = require('../src/usage');
const { tratar, lerArgs } = require('../src/workflowCommands');

function pasta(arquivos = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-wf25-'));
  for (const [n, c] of Object.entries(arquivos)) fs.writeFileSync(path.join(d, n), typeof c === 'string' ? c : JSON.stringify(c));
  wf.definirPasta(d);
  return d;
}
const quieto = async (fn) => { const log = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = log; } };
const W = { name: 'w', description: 'faz coisa', steps: [{ id: 'a', prompt: 'a {{alvo}}' }, { id: 'b', prompt: 'b {{a}}' }] };
const textos = (linhas) => linhas.map((l) => l.texto).join('\n');

test('lerArgs: nome, chave=valor e valor entre aspas com espaço', () => {
  assert.deepEqual(lerArgs('w alvo=x "msg=oi tudo bem" lixo'), { nome: 'w', vars: { alvo: 'x', msg: 'oi tudo bem' } });
  assert.deepEqual(lerArgs('   '), { nome: undefined, vars: {} });
});

test('tratar: só reage a /workflows; lista, uso e subcomando desconhecido', async () => {
  pasta({ 'w.json': W });
  assert.equal(await tratar('/outra coisa'), null);
  assert.equal(await tratar('/workflowsx'), null);
  assert.match(textos(await tratar('/workflows')), /w \(2 passos\) \[precisa: alvo\] — faz coisa/);
  assert.match(textos(await tratar('/workflows banana')), /Uso: \/workflows/);
  assert.match(textos(await tratar('/workflows rodar')), /Uso: \/workflows rodar/);
  const vazio = pasta();
  assert.match(textos(await tratar('/workflows', { pasta: vazio })), /Nenhum workflow em/);
});

test('tratar: validar mostra erros/avisos e recusa nome inválido', async () => {
  const d = pasta({ 'ruim.json': { steps: [{ id: 'a', prompt: 'x' }, { id: 'a', prompt: 'y' }] }, 'bom.json': W });
  const ruim = await tratar('/workflows validar ruim', { pasta: d });
  assert.ok(ruim.some((l) => l.nivel === 'erro' && /repetido/.test(l.texto)));
  assert.ok(ruim.some((l) => l.nivel === 'aviso' && /description/.test(l.texto)));
  assert.equal(ruim[ruim.length - 1].nivel, 'erro');
  const bom = await tratar('/workflows validar bom.json', { pasta: d });
  assert.equal(bom[bom.length - 1].nivel, 'ok');
  assert.match(textos(await tratar('/workflows validar ../x', { pasta: d })), /não encontrado/);
});

test('tratar: rodar com vars e retomar; historico --erros; resumo', async () => {
  usage.zerar();
  pasta({ 'w.json': W });
  // o runOnce real não é chamado aqui: força falha usando o executor de workflowTools com runOnceFn
  await quieto(() => wf.execute('run_workflow', { name: 'w', vars: { alvo: 'x' } }, { runOnceFn: async () => ({ text: 'ok', history: [] }) }));
  await quieto(() => wf.execute('run_workflow', { name: 'w', vars: { alvo: 'x' } }, { runOnceFn: async (p) => { if (p.startsWith('b')) throw new Error('503'); return { text: 'ok', history: [] }; } }));
  const todas = textos(await tratar('/workflows historico'));
  assert.match(todas, /w {2}OK/);
  assert.match(todas, /w {2}ERRO no passo b/);
  const erros = textos(await tratar('/workflows historico --erros'));
  assert.match(erros, /ERRO no passo b/);
  assert.doesNotMatch(erros, /w {2}OK/);
  assert.match(textos(await tratar('/workflows historico w --erros')), /ERRO no passo b/);
  assert.equal(textos(await tratar('/workflows historico nada --erros')), 'Nenhuma execução com erro registrada.');
  assert.match(textos(await tratar('/workflows resumo')), /w: 2 execução\(ões\), 1 OK e 1 com erro \(50% OK\)/);
});

test('limpar: apaga o histórico e descarta só a execução interrompida pedida', async () => {
  usage.zerar();
  const d = pasta({ 'w.json': W, 'x.json': { name: 'x', description: 'd', steps: [{ id: 'a', prompt: 'a' }] } });
  const falha = async () => { throw new Error('quota'); };
  await quieto(() => wf.execute('run_workflow', { name: 'w', vars: { alvo: 'x' } }, { runOnceFn: falha }));
  await quieto(() => wf.execute('run_workflow', { name: 'x' }, { runOnceFn: falha }));
  assert.ok(fs.existsSync(path.join(d, '.estado', 'w.json')));
  assert.ok(fs.existsSync(path.join(d, '.estado', 'x.json')));
  assert.match(textos(await tratar('/workflows limpar w')), /Execução interrompida de "w" descartada/);
  assert.ok(!fs.existsSync(path.join(d, '.estado', 'w.json')));
  assert.ok(fs.existsSync(path.join(d, '.estado', 'x.json')), 'o de outro workflow fica');
  assert.match(textos(await tratar('/workflows limpar w')), /Não há execução interrompida de "w"/);
  assert.match(textos(await tratar('/workflows limpar ../../etc')), /Não há execução interrompida/);
  assert.match(textos(await tratar('/workflows limpar historico')), /Histórico apagado \(2 execução/);
  assert.equal(wf.formatarHistorico(wf.historico()), 'Nenhuma execução registrada ainda.');
  assert.match(textos(await tratar('/workflows limpar')), /Uso: \/workflows limpar/);
});
