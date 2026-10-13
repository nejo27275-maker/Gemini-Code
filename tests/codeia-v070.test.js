'use strict';
// v0.7.0: gerador indexado (mesmo resultado, mais rápido), "outra resposta", "só o código", corpus ampliado.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-codeia-v070-'));
process.env.HOME = home;
process.env.USERPROFILE = home;

const install = require('../src/code-ia/install');
const model = require('../src/code-ia/model');
const codeia = require('../src/providers/codeia');

function turno(role, text) { return { role, parts: [{ text }] }; }

test('gerador indexado dá o mesmo resultado que a varredura completa', () => {
  const { modelo } = install.ensureInstalled();
  const prefixos = ["const fs = require(", "app.listen(", "const express = require('express');\nconst app", "import ", "async function "];
  for (const p of prefixos) {
    const toks = require('../src/code-ia/tokenizer').tokensDeCodigo(p);
    const flat = model.fluxoDe(modelo);
    const hist = toks.slice(-40);
    const lento = model.melhorProximo(flat, hist);
    const rapido = model.melhorProximo(flat, hist, model.posicoesDe(modelo));
    assert.deepEqual(rapido, lento, `diferença em ${JSON.stringify(p)}`);
  }
  assert.ok(model.completar(modelo, 'const fs = require(').includes("'fs'"));
});

test('corpus ampliado: Pix, pm2, Promise.all e Docker estão no modelo', () => {
  const { modelo } = install.ensureInstalled();
  for (const [q, t] of [['criar pix mercado pago', 'Mercado Pago'], ['pm2 reiniciar bot', 'pm2'], ['promise all paralelo', 'Promise.all'], ['docker run', 'Docker']]) {
    const r = model.buscar(modelo, q, { limite: 1 })[0];
    assert.ok(r && r.doc.titulo.includes(t), `${q} => ${r && r.doc.titulo}`);
  }
});

test('reconhece "outra resposta" e "só o código"', () => {
  for (const t of ['outra', 'Outra resposta!', 'não era isso', 'próxima', 'another']) assert.equal(codeia.pedidoOutra(t), true, t);
  for (const t of ['só o código', 'so o codigo', 'código', 'mostra o código', 'apenas o código']) assert.equal(codeia.pedidoSoCodigo(t), true, t);
  for (const t of ['como criar um código', 'outra coisa que quero saber sobre express', 'como ler arquivo']) {
    assert.equal(codeia.pedidoOutra(t), false, t);
    assert.equal(codeia.pedidoSoCodigo(t), false, t);
  }
});

test('"outra" mostra a próxima melhor resposta e seguidas avançam', async () => {
  const h = [turno('user', 'como criar servidor express')];
  const r1 = await codeia.chatWithTools({ history: h, tools: [] });
  const t1 = r1.text();
  h.push(turno('model', t1), turno('user', 'outra'));
  const r2 = await codeia.chatWithTools({ history: h, tools: [] });
  const t2 = r2.text();
  assert.notEqual(t2, t1);
  assert.match(t2, /^\*\*/);
  h.push(turno('model', t2), turno('user', 'outra'));
  const r3 = await codeia.chatWithTools({ history: h, tools: [] });
  assert.notEqual(r3.text(), t2);
});

test('"outra" sem pergunta antes explica o que fazer, sem inventar', async () => {
  const r = await codeia.chatWithTools({ history: [turno('user', 'outra')], tools: [] });
  assert.match(r.text(), /Faça a pergunta primeiro/);
});

test('"só o código" devolve apenas os blocos de código da última resposta', async () => {
  const h = [turno('user', 'como ler um arquivo em node')];
  const r1 = await codeia.chatWithTools({ history: h, tools: [] });
  h.push(turno('model', r1.text()), turno('user', 'só o código'));
  const r2 = await codeia.chatWithTools({ history: h, tools: [] });
  const t = r2.text();
  assert.ok(t.startsWith('```'), t.slice(0, 60));
  assert.ok(!t.includes('**'), 'sem título nem explicação');
  assert.match(t, /readFileSync|readFile/);
});

test('"só o código" sem nada antes não inventa', async () => {
  const r = await codeia.chatWithTools({ history: [turno('user', 'só o código')], tools: [] });
  assert.match(r.text(), /Não tenho código pra mostrar/);
});

