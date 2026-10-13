// tests/mdToHtml.test.js
// mdToHtml() converte o Markdown simples de um slide (título "## " + bullets
// "- ") em HTML, escapando caracteres especiais (ver comentário em
// designTools.js sobre o bug de HTML quebrado com "<"/">"/"&" no texto
// gerado pelo modelo).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mdToHtml, escapeHtml } = require('../src/tools/designTools');

test('escapeHtml escapa &, < e >', () => {
  assert.equal(escapeHtml('A && B <script> C'), 'A &amp;&amp; B &lt;script&gt; C');
});

test('mdToHtml converte o título "## " em <h2>', () => {
  const out = mdToHtml('## Título da seção');
  assert.match(out, /<h2>Título da seção<\/h2>/);
});

test('mdToHtml agrupa bullets consecutivos num único <ul>', () => {
  const out = mdToHtml('## T\n- um\n- dois\n- três');
  assert.equal((out.match(/<ul>/g) || []).length, 1);
  assert.equal((out.match(/<\/ul>/g) || []).length, 1);
  assert.match(out, /<li>um<\/li>/);
  assert.match(out, /<li>dois<\/li>/);
  assert.match(out, /<li>três<\/li>/);
});

test('mdToHtml fecha a lista antes de um parágrafo normal', () => {
  const out = mdToHtml('## T\n- item\ntexto normal');
  const idxFechaUl = out.indexOf('</ul>');
  const idxParagrafo = out.indexOf('<p>texto normal</p>');
  assert.ok(idxFechaUl !== -1 && idxParagrafo !== -1 && idxFechaUl < idxParagrafo);
});

test('mdToHtml escapa conteúdo perigoso dentro de bullets e parágrafos', () => {
  const out = mdToHtml('## T\n- use `<script>` com cuidado');
  assert.doesNotMatch(out, /<script>/);
  assert.match(out, /&lt;script&gt;/);
});
