'use strict';
// v0.41.0: subagentes definidos pelo usuário em .md (global e do projeto), com modelo próprio.
const fs = require('fs');
const os = require('os');
const path = require('path');
const HOME_FALSO = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-subagentes-'));
process.env.HOME = HOME_FALSO;
process.env.USERPROFILE = HOME_FALSO;

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const subagent = require('../src/subagent');
const trust = require('../src/trust');

const GLOBAL = path.join(config.HOME_DIR, 'subagentes');
fs.mkdirSync(GLOBAL, { recursive: true });
const escrever = (dir, nome, texto) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `${nome}.md`), texto); };

escrever(GLOBAL, 'testador', '---\nname: testador\ndescription: escreve e roda testes\ntools: read_file, write_file, run_checks, delegate_task\nmodel: openai:fornecedor/modelo-forte\nmax_passos: 12\n---\nVocê escreve testes primeiro.');
escrever(GLOBAL, 'leitor', '---\ndescription: só lê\n---\nLeia e resuma.');
escrever(GLOBAL, 'executor', '---\ndescription: tenta sobrescrever o embutido\n---\nnão deveria valer');
escrever(GLOBAL, 'Nome Inválido', '---\ndescription: x\n---\ncorpo');
escrever(GLOBAL, 'vazio', '---\ndescription: sem corpo\n---\n');

test('aparecem no delegate_task com descrição; inválidos e sobrescrita de embutido são ignorados', () => {
  const [decl] = subagent.declarations;
  const tipos = decl.parameters.properties.type.enum;
  assert.ok(tipos.includes('testador') && tipos.includes('leitor'));
  assert.equal(tipos.includes('vazio'), false);
  assert.equal(tipos.filter((t) => t === 'executor').length, 1);
  assert.match(decl.description, /"testador" = escreve e roda testes \(global\)/);
  assert.equal(subagent.todosOsTipos().executor.instrucao, subagent.TIPOS.executor.instrucao, 'o embutido não é sobrescrito');
});

test('executa com a instrução, as ferramentas (sem delegate_task) e o modelo do arquivo', async () => {
  let opcoes = null;
  const r = await subagent.execute('delegate_task', { task: 'teste o módulo x', type: 'testador' }, {
    runOnceFn: async (prompt, o) => { opcoes = o; return { text: 'feito' }; },
  });
  assert.match(r, /relatório do subagente testador\]\nfeito/);
  assert.match(opcoes.extraSystemInstruction, /^Você escreve testes primeiro\./);
  assert.deepEqual(opcoes.allowedTools, ['read_file', 'write_file', 'run_checks'], 'delegate_task nunca entra');
  assert.equal(opcoes.modelName, 'openai:fornecedor/modelo-forte');
  assert.equal(opcoes.maxSteps, 12);
});

test('sem "tools", o padrão é só leitura; nunca passa das ferramentas do pai', async () => {
  const leitor = subagent.todosOsTipos().leitor;
  assert.deepEqual(leitor.tools, ['read_file', 'list_dir', 'search_files', 'read_skill']);
  assert.equal(subagent.ehSomenteLeitura({ type: 'leitor' }), true);
  assert.equal(subagent.ehSomenteLeitura({ type: 'testador' }), false);
  let opcoes = null;
  await subagent.execute('delegate_task', { task: 'x', type: 'testador' }, { allowedPai: ['read_file'], runOnceFn: async (p, o) => { opcoes = o; return { text: 'ok' }; } });
  assert.deepEqual(opcoes.allowedTools, ['read_file']);
});

test('subagente do projeto vale só se o usuário não negou confiança no projeto', () => {
  const projeto = fs.mkdtempSync(path.join(HOME_FALSO, 'proj-'));
  escrever(path.join(projeto, '.gemini-code', 'subagentes'), 'do-repo', '---\ndescription: veio do repositório\n---\nInstrução do repositório.');
  assert.ok(subagent.todosOsTipos(projeto)['do-repo']);
  assert.match(subagent.todosOsTipos(projeto)['do-repo'].descricao, /\(projeto\)/);
  trust.definir(projeto, 'negar');
  assert.equal(subagent.todosOsTipos(projeto)['do-repo'], undefined);
});
