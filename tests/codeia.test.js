'use strict';
// code-ia: modelo próprio (busca BM25 + gerador n-grama), instalação automática e integração com o roteador.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-codeia-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
fs.mkdirSync(path.join(home, '.gemini-code'), { recursive: true });

const { palavras, tokensDeCodigo } = require('../src/code-ia/tokenizer');
const modelo = require('../src/code-ia/model');
const install = require('../src/code-ia/install');
const codeia = require('../src/providers/codeia');
const { escolher } = require('../src/provider');
const { HOME_DIR } = require('../src/config');

const H = (t) => [{ role: 'user', parts: [{ text: t }] }];

test('tokenizador: busca ignora acento/stopwords; código preserva símbolos e espaços', () => {
  assert.deepEqual(palavras('Como CRIAR um servidor?'), palavras('como criar servidor'));
  assert.ok(palavras('criação').join() === palavras('criacao').join());
  assert.equal(tokensDeCodigo('a => b + 1').join(''), 'a => b + 1');
});

test('treinar + buscar: acha o bloco certo pelo título e descarta o que não sabe', () => {
  const m = modelo.treinar([{ nome: 't.md', texto: '# Como somar números\nUse o operador de soma.\n```js\nconst s = a + b;\n```\n\n# Como fritar ovo\nAqueça a frigideira com óleo e quebre o ovo dentro dela.\n' }]);
  assert.equal(m.docs.length, 2);
  assert.equal(modelo.buscar(m, 'somar numeros')[0].doc.titulo, 'Como somar números');
  assert.equal(modelo.buscar(m, 'xyzabc inexistente').length, 0);
});

test('completar: determinístico, fecha a instrução e NÃO inventa quando não reconhece', () => {
  const m = modelo.treinar([{ nome: 't.md', texto: '# Exemplo\nTexto de apoio para o bloco.\n```js\nconst fs = require(\'fs\');\nfs.readFileSync(\'a\');\n```\n' }]);
  const a = modelo.completar(m, "const fs = require(");
  assert.equal(a, modelo.completar(m, "const fs = require("));
  assert.equal(a, "'fs');");
  assert.equal(modelo.completar(m, 'class Zebra { quantum('), '');
});

test('completar: usa o contexto mais longo (app.listen termina com a porta e o callback aprendidos)', () => {
  const { modelo: m } = install.ensureInstalled();
  const r = modelo.completar(m, 'app.listen(3000, ');
  assert.match(r, /0\.0\.0\.0/);
  assert.ok(r.endsWith(';'));
});

test('instalação automática: 1ª vez instala, 2ª confere, mudar o conhecimento atualiza', () => {
  fs.rmSync(install.modelPath(), { force: true });
  install.limparCache();
  const msgs = [];
  const r1 = install.ensureInstalled({ log: (m) => msgs.push(m) });
  assert.equal(r1.acao, 'instalado');
  assert.ok(fs.existsSync(install.modelPath()));
  assert.match(msgs[0], /Primeira execução/);
  assert.ok(r1.stats.blocos > 20);

  const msgs2 = [];
  assert.equal(install.ensureInstalled({ log: (m) => msgs2.push(m) }).acao, 'ok');
  assert.equal(msgs2.length, 0, 'sem trabalho a fazer, não imprime nada');

  fs.mkdirSync(path.join(HOME_DIR, 'knowledge'), { recursive: true });
  fs.writeFileSync(path.join(HOME_DIR, 'knowledge', 'meu.md'), '# Como usar a NetoLang\nNetoLang é a linguagem do Neto, interpretada em JavaScript.\n');
  assert.equal(install.ensureInstalled().acao, 'atualizado');
});

test('modelo corrompido no disco é reconstruído em vez de quebrar', () => {
  fs.writeFileSync(install.modelPath(), '{ isso nao e json');
  assert.equal(install.ensureInstalled().acao, 'instalado');
});

