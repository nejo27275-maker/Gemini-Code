'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { compactar } = require('../src/outputCompact');
const { cortarResultado } = require('../src/agent');

test('remove cores ANSI e links OSC', () => {
  assert.equal(compactar('\u001b[31mErro\u001b[0m: falhou \u001b]8;;http://x\u0007link\u001b]8;;\u0007'), 'Erro: falhou link');
});

test('barra de progresso com \\r fica só no último estado', () => {
  assert.equal(compactar('baixando 10%\rbaixando 50%\rbaixando 100%\nok'), 'baixando 100%\nok');
});

test('linhas idênticas seguidas viram (×N); não seguidas ficam', () => {
  assert.equal(compactar('a\na\na\nb\na'), 'a (×3)\nb\na');
});

test('muitas linhas em branco viram uma; texto sem nada a limpar não muda', () => {
  assert.equal(compactar('x\n\n\n\n\ny'), 'x\n\ny');
  assert.equal(compactar('linha 1\nlinha 2\n'), 'linha 1\nlinha 2\n');
  assert.equal(compactar(''), '');
});

test('cortarResultado: run_shell é compactado, read_file NÃO (conteúdo exato)', () => {
  const sujo = '\u001b[32mok\u001b[0m\nok\nok';
  assert.equal(cortarResultado('run_shell', sujo), 'ok (×3)');
  assert.equal(cortarResultado('read_file', sujo), sujo);
});

test('compactar antes do corte: saída enorme de linhas repetidas cabe inteira', () => {
  const r = cortarResultado('run_shell', 'npm WARN deprecated x\n'.repeat(5000) + 'ERRO FINAL');
  assert.ok(r.includes('(×5000)') && r.endsWith('ERRO FINAL') && !r.includes('omitidos'));
});
