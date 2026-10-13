'use strict';
// v0.11.0: todo_write, /compact e comandos de barra personalizados.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const todo = require('../src/tools/todoTools');
const { compactar } = require('../src/compact');
const custom = require('../src/customCommands');
const tools = require('../src/tools');
const { buildSystemInstruction } = require('../src/agent');

const U = (t) => ({ role: 'user', parts: [{ text: t }] });
const M = (t) => ({ role: 'model', parts: [{ text: t }] });
const CALL = (name, args) => ({ role: 'model', parts: [{ functionCall: { name, args } }] });
const RESP = (name, r) => ({ role: 'user', parts: [{ functionResponse: { name, response: { result: r } } }] });

test('todo_write: valida, renderiza e aceita só uma tarefa em andamento', () => {
  todo.limpar();
  const ok = todo.execute('todo_write', { todos: [{ content: 'ler o código', status: 'completed' }, { content: 'corrigir bug', status: 'in_progress' }, { content: 'rodar testes', status: 'pending' }] });
  assert.match(ok, /Tarefas \(1\/3\)/);
  assert.match(ok, /\[x\] ler o código/);
  assert.match(ok, /\[~\] corrigir bug/);
  assert.equal(todo.estado().length, 3);
  assert.match(todo.execute('todo_write', { todos: [{ content: 'a', status: 'in_progress' }, { content: 'b', status: 'in_progress' }] }), /UMA tarefa/);
  assert.equal(todo.estado().length, 3, 'lista inválida não troca a anterior');
  assert.match(todo.execute('todo_write', { todos: [{ content: 'a', status: 'feito' }] }), /status inválido/);
  assert.match(todo.execute('todo_write', { todos: 'x' }), /precisa de "todos"/);
  assert.match(todo.execute('todo_write', { todos: [{ content: '  ', status: 'pending' }] }), /content/);
  todo.limpar();
});

test('todo_write está registrado nas ferramentas e no prompt do agente', async () => {
  const decls = await tools.getAllDeclarations(['todo_write']);
  assert.equal(decls.length, 1);
  assert.match(await tools.execute('todo_write', { todos: [{ content: 'x', status: 'pending' }] }), /\[ \] x/);
  todo.limpar();
  assert.match(buildSystemInstruction('', { cwd: os.tmpdir() }), /todo_write/);
});

test('/compact: resume o começo, mantém o fim inteiro e não separa chamada de resposta', () => {
  const h = [];
  for (let i = 1; i <= 8; i++) h.push(U(`pedido ${i} sobre server.js`), CALL('read_file', { path: `src/a${i}.js` }), RESP('read_file', 'conteúdo'), M(`feito ${i}`));
  const r = compactar(h, { manter: 6 });
  assert.equal(r.compactou, true);
  assert.ok(r.history.length < h.length);
  assert.match(r.history[0].parts[0].text, /Resumo da conversa/);
  assert.match(r.history[0].parts[0].text, /read_file×/);
  assert.match(r.history[0].parts[0].text, /src\/a1\.js/);
  assert.equal(r.history[1].role, 'model');
  const resto = r.history.slice(2);
  assert.equal(resto[0].role, 'user');
  assert.ok(!resto[0].parts.some((p) => p.functionResponse), 'trecho recente não começa em resposta órfã');
  // todo functionCall tem a resposta logo depois
  resto.forEach((m, i) => { if (m.parts.some((p) => p.functionCall)) assert.ok(resto[i + 1].parts.some((p) => p.functionResponse)); });
  assert.deepEqual(resto, h.slice(h.length - resto.length));
});

test('/compact: conversa curta não muda; compactar duas vezes não explode', () => {
  const curta = [U('oi'), M('oi!')];
  assert.equal(compactar(curta).compactou, false);
  assert.equal(compactar(curta).history, curta);
  const h = [];
  for (let i = 1; i <= 12; i++) h.push(U(`p${i}`), M(`r${i}`));
  const a = compactar(h, { manter: 4 });
  const b = compactar([...a.history, ...h.slice(-6)], { manter: 4 });
  assert.equal(b.history[0].role, 'user');
  assert.ok(b.history[0].parts[0].text.split('\n').length < 40);
});

test('comandos personalizados: projeto vence global, $ARGUMENTS/$1, reservados ignorados', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-cmd-'));
  const home = path.join(raiz, 'home'); const proj = path.join(raiz, 'proj');
  fs.mkdirSync(path.join(home, 'commands'), { recursive: true });
  fs.mkdirSync(path.join(proj, '.gemini-code', 'commands'), { recursive: true });
  fs.writeFileSync(path.join(home, 'commands', 'revisar.md'), 'Revise (global): $ARGUMENTS');
  fs.writeFileSync(path.join(proj, '.gemini-code', 'commands', 'revisar.md'), '---\ndescription: revisa o arquivo\n---\nRevise o arquivo $1 procurando bugs. Foco: $ARGUMENTS');
  fs.writeFileSync(path.join(proj, '.gemini-code', 'commands', 'clear.md'), 'não pode');
  fs.writeFileSync(path.join(proj, '.gemini-code', 'commands', 'resumo.md'), 'Resuma o projeto.');
  fs.writeFileSync(path.join(proj, '.gemini-code', 'commands', 'Nome Ruim.md'), 'x');
  const c = custom.carregar({ cwd: proj, home });
  assert.deepEqual([...c.keys()].sort(), ['resumo', 'revisar']);
  assert.equal(c.get('revisar').origem, 'projeto');
  assert.equal(c.get('revisar').descricao, 'revisa o arquivo');
  assert.equal(custom.resolver('/revisar src/a.js erros de null', c).texto, 'Revise o arquivo src/a.js procurando bugs. Foco: src/a.js erros de null');
  assert.equal(custom.resolver('/resumo', c).texto, 'Resuma o projeto.');
  assert.equal(custom.resolver('/resumo foco em testes', c).texto, 'Resuma o projeto.\n\nfoco em testes');
  assert.equal(custom.resolver('/clear', c), null);
  assert.equal(custom.resolver('/naoexiste x', c), null);
  assert.equal(custom.resolver('texto normal', c), null);
});
