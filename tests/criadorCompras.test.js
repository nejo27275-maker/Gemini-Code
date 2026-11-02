'use strict';
// v0.46.0: criar site/app (PWA) + servidor local, lista de compras do mês (e a ponte para o iFood), skills com
// descrição em bloco YAML.
const fs = require('fs');
const os = require('os');
const path = require('path');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-criador-'));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
const PROJ = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-criador-proj-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const criador = require('../src/criador');
const compras = require('../src/compras');
const comprasCmd = require('../src/comprasCommands');
const comprasTools = require('../src/tools/comprasTools');
const tools = require('../src/tools');

test.after(() => { for (const d of [HOME, PROJ]) fs.rmSync(d, { recursive: true, force: true }); });

test('criar site e app: arquivos, títulos escapados, manifest válido; pasta cheia e nome ruim são recusados', () => {
  const s = criador.criar({ tipo: 'site', nome: 'padaria', titulo: 'Padaria <do> "Zé"', cwd: PROJ });
  assert.deepEqual(s.arquivos.sort(), ['README.md', 'index.html', 'script.js', 'style.css']);
  const html = fs.readFileSync(path.join(s.pasta, 'index.html'), 'utf8');
  assert.match(html, /<title>Padaria &lt;do&gt; &quot;Zé&quot;<\/title>/);
  assert.ok(!html.includes('<do>'));
  const a = criador.criar({ tipo: 'app', nome: 'gastos', titulo: 'Meus Gastos', cwd: PROJ });
  assert.deepEqual(a.arquivos.sort(), ['README.md', 'app.js', 'icon.svg', 'index.html', 'manifest.webmanifest', 'style.css', 'sw.js']);
  const manifest = JSON.parse(fs.readFileSync(path.join(a.pasta, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.match(fs.readFileSync(path.join(a.pasta, 'app.js'), 'utf8'), /textContent = item\.texto/, 'texto do usuário nunca vira HTML');
  assert.throws(() => criador.criar({ tipo: 'site', nome: 'padaria', cwd: PROJ }), /já existe/);
  assert.throws(() => criador.criar({ tipo: 'site', nome: '../fora', cwd: PROJ }), /nome da pasta/);
  assert.throws(() => criador.criar({ tipo: 'jogo', nome: 'x', cwd: PROJ }), /"site" ou "app"/);
});

test('servidor local: serve a pasta; nunca fora dela (.., %2e%2e, link), nem arquivos com ponto; endereço ruim = 400', async () => {
  const pasta = path.join(PROJ, 'padaria');
  fs.writeFileSync(path.join(pasta, '.env'), 'SEGREDO=1');
  fs.symlinkSync('/etc', path.join(pasta, 'link-para-fora'));
  const srv = criador.servidor(pasta);
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const r = await fetch(`${base}/`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
    for (const p of ['/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/.env', '/link-para-fora/passwd', '/nao-existe.html']) {
      assert.equal((await fetch(`${base}${p}`)).status, 404, p);
    }
    assert.equal((await fetch(`${base}/`, { method: 'POST' })).status, 405);
    const bruto = await new Promise((ok) => {
      const s = require('net').connect(srv.address().port, '127.0.0.1', () => s.write('GET /%E0%A4%A HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'));
      let d = ''; s.on('data', (x) => { d += x; }); s.on('end', () => ok(d));
    });
    assert.match(bruto, /^HTTP\/1\.1 400/);
    assert.equal((await fetch(`${base}/style.css`)).status, 200, 'segue no ar');
  } finally { srv.close(); }
});

test('compras: seção pelo nome (com acento), frequência, preços, orçamento e o texto para colar', () => {
  const store = compras.createComprasStore({ arquivo: path.join(HOME, 'c1.json') });
  assert.equal(compras.secaoDe('Maçã fuji'), 'hortifrúti');
  assert.equal(compras.secaoDe('Feijão carioca 1kg'), 'mercearia');
  assert.equal(compras.secaoDe('Papel higiênico'), 'higiene');
  assert.equal(compras.secaoDe('Pilha AA'), 'outros');
  store.adicionar('arroz 5kg', { quantidade: 2, preco: '27,90' });
  store.adicionar('maçã', { quantidade: 6, frequencia: 'semanal' });
  store.adicionar('café 500g', { quantidade: 1, frequencia: 'quinzenal', preco: 'R$ 1.234,50' });
  assert.throws(() => store.adicionar('arroz 5kg'), /já está na lista/);
  assert.throws(() => store.adicionar('x', { frequencia: 'anual' }), /Frequência inválida/);
  assert.throws(() => store.preco('arroz', '-3'), /Valor inválido/);
  store.preco('maca', '1,20', { onde: 'feira' });
  store.orcamento('300');
  const mes = compras.listaDoMes(store);
  assert.equal(mes.porSecao['hortifrúti'][0].qtdMes, 24);
  assert.equal(mes.total, 55.8 + 24 * 1.2 + 2 * 1234.5);
  const texto = compras.textoDaLista(mes);
  assert.match(texto, /\*Mercearia\*\n- 2x arroz 5kg \(~R\$ 55,80\)/);
  assert.match(texto, /PASSA R\$ /);
  assert.equal(fs.statSync(store.caminho).mode & 0o777, 0o600);
});

test('compras ifood: copia a lista (sem preços), abre o iFood e diz que o pagamento é no app', async () => {
  const store = compras.createComprasStore({ arquivo: path.join(HOME, 'c2.json') });
  store.adicionar('leite', { quantidade: 12, preco: '4,79' });
  const feito = {};
  const r = await comprasCmd.executar(['ifood'], { store, abrir: { copiar: async (t) => { feito.copiado = t; return true; }, abrir: async (u) => { feito.aberto = u; return true; } } });
  assert.equal(r.codigo, 0);
  assert.match(feito.copiado, /- 12x leite$/m);
  assert.ok(!feito.copiado.includes('R$'), 'sem preços na lista copiada');
  assert.equal(feito.aberto, 'https://www.ifood.com.br/');
  assert.match(r.linhas.map((l) => l.texto).join('\n'), /pagamento você confirma no app do iFood/);
  const vazia = await comprasCmd.executar(['ifood'], { store: compras.createComprasStore({ arquivo: path.join(HOME, 'c3.json') }) });
  assert.equal(vazia.codigo, 1);
});

test('ferramenta compras: só com a lista do aliado (sob demanda); mexe só na lista local', async () => {
  comprasTools._testar({ store: compras.createComprasStore({ arquivo: path.join(HOME, 'c4.json') }) });
  assert.ok(!(await tools.getAllDeclarations(undefined)).some((d) => d.name === 'compras'));
  const lista = ['compras'];
  assert.match(await tools.execute('compras', { acao: 'adicionar', item: 'detergente', quantidade: 3 }, lista), /^Na lista: 3x detergente \(mensal, limpeza\)/);
  assert.match(await tools.execute('compras', { acao: 'mes' }, lista), /Limpeza\*\n- 3x detergente/);
  assert.match(await tools.execute('compras', { acao: 'comprar' }, lista), /precisa de "acao"/);
});

test('skill com descrição em bloco YAML (description: >) é lida inteira', () => {
  const dir = path.join(require('../src/config').SKILLS_DIR, 'x');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: x\ndescription: >\n  Primeira linha\n  segunda linha.\nversion: 1\n---\ncorpo');
  const s = require('../src/skills/loader').listSkills().find((k) => k.name === 'x');
  assert.equal(s.description, 'Primeira linha segunda linha.');
  const repo = require('../src/skills/loader').listSkills([path.join(__dirname, '..', 'skills')]);
  for (const k of repo) assert.ok(k.description.length > 20 && !/^[>|]$/.test(k.description), k.name);
});
