'use strict';
// v0.27.0: /workflows criar (IA escreve RASCUNHO) + rascunhos/aprovar/descartar. Rascunho nunca fica visível ao agente.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const wf = require('../src/tools/workflowTools');
const { tratar, extrairJson, INSTRUCAO_CRIAR } = require('../src/workflowCommands');

function ambiente() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-wf27-'));
  const pasta = path.join(raiz, 'workflows');
  fs.mkdirSync(pasta);
  wf.definirPasta(pasta);
  return { raiz, pasta, rascunhos: path.join(raiz, 'workflow-rascunhos') };
}
const textos = (l) => l.map((x) => x.texto).join('\n');
const BOM = { name: 'qualquer', description: 'Revisa uma pasta.', maxTokens: 20000, evil: 'x', steps: [
  { id: 'listar', prompt: 'Liste arquivos de {{pasta}}', tools: ['list_dir'], cmd: 'rm -rf /' },
  { id: 'resumo', prompt: 'Resuma {{listar}}', tools: [] },
] };
const fake = (obj, guarda = {}) => async (prompt, opts) => { guarda.prompt = prompt; guarda.opts = opts; return { text: typeof obj === 'string' ? obj : '```json\n' + JSON.stringify(obj) + '\n```', history: [] }; };

test('criar: gera rascunho (nome forçado, campos estranhos descartados), sem ferramentas na chamada e fora da pasta ativa', async () => {
  const { pasta, rascunhos } = ambiente();
  const g = {};
  const out = await tratar('/workflows criar revisar-pasta revisar os arquivos de uma pasta e resumir', { pasta, rascunhos, runOnceFn: fake(BOM, g) });
  assert.match(textos(out), /Rascunho "revisar-pasta" criado \(ainda NÃO está em uso/);
  assert.match(textos(out), /1\. listar \[ferramentas: list_dir\]/);
  assert.deepEqual(g.opts.allowedTools, wf.NENHUMA, 'a geração roda SEM ferramentas');
  assert.match(g.prompt, /revisar os arquivos de uma pasta e resumir/);
  const salvo = JSON.parse(fs.readFileSync(path.join(rascunhos, 'revisar-pasta.json'), 'utf8'));
  assert.equal(salvo.name, 'revisar-pasta');
  assert.equal(salvo.evil, undefined);
  assert.equal(salvo.steps[0].cmd, undefined);
  assert.deepEqual(wf.listar(), [], 'o agente não enxerga rascunhos');
  assert.ok(!fs.existsSync(path.join(pasta, 'revisar-pasta.json')));
  assert.match(textos(await tratar('/workflows rascunhos', { pasta, rascunhos })), /revisar-pasta/);
});

test('criar: avisa o que merece olho humano (sem tools = herda tudo; write_file/run_shell)', async () => {
  const { pasta, rascunhos } = ambiente();
  const arriscado = { description: 'Faz coisas.', steps: [{ id: 'a', prompt: 'a' }, { id: 'b', prompt: 'b {{a}}', tools: ['write_file', 'read_file'] }, { id: 'c', prompt: 'c', tools: ['run_shell'] }] };
  const t = textos(await tratar('/workflows criar arriscado fazer varias coisas no projeto', { pasta, rascunhos, runOnceFn: fake(arriscado) }));
  assert.match(t, /ATENÇÃO passo "a": sem "tools" \(herda TODAS/);
  assert.match(t, /ATENÇÃO passo "b": pode usar write_file/);
  assert.match(t, /ATENÇÃO passo "c": pode usar run_shell/);
  assert.deepEqual(wf.riscosDoWorkflow(BOM), []);
});

test('criar: JSON ruim, sem JSON, workflow inválido e erro do modelo NÃO salvam nada', async () => {
  const { pasta, rascunhos } = ambiente();
  const casos = [
    [fake('desculpe, não sei'), /não devolveu um JSON/],
    [fake('{ "steps": [ quebrado }'), /JSON inválido/],
    [fake({ description: 'd', steps: [{ id: 'a', prompt: 'x' }, { id: 'a', prompt: 'y' }] }), /inválido, então NÃO salvei[\s\S]*repetido/],
    [fake({ description: 'd', steps: [{ id: 'a', prompt: '{{b}}' }, { id: 'b', prompt: 'x' }] }), /NÃO salvei[\s\S]*antes de ele rodar/],
    [async () => { throw new Error('quota estourada'); }, /Não consegui gerar o rascunho: quota estourada/],
  ];
  for (const [run, esperado] of casos) assert.match(textos(await tratar('/workflows criar x1 fazer algo bem legal aqui', { pasta, rascunhos, runOnceFn: run })), esperado);
  assert.ok(!fs.existsSync(path.join(rascunhos, 'x1.json')));
});

test('criar: valida nome e pedido, e recusa nome de workflow que já está em uso', async () => {
  const { pasta, rascunhos } = ambiente();
  let chamou = 0;
  const run = async () => { chamou++; return { text: '{}', history: [] }; };
  for (const ruim of ['', 'so-nome', '../x faça isso e aquilo bem', 'a/b faça isso e aquilo']) assert.match(textos(await tratar(`/workflows criar ${ruim}`, { pasta, rascunhos, runOnceFn: run })), /Uso: \/workflows criar/);
  assert.match(textos(await tratar('/workflows criar curto faz', { pasta, rascunhos, runOnceFn: run })), /mínimo 10/);
  fs.writeFileSync(path.join(pasta, 'existe.json'), JSON.stringify({ name: 'existe', description: 'd', steps: [{ id: 'a', prompt: 'a' }] }));
  assert.match(textos(await tratar('/workflows criar existe fazer uma coisa qualquer', { pasta, rascunhos, runOnceFn: run })), /Já existe o workflow "existe"/);
  assert.equal(chamou, 0, 'nenhuma chamada de IA gasta nesses casos');
});

test('aprovar: valida, move para a pasta ativa (agente passa a ver) e apaga o rascunho; não sobrescreve sem --forcar', async () => {
  const { pasta, rascunhos } = ambiente();
  await tratar('/workflows criar bom fazer a revisao de uma pasta qualquer', { pasta, rascunhos, runOnceFn: fake(BOM) });
  assert.match(textos(await tratar('/workflows aprovar bom', { pasta, rascunhos })), /Aprovado: .*bom\.json/);
  assert.ok(!fs.existsSync(path.join(rascunhos, 'bom.json')));
  assert.deepEqual(wf.listar().map((w) => w.nome), ['bom']);
  // novo rascunho com o mesmo nome não pode ser criado (já está em uso); força via arquivo direto
  fs.mkdirSync(rascunhos, { recursive: true });
  fs.writeFileSync(path.join(rascunhos, 'bom.json'), JSON.stringify({ name: 'bom', description: 'novo', steps: [{ id: 'a', prompt: 'a', tools: [] }] }));
  assert.match(textos(await tratar('/workflows aprovar bom', { pasta, rascunhos })), /Já existe .*--forcar/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(pasta, 'bom.json'), 'utf8')).description, 'Revisa uma pasta.');
  assert.match(textos(await tratar('/workflows aprovar bom --forcar', { pasta, rascunhos })), /Aprovado/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(pasta, 'bom.json'), 'utf8')).description, 'novo');
});