test('ensinar: copia o arquivo, refaz o modelo e o code-ia passa a responder', () => {
  const f = path.join(home, 'novo.md');
  fs.writeFileSync(f, '# Como fazer o boss do mapa\nCrie uma entidade com vida alta e um padrão de ataque em três fases.\n');
  install.limparCache();
  const r = install.ensinar(f);
  assert.equal(r.copiados, 1);
  const resp = codeia.responder(install.obterModelo(), 'como fazer o boss do mapa');
  assert.match(resp, /três fases/);
  assert.throws(() => install.ensinar(path.join(home, 'nao-existe')), /Não achei/);
  fs.writeFileSync(path.join(home, 'x.bin'), 'x');
  assert.throws(() => install.ensinar(path.join(home, 'x.bin')), /Nada pra ensinar/);
});

test('provedor code-ia: responde, admite que não sabe, completa código e faz streaming', async () => {
  const m = install.obterModelo();
  assert.match(codeia.responder(m, 'como ler arquivo em node'), /readFileSync/);
  assert.match(codeia.responder(m, 'receita de pudim de leite condensado'), /Ainda não sei/);
  assert.match(codeia.responder(m, 'completa: const fs = require('), /Continuação sugerida/);

  const pedacos = [];
  const resp = await codeia.chatWithTools({ history: H('como esperar um tempo sleep em javascript'), onText: (t) => pedacos.push(t) });
  assert.match(resp.text(), /setTimeout/);
  assert.equal(pedacos.join(''), resp.text());
  assert.equal(resp.functionCalls(), undefined);
});

test('roteador: code-ia só quando explícito; sem chave usa um LLM local geral', () => {
  const base = { provider: 'gemini', model: 'nuvem', apiKey: 'K', codeIaAuto: true };
  assert.equal(escolher({ cfg: base, modelName: '@codeia', history: [] }).provider, 'code-ia');
  assert.equal(escolher({ cfg: base, modelName: 'code-ia', history: [] }).provider, 'code-ia');
  assert.equal(escolher({ cfg: { ...base, provider: 'code-ia' }, history: H('oi') }).provider, 'code-ia');
  assert.equal(escolher({ cfg: base, history: H('oi') }).provider, 'gemini');
  assert.equal(escolher({ cfg: { ...base, apiKey: '' }, history: H('oi') }).provider, 'llamacpp');
  assert.equal(escolher({ cfg: { ...base, apiKey: '', codeIaAuto: false }, history: H('oi') }).provider, 'gemini');
});

test('conversa simples e identidade: não usa o corpus e não finge ser outro modelo', () => {
  const m = install.obterModelo();
  assert.match(codeia.responder(m, 'oi'), /code-ia/);
  assert.match(codeia.responder(m, 'você é o deepseek?'), /Não uso Qwen, DeepSeek/);
  assert.match(codeia.responder(m, 'ajuda'), /learn/);
});

test('pergunta curta de acompanhamento usa a pergunta anterior', () => {
  const m = install.obterModelo();
  const r = codeia.responder(m, 'e em python?', { anterior: 'como ler um arquivo' });
  assert.match(r, /Python/);
});

test('ferramentas: só leitura, só com pedido claro, só se a ferramenta está liberada', () => {
  const T = ['read_file', 'list_dir', 'search_files', 'write_file'].map((name) => ({ name }));
  assert.deepEqual(codeia.decidirFerramenta('leia package.json', T), { name: 'read_file', args: { path: 'package.json' } });
  assert.deepEqual(codeia.decidirFerramenta('liste a pasta src', T), { name: 'list_dir', args: { path: 'src' } });
  assert.deepEqual(codeia.decidirFerramenta('liste os arquivos', T), { name: 'list_dir', args: { path: '.' } });
  assert.deepEqual(codeia.decidirFerramenta('procure TODO em src', T), { name: 'search_files', args: { pattern: 'TODO', path: 'src', ignore_case: true } });
  assert.equal(codeia.decidirFerramenta('como ler arquivo em node', T), null, 'pergunta de conhecimento não vira ferramenta');
  assert.equal(codeia.decidirFerramenta('abra https://x.com/a.html', T), null);
  assert.equal(codeia.decidirFerramenta('leia package.json', []), null, 'sem a ferramenta liberada (perfil/convidado), não chama');
  assert.equal(codeia.decidirFerramenta('apague o arquivo a.js', T), null, 'nunca escreve/apaga');
  assert.equal(codeia.decidirFerramenta('escreva a.js com oi', T), null);
});