test('correção de digitação não vira chute: pergunta fora do assunto continua sem resposta', () => {
  const { modelo } = install.ensureInstalled();
  assert.equal(model.buscar(modelo, 'receita de pudim de leite condensado', { limite: 1 }).filter((a) => a.score >= 2).length, 0);
  // e digitação errada de verdade continua funcionando
  const r = model.buscar(modelo, 'ffmepg', { limite: 1 })[0];
  assert.ok(r && /ffmpeg/i.test(r.doc.titulo));
});

test('edição segura: troca trecho único em arquivo existente, recusa o resto', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-edit-'));
  fs.writeFileSync(path.join(dir, 'a.js'), "const porta = 3000;\nconst x = 1;\nconst y = 1;\n");
  const tools = [{ name: 'edit_file' }];
  const ok = codeia.decidirEdicao('troque "3000" por "8080" em a.js', tools, { cwd: dir });
  assert.deepEqual(ok.call, { name: 'edit_file', args: { path: 'a.js', old_text: '3000', new_text: '8080' } });
  assert.match(codeia.decidirEdicao('troque "= 1" por "= 2" em a.js', tools, { cwd: dir }).texto, /2 vezes/);
  assert.match(codeia.decidirEdicao('troque "zzz" por "k" em a.js', tools, { cwd: dir }).texto, /Não encontrei/);
  assert.match(codeia.decidirEdicao('troque "a" por "b" em ../fora.js', tools, { cwd: dir }).texto, /dentro da pasta/);
  assert.match(codeia.decidirEdicao('troque "a" por "b" em .env', tools, { cwd: dir }).texto, /segredos/);
  assert.match(codeia.decidirEdicao('troque "a" por "b" em nao.js', tools, { cwd: dir }).texto, /Não achei/);
  assert.equal(codeia.decidirEdicao('troque "3000" por "8080" em a.js', [], { cwd: dir }), null);
});

test('erro colado (stack trace) é reduzido à linha do erro e acha a resposta', () => {
  const { modelo } = install.ensureInstalled();
  const trace = "/home/u/app/index.js:10\n  const n = usuario.perfil.nome;\n                          ^\n\nTypeError: Cannot read properties of undefined (reading 'nome')\n    at Object.<anonymous> (/home/u/app/index.js:10:27)\n    at Module._compile (node:internal/modules/cjs/loader:1554:14)\nNode.js v22";
  const limpo = codeia.limparErroColado(trace);
  assert.ok(!/\bat Object/.test(limpo) && /TypeError/.test(limpo), limpo);
  assert.match(codeia.responder(modelo, trace), /Cannot read properties of undefined/);
  const py = "Traceback (most recent call last):\n  File \"/data/x/app.py\", line 3, in <module>\n    import cv2\nModuleNotFoundError: No module named 'cv2'";
  assert.match(codeia.responder(modelo, py), /No module named/);
  assert.equal(codeia.limparErroColado('como ler arquivo em node'), 'como ler arquivo em node');
});

test('esquecer UMA coisa ensinada, sem apagar o resto', () => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-notes-'));
  install.anotar('como chamar o dono', 'use !dono', { home: h });
  install.anotar('qual o prefixo do bot', 'o prefixo é !', { home: h });
  assert.deepEqual(install.listarAnotacoes({ home: h }).sort(), ['como chamar o dono', 'qual o prefixo do bot']);
  const r = install.esquecerAnotacao('CHAMAR o dono', { home: h });
  assert.equal(r.esquecida, 'como chamar o dono');
  assert.deepEqual(install.listarAnotacoes({ home: h }), ['qual o prefixo do bot']);
  assert.throws(() => install.esquecerAnotacao('não existe isso', { home: h }), /Não achei/);
  install.anotar('qual o prefixo do outro bot', 'é ?', { home: h });
  assert.throws(() => install.esquecerAnotacao('prefixo', { home: h }), /Mais de uma/);
  install.esquecerAnotacao('qual o prefixo do bot', { home: h });
  install.esquecerAnotacao('prefixo do outro', { home: h });
  assert.deepEqual(install.listarAnotacoes({ home: h }), []);
});