test('aprovar: rascunho editado e quebrado é recusado; descartar apaga; nomes perigosos/inexistentes não fazem nada', async () => {
  const { pasta, rascunhos } = ambiente();
  fs.mkdirSync(rascunhos, { recursive: true });
  fs.writeFileSync(path.join(rascunhos, 'quebrado.json'), JSON.stringify({ steps: [{ id: 'a', prompt: 'x' }, { id: 'a', prompt: 'y' }] }));
  assert.match(textos(await tratar('/workflows aprovar quebrado', { pasta, rascunhos })), /O rascunho tem erro/);
  assert.ok(fs.existsSync(path.join(rascunhos, 'quebrado.json')), 'continua como rascunho para você corrigir');
  assert.ok(!fs.existsSync(path.join(pasta, 'quebrado.json')));
  assert.match(textos(await tratar('/workflows descartar quebrado', { pasta, rascunhos })), /descartado/);
  assert.ok(!fs.existsSync(path.join(rascunhos, 'quebrado.json')));
  for (const cmd of ['aprovar nada', 'aprovar ../workflows/x', 'descartar ../../etc/passwd', 'aprovar', 'descartar']) assert.match(textos(await tratar(`/workflows ${cmd}`, { pasta, rascunhos })), /não encontrado/);
  assert.match(textos(await tratar('/workflows rascunhos', { pasta, rascunhos })), /Nenhum rascunho/);
});

test('extrairJson e instrução: aceita cerca de markdown/texto em volta; instrução manda usar tools e só ler', () => {
  assert.deepEqual(extrairJson('Claro!\n```json\n{"a":1}\n```\nPronto.'), { a: 1 });
  assert.throws(() => extrairJson('sem chaves'), /não devolveu um JSON/);
  const i = INSTRUCAO_CRIAR('meu', 'fazer X');
  assert.match(i, /"name":"meu"/);
  assert.match(i, /SEMPRE ponha "tools"/);
  assert.match(i, /Prefira só leitura/);
});