test('ferramentas no loop do agente: chama read_file e depois mostra o resultado', async () => {
  const T = [{ name: 'read_file' }];
  const h = H('leia a.txt');
  const r1 = await codeia.chatWithTools({ history: h, tools: T });
  assert.deepEqual(r1.functionCalls().map((c) => [c.name, c.args.path]), [['read_file', 'a.txt']]);
  const h2 = [...h, { role: 'model', parts: r1.rawParts() }, { role: 'user', parts: [{ functionResponse: { name: 'read_file', response: { result: 'olá mundo' } } }] }];
  const r2 = await codeia.chatWithTools({ history: h2, tools: T });
  assert.equal(r2.functionCalls(), undefined);
  assert.match(r2.text(), /a\.txt[\s\S]*olá mundo/);
  const h3 = [...h, { role: 'model', parts: r1.rawParts() }, { role: 'user', parts: [{ functionResponse: { name: 'read_file', response: { result: 'Erro: arquivo não existe' } } }] }];
  assert.match((await codeia.chatWithTools({ history: h3, tools: T })).text(), /Não consegui: Erro/);
});

test('aprende com SEU código: acha função por nome, cita a fonte, ignora segredos e node_modules; forget desfaz', () => {
  const proj = path.join(home, 'meuprojeto');
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.mkdirSync(path.join(proj, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'src', 'banco.js'), "function calcularDanoCritico(base, nivel) {\n  return Math.round(base * (1.5 + nivel / 100));\n}\nmodule.exports = { calcularDanoCritico };\n");
  fs.writeFileSync(path.join(proj, '.env'), 'GEMINI_API_KEY=SEGREDO123\n');
  fs.writeFileSync(path.join(proj, 'node_modules', 'x', 'i.js'), 'function lixoDeDependencia() { return 1; }\n');
  const r = install.ensinar(proj);
  assert.equal(r.copiados, 1);
  const m = install.obterModelo();
  const resp = codeia.responder(m, 'onde está a função calcularDanoCritico');
  assert.match(resp, /Math\.round/);
  assert.match(resp, /fonte: learn\//);
  assert.ok(!JSON.stringify(m).includes('SEGREDO123'));
  assert.ok(!JSON.stringify(m).includes('lixoDeDependencia'));
  assert.match(modelo.completar(m, 'function calcularDanoCritico('), /base, nivel\)/);
  install.esquecer();
  assert.doesNotMatch(codeia.responder(install.obterModelo(), 'onde está a função calcularDanoCritico'), /Math\.round/);
});

test('modelo de versão antiga é atualizado com aviso claro (não "primeira execução")', () => {
  const antigo = JSON.parse(fs.readFileSync(install.modelPath(), 'utf8'));
  antigo.version = 1;
  fs.writeFileSync(install.modelPath(), JSON.stringify(antigo));
  const msgs = [];
  install.limparCache();
  assert.equal(install.ensureInstalled({ log: (x) => msgs.push(x) }).acao, 'instalado');
  assert.match(msgs[0], /Atualizando o code-ia para a versão nova/);
});

test('tolera erro de digitação (palavra que não existe vira a mais parecida do vocabulário)', () => {
  const m = install.obterModelo();
  assert.equal(modelo.distancia('servido', 'servidor', 2), 1);
  assert.equal(modelo.distancia('arqivo', 'arquivo', 2), 1);
  assert.equal(modelo.distancia('ffmepg', 'ffmpeg', 2), 1, 'troca de letras vizinhas conta como 1');
  assert.match(modelo.buscar(m, 'criar servido express')[0].doc.titulo, /Express/);
  assert.equal(modelo.buscar(m, 'xqzwkj').length, 0, 'lixo continua sem resposta');
});

