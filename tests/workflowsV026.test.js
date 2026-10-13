'use strict';
// v0.26.0: /workflows exemplos | instalar | novo | ver — sem editar JSON na mão.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const wf = require('../src/tools/workflowTools');
const { tratar, listarExemplos, descrever, ESQUELETO } = require('../src/workflowCommands');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gc-wf26-'));
const textos = (l) => l.map((x) => x.texto).join('\n');
const EXEMPLOS_REAIS = path.join(__dirname, '..', 'workflows', 'exemplos');

test('exemplos reais do projeto: todos listados e todos passam na validação (sem erros)', () => {
  const l = listarExemplos(EXEMPLOS_REAIS);
  assert.ok(l.length >= 5);
  for (const e of l) {
    assert.ok(e.descricao, `${e.nome} precisa de description`);
    assert.deepEqual(wf.validarArquivo(path.join(EXEMPLOS_REAIS, `${e.nome}.json`)).erros, [], e.nome);
  }
});

test('/workflows exemplos lista; /workflows instalar copia para a pasta do usuário', async () => {
  const pasta = path.join(tmp(), 'wf');
  const ex = tmp();
  fs.writeFileSync(path.join(ex, 'a.json'), JSON.stringify({ name: 'a', description: 'faz a', steps: [{ id: 'x', prompt: 'x' }] }));
  fs.writeFileSync(path.join(ex, 'ruim.json'), JSON.stringify({ name: 'ruim', steps: [{ id: 'x', prompt: 'x' }, { id: 'x', prompt: 'y' }] }));
  fs.writeFileSync(path.join(ex, 'quebrado.json'), '{ nao e json');
  const lista = textos(await tratar('/workflows exemplos', { pasta, exemplos: ex }));
  assert.match(lista, /a \(1 passos\) — faz a/);
  assert.doesNotMatch(lista, /quebrado/);
  assert.match(lista, /\/workflows instalar <nome>/);

  assert.match(textos(await tratar('/workflows instalar a', { pasta, exemplos: ex })), /Instalado em .*a\.json/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(pasta, 'a.json'), 'utf8')).name, 'a');
  // não sobrescreve sem --forcar
  fs.writeFileSync(path.join(pasta, 'a.json'), '{"editado":true}');
  assert.match(textos(await tratar('/workflows instalar a', { pasta, exemplos: ex })), /Já existe .*--forcar/);
  assert.equal(fs.readFileSync(path.join(pasta, 'a.json'), 'utf8'), '{"editado":true}');
  assert.match(textos(await tratar('/workflows instalar a --forcar', { pasta, exemplos: ex })), /Instalado/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(pasta, 'a.json'), 'utf8')).name, 'a');
  // exemplo com erro não é instalado; nome inexistente/perigoso é recusado
  assert.match(textos(await tratar('/workflows instalar ruim', { pasta, exemplos: ex })), /tem erro e não foi instalado/);
  assert.ok(!fs.existsSync(path.join(pasta, 'ruim.json')));
  assert.match(textos(await tratar('/workflows instalar ../../etc/passwd', { pasta, exemplos: ex })), /não existe/);
  assert.match(textos(await tratar('/workflows instalar nada', { pasta, exemplos: ex })), /não existe/);
  assert.match(textos(await tratar('/workflows instalar', { pasta, exemplos: ex })), /Uso: \/workflows instalar/);
});

test('instalar de verdade: cada exemplo real instala e o agente passa a listá-lo', async () => {
  const pasta = tmp();
  wf.definirPasta(pasta);
  for (const e of listarExemplos(EXEMPLOS_REAIS)) assert.match(textos(await tratar(`/workflows instalar ${e.nome}`, { pasta, exemplos: EXEMPLOS_REAIS })), /Instalado/, e.nome);
  const nomes = wf.listar().map((w) => w.nome);
  assert.ok(nomes.includes('revisar-cada-arquivo'));
  assert.equal(nomes.length, listarExemplos(EXEMPLOS_REAIS).length);
});

test('/workflows novo cria esqueleto VÁLIDO (sem erros), não sobrescreve e valida o nome', async () => {
  const pasta = path.join(tmp(), 'wf');
  assert.match(textos(await tratar('/workflows novo meu-wf', { pasta })), /Esqueleto criado/);
  const arq = path.join(pasta, 'meu-wf.json');
  const w = JSON.parse(fs.readFileSync(arq, 'utf8'));
  assert.equal(w.name, 'meu-wf');
  assert.deepEqual(wf.validarArquivo(arq).erros, []);
  assert.ok(wf.validarArquivo(arq).avisos.some((a) => /variáveis obrigatórias: alvo/.test(a)));
  fs.writeFileSync(arq, '{"editado":true}');
  assert.match(textos(await tratar('/workflows novo meu-wf', { pasta })), /Já existe/);
  assert.equal(fs.readFileSync(arq, 'utf8'), '{"editado":true}');
  for (const ruim of ['', '../x', 'a b', 'a/b']) assert.match(textos(await tratar(`/workflows novo ${ruim}`, { pasta })), /Uso: \/workflows novo/);
});

test('/workflows ver resume passos, opções e variáveis; trata nome ruim e JSON quebrado', async () => {
  const pasta = tmp();
  fs.writeFileSync(path.join(pasta, 'w.json'), JSON.stringify({
    name: 'w', description: 'desc', maxTokens: 40000,
    steps: [{ id: 'l', prompt: 'lista {{pasta}}', tools: ['list_dir'] }, { id: 'r', prompt: '{{item}}', each: '{{l}}', paralelo: 2, tools: ['read_file'], optional: true, retry: 1 }, { id: 's', prompt: '{{r}}', tools: [], when: '{{r}}' }],
  }));
  fs.writeFileSync(path.join(pasta, 'q.json'), '{ nao e json');
  const t = textos(await tratar('/workflows ver w', { pasta }));
  assert.match(t, /^w — desc/);
  assert.match(t, /teto: 40\.000 tokens/);
  assert.match(t, /precisa de: pasta/);
  assert.match(t, /1\. l \[ferramentas: list_dir\]/);
  assert.match(t, /2\. r \[para cada item de \{\{l\}\} \(2 ao mesmo tempo\); ferramentas: read_file; opcional; retry 1\]/);
  assert.match(t, /3\. s \[sem ferramentas; condicional\]/);
  assert.match(textos(await tratar('/workflows ver nada', { pasta })), /não encontrado/);
  assert.match(textos(await tratar('/workflows ver ../w', { pasta })), /não encontrado/);
  assert.match(textos(await tratar('/workflows ver q', { pasta })), /Não consegui ler o JSON/);
  assert.match(descrever(ESQUELETO('z')), /1\. levantar \[ferramentas: read_file, list_dir, search_files\]/);
});

test('validar avisa quando a description ainda é a do esqueleto (o agente aciona workflows pela descrição)', () => {
  const v = wf.validarWorkflow(ESQUELETO('x'));
  assert.deepEqual(v.erros, []);
  assert.ok(v.avisos.some((a) => /texto de preenchimento do esqueleto/.test(a)));
  const ok = wf.validarWorkflow({ ...ESQUELETO('x'), description: 'Faz uma revisão de verdade.' });
  assert.ok(!ok.avisos.some((a) => /preenchimento/.test(a)));
});