test('criar arquivo: só NOVO, só dentro da pasta, nunca .env, e só com write_file liberado', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-escrita-'));
  fs.writeFileSync(path.join(cwd, 'existe.js'), 'x');
  const W = [{ name: 'write_file' }];
  const get = () => install.obterModelo();
  const ctx = { obterModelo: get, cwd, history: [{ role: 'model', parts: [{ text: 'Exemplo:\n```js\nconsole.log(1)\n```' }] }] };

  const a = codeia.decidirEscrita('crie server.js com servidor express', W, ctx);
  assert.equal(a.call.name, 'write_file');
  assert.equal(a.call.args.path, 'server.js');
  assert.match(a.call.args.content, /express\(\)/);
  assert.equal(codeia.decidirEscrita('crie um servidor express em app.js', W, ctx).call.args.path, 'app.js');
  assert.deepEqual(codeia.decidirEscrita('salve isso em x.js', W, ctx).call.args, { path: 'x.js', content: 'console.log(1)\n' });

  assert.match(codeia.decidirEscrita('crie existe.js com servidor express', W, ctx).texto, /já existe/);
  assert.match(codeia.decidirEscrita('crie ../fora.js com servidor express', W, ctx).texto, /dentro da pasta atual/);
  assert.match(codeia.decidirEscrita('crie a.js com bolo de cenoura', W, ctx).texto, /Não conheço código/);
  assert.match(codeia.decidirEscrita('salve isso em y.js', W, { ...ctx, history: H('oi') }).texto, /Não achei nenhum bloco/);
  assert.equal(codeia.decidirEscrita('crie server.js com servidor express', [{ name: 'read_file' }], ctx), null, 'sem write_file liberado não escreve');
  assert.equal(codeia.decidirEscrita('como criar arquivo a.js com express', W, ctx), null, 'pergunta não vira escrita');
});

test('criar arquivo no loop do agente: chama write_file e confirma com aviso', async () => {
  const cwd = process.cwd();
  const nome = `gc-teste-${process.pid}.js`;
  const T = [{ name: 'write_file' }];
  const h = H(`crie ${nome} com servidor express`);
  const r1 = await codeia.chatWithTools({ history: h, tools: T });
  assert.equal(r1.functionCalls()[0].name, 'write_file');
  assert.ok(!fs.existsSync(path.join(cwd, nome)), 'quem escreve é a ferramenta do agente, não o provedor');
  const h2 = [...h, { role: 'model', parts: r1.rawParts() }, { role: 'user', parts: [{ functionResponse: { name: 'write_file', response: { result: `Arquivo salvo: ${nome}` } } }] }];
  assert.match((await codeia.chatWithTools({ history: h2, tools: T })).text(), /Arquivo salvo[\s\S]*Confira o conteúdo/);
});

test('ensinar rápido (/ensinar): aprende, substitui a mesma pergunta, protege a estrutura e esquece com forget', () => {
  install.esquecer();
  const r1 = install.anotar('Como chamar o dono do bot', 'Use o comando !dono no grupo.');
  assert.equal(r1.substituiu, false);
  assert.match(codeia.responder(install.obterModelo(), 'como chamar o dono do bot'), /!dono/);
  const r2 = install.anotar('como chamar o DONO do bot?', 'Agora é !admin.\n# isso não pode virar título');
  assert.equal(r2.substituiu, false, 'o "?" muda a pergunta; só título igual substitui');
  const r3 = install.anotar('Como chamar o dono do bot', 'Agora é o comando !admin.');
  assert.equal(r3.substituiu, true);
  const resp = codeia.responder(install.obterModelo(), 'como chamar o dono do bot');
  assert.match(resp, /!admin/);
  assert.doesNotMatch(resp, /!dono no grupo/);
  assert.throws(() => install.anotar('x', 'y'), /Use: pergunta :: resposta/);
  install.esquecer();
  assert.doesNotMatch(codeia.responder(install.obterModelo(), 'como chamar o dono do bot'), /!admin/);
});

test('início rápido: sem mudança nos arquivos, o corpus nem é lido de novo; mudou, reconstrói', () => {
  install.esquecer();
  const sig1 = install.assinatura();
  assert.equal(install.ensureInstalled().acao, 'ok');
  assert.equal(install.assinatura(), sig1);
  const m = JSON.parse(fs.readFileSync(install.modelPath(), 'utf8'));
  assert.equal(m.sig, sig1);
  assert.equal(m.codigos, undefined, 'código não é duplicado em disco');
  fs.mkdirSync(install.learnDir(), { recursive: true });
  fs.writeFileSync(path.join(install.learnDir(), 'novo.md'), '# Algo novo para testar\nTexto de teste do início rápido.\n');
  assert.notEqual(install.assinatura(), sig1);
  assert.equal(install.ensureInstalled().acao, 'atualizado');
  install.esquecer();
});
