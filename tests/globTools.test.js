'use strict';
// glob_files (src/tools/globTools.js): acha arquivos por padrão de nome, respeita
// .gitignore, não segue pasta-link e não trava com padrão patológico.
// Cada arquivo de teste roda em processo próprio: trocar o HOME aqui não vaza.
const fs = require('fs');
const os = require('os');
const path = require('path');
const HOME_FALSO = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-glob-'));
process.env.HOME = HOME_FALSO;
process.env.USERPROFILE = HOME_FALSO;

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const config = require('../src/config');
const globTools = require('../src/tools/globTools');
const { MSG_SEGREDO } = require('../src/tools/protectedPaths');

const { globParaRegex, criarFiltroGitignore, LIMITES } = globTools;
const semSymlink = process.platform === 'win32';
// realpath: no macOS /var é link para /private/var e process.cwd() devolve o real.
const projeto = () => fs.realpathSync(fs.mkdtempSync(path.join(HOME_FALSO, 'proj-')));
const glob = (args) => globTools.execute('glob_files', args);

function criar(raiz, rel, conteudo = '', mtimeSeg) {
  const p = path.join(raiz, ...rel.split('/'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, conteudo);
  if (mtimeSeg != null) fs.utimesSync(p, mtimeSeg, mtimeSeg);
  return p;
}

// Linhas de resultado (sem os avisos entre colchetes), relativas à raiz e com '/'.
function achados(saida, raiz) {
  return saida
    .split('\n')
    .filter((l) => l && !l.startsWith('['))
    .map((l) => path.relative(raiz, path.resolve(l)).split(path.sep).join('/'));
}
const ordenado = (lista) => [...lista].sort();

test('declara glob_files no formato do Gemini', () => {
  assert.equal(globTools.declarations.length, 1);
  const d = globTools.declarations[0];
  assert.equal(d.name, 'glob_files');
  assert.equal(typeof d.description, 'string');
  assert.equal(d.parameters.type, 'object');
  assert.deepEqual(d.parameters.required, ['pattern']);
  assert.deepEqual(Object.keys(d.parameters.properties).sort(), ['include_hidden', 'path', 'pattern']);
  assert.equal(d.parameters.properties.include_hidden.type, 'boolean');
  assert.equal(typeof globTools.execute, 'function');
});

test('acha por padrão: src/**/*.js, **/*.test.js e *.md (este só na raiz)', async () => {
  const raiz = projeto();
  for (const f of [
    'src/a.js', 'src/sub/b.js', 'src/sub/deep/c.js', 'src/a.ts', 'src/leia.md', 'lib/x.js',
    'README.md', 'docs/guia.md', 'um.test.js', 'tests/dois.test.js', 'tests/sub/tres.test.js', 'tests/util.js',
  ]) criar(raiz, f);

  assert.deepEqual(ordenado(achados(await glob({ pattern: 'src/**/*.js', path: raiz }), raiz)),
    ['src/a.js', 'src/sub/b.js', 'src/sub/deep/c.js']);
  assert.deepEqual(ordenado(achados(await glob({ pattern: '**/*.test.js', path: raiz }), raiz)),
    ['tests/dois.test.js', 'tests/sub/tres.test.js', 'um.test.js']);
  assert.deepEqual(achados(await glob({ pattern: '*.md', path: raiz }), raiz), ['README.md']);
  assert.deepEqual(achados(await glob({ pattern: './src/*.ts', path: raiz }), raiz), ['src/a.ts']);
});

test('?, [abc], [!abc] e {a,b} (com chaves aninhadas e com barra dentro)', async () => {
  const raiz = projeto();
  for (const f of ['a1.js', 'a22.js', 'b.js', 'c.js', 'd.js', 'src/x.js', 'lib/y.js', 'lib/z/w.js', 'outro/q.js']) criar(raiz, f);

  assert.deepEqual(achados(await glob({ pattern: 'a?.js', path: raiz }), raiz), ['a1.js']);
  assert.deepEqual(ordenado(achados(await glob({ pattern: '[bc].js', path: raiz }), raiz)), ['b.js', 'c.js']);
  assert.deepEqual(achados(await glob({ pattern: '[!bc].js', path: raiz }), raiz), ['d.js']);
  assert.deepEqual(ordenado(achados(await glob({ pattern: '{src,lib}/**/*.js', path: raiz }), raiz)),
    ['lib/y.js', 'lib/z/w.js', 'src/x.js']);
  assert.deepEqual(ordenado(achados(await glob({ pattern: '{src/x,lib/{y,z/w}}.js', path: raiz }), raiz)),
    ['lib/y.js', 'lib/z/w.js', 'src/x.js']);
});

test('globParaRegex: semântica de *, **, ?, classes, chaves e escapes', () => {
  const casos = [
    ['*.js', 'a.js', true], ['*.js', 'dir/a.js', false],
    ['**/*.js', 'a.js', true], ['**/*.js', 'x/y/a.js', true], ['**/*.js', 'a.ts', false],
    ['src/**', 'src/a', true], ['src/**', 'src/a/b', true], ['src/**', 'src', false],
    ['a/**/b', 'a/b', true], ['a/**/b', 'a/x/b', true], ['a/**/b', 'a/x/y/b', true], ['a/**/b', 'a/xb', false],
    // "**" precisa voltar atrás em pastas: o primeiro b* não é o certo.
    ['**/b*/c', 'x/b1/y/b2/c', true],
    ['**/b*/**/c*/d', 'b/c/b/x/c/d', true], ['**/b*/**/c*/d', 'b/c/b/x/c/q/d', false],
    // Regressão achada por fuzzing: '*' não pode casar um segmento vazio depois do fim.
    ['**/x/*', 'a/x', false], ['**/ab*/*', 'a/cac/ab', false], ['**/*ab*/*', 'cbaba', false],
    ['?.js', 'a.js', true], ['?.js', 'ab.js', false], ['a?b', 'a/b', false],
    ['[abc].js', 'b.js', true], ['[abc].js', 'd.js', false], ['[!abc].js', 'd.js', true], ['[!abc].js', 'a.js', false],
    ['[^abc].js', 'a.js', false], ['[a-c]x', 'bx', true], ['[a-c]x', 'dx', false], ['[]]', ']', true],
    ['a[/]b', 'a/b', false], ['[!a]', '/', false], ['[a', '[a', true],
    ['{a,b}.js', 'b.js', true], ['{a,{b,c}}.js', 'c.js', true], ['{x}.js', '{x}.js', true], ['{a,b', '{a,b', true],
    ['{src,lib/x}/*.js', 'lib/x/a.js', true],
    ['\\*.js', '*.js', true], ['\\*.js', 'a.js', false], ['./src/*.js', 'src/a.js', true],
    ['*a*a*a', 'aaa', true], ['*ab*b', 'abb', true], ['*a*b*c', 'xaybzc', true], ['*a*b*c', 'xaybz', false],
    ['*1*0', 'a1b0', true], ['a+b(1).js', 'a+b(1).js', true], ['a.js', 'axjs', false],
    ['**', 'a/b/c', true], ['**/**/x', 'a/x', true], ['a**b', 'axxb', true], ['a**b', 'a/b', false],
    // Ocultos são decisão de quem varre (include_hidden), não do padrão.
    ['*', '.env', true],
  ];
  for (const [padrao, caminho, esperado] of casos) {
    assert.equal(globParaRegex(padrao).test(caminho), esperado, `${padrao}  x  ${caminho}`);
  }
  assert.ok(globParaRegex('*.js') instanceof RegExp);
});

test('globParaRegex recusa padrão inválido ou grande demais', () => {
  assert.throws(() => globParaRegex('[z-a].js'));
  assert.throws(() => globParaRegex('{a,b}'.repeat(9)), /chaves/);
  assert.throws(() => globParaRegex('a'.repeat(1001)), /longo demais/);
  assert.throws(() => globParaRegex(null), TypeError);
});

test('padrão com muitos * contra nome longo termina rápido (sem backtracking catastrófico)', () => {
  // vm com timeout: se um dia voltar a travar, o teste falha em vez de pendurar a suíte.
  const comPrazo = (re, s) => vm.runInNewContext('re.test(s)', { re, s }, { timeout: 2000 });
  const casos = [
    [globParaRegex('*a'.repeat(40) + '*b'), 'a'.repeat(50000)],
    [globParaRegex('**/a/'.repeat(10) + '**/b'), 'a/'.repeat(5000) + 'c'],
    [globParaRegex('**/*a*a*/'.repeat(8) + '**/x*y'), 'aaaa/'.repeat(2000) + 'x' + 'a'.repeat(5000)],
    // 40 alternativas (~900 caracteres, abaixo do limite de 1000).
    [globParaRegex(`{${Array.from({ length: 40 }, (_, i) => '*a'.repeat(10) + i).join(',')}}`), 'a'.repeat(20000)],
  ];
  const inicio = process.hrtime.bigint();
  for (const [re, s] of casos) assert.equal(comPrazo(re, s), false);
  const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
  assert.ok(ms < 2000, `demorou ${ms.toFixed(0)} ms`);
  // E continua casando quando deve.
  assert.equal(comPrazo(globParaRegex('*a'.repeat(40) + '*b'), 'a'.repeat(50000) + 'b'), true);
  assert.equal(comPrazo(globParaRegex('**/a/'.repeat(10) + '**/b'), 'a/'.repeat(5000) + 'b'), true);
});

// Fixture de .gitignore compartilhada pelos testes da ferramenta e do filtro.
function projetoComGitignore() {
  const raiz = projeto();
  criar(raiz, '.gitignore', [
    '# comentário: não é regra',
    '',
    '*.log',
    '!keep.log',
    'build/',
    '/top.txt',
    'docs/*.tmp',
    'temp?.txt',
    '[ab].cache',
    '**/gen/**',
    'logs/',
    '!logs/keep.txt',
    '\\#notas.md',
    'espaco.txt   ',
  ].join('\n'));
  criar(raiz, 'sub/.gitignore', '!b.log\n/local.txt\n');
  criar(raiz, 'crlf/.gitignore', '*.bin\r\n');
  for (const f of [
    'a.log', 'keep.log', 'sub/b.log', 'sub/c.log',
    'build/out.js', 'sub/build/x.js', 'notdir/build',
    'top.txt', 'sub/top.txt',
    'docs/x.tmp', 'docs/deep/y.tmp', 'other/docs/z.tmp',
    'temp1.txt', 'temp12.txt', 'a.cache', 'c.cache',
    'x/gen/y/z.js', 'gen.js', 'logs/keep.txt', '#notas.md', 'espaco.txt',
    'sub/local.txt', 'sub/deeper/local.txt', 'crlf/a.bin', 'crlf/a.txt',
  ]) criar(raiz, f);
  return raiz;
}

test('respeita .gitignore da raiz e aninhados: comentário, negação, só-pasta, ancorado, classes e **', async () => {
  const raiz = projetoComGitignore();
  const r = await glob({ pattern: '**', path: raiz });
  assert.deepEqual(ordenado(achados(r, raiz)), ordenado([
    'keep.log', 'sub/b.log', 'notdir/build', 'sub/top.txt', 'docs/deep/y.tmp', 'other/docs/z.tmp',
    'temp12.txt', 'c.cache', 'gen.js', 'sub/deeper/local.txt', 'crlf/a.txt',
  ]));
});

test('criarFiltroGitignore responde caminho a caminho (para o search_files reaproveitar)', () => {
  const raiz = projetoComGitignore();
  const ignorado = criarFiltroGitignore(raiz);
  const esperados = [
    ['a.log', false, true], ['keep.log', false, false], ['sub/c.log', false, true], ['./sub/b.log', false, false],
    ['build', true, true], ['build', false, false], ['build/out.js', false, true], ['sub/build/x.js', false, true],
    ['top.txt', false, true], ['sub/top.txt', false, false],
    ['logs/keep.txt', false, true], // pasta de cima ignorada: a negação não traz de volta
    ['x/gen/y/z.js', false, true], ['#notas.md', false, true], ['espaco.txt', false, true],
    ['# comentário: não é regra', false, false], ['crlf/a.bin', false, true],
    ['sub/local.txt', false, true], ['sub/deeper/local.txt', false, false],
    ['', false, false], ['../fora.log', false, false], ['sub/../../fora.log', false, false], ['sub/../a.log', false, true],
  ];
  for (const [rel, ehDir, esperado] of esperados) assert.equal(ignorado(rel, ehDir), esperado, `${rel} (pasta: ${ehDir})`);
  assert.equal(ignorado(path.join(raiz, 'a.log')), true, 'aceita caminho absoluto dentro da raiz');
  assert.equal(criarFiltroGitignore(projeto())('qualquer.log'), false, 'sem .gitignore nada é ignorado');
});

test('.gitignore patológico não trava a varredura', async () => {
  const raiz = projeto();
  criar(raiz, '.gitignore', [
    '*a'.repeat(200) + '*b',
    ' '.repeat(20000) + 'x', // longo demais: regra descartada
    'y' + ' '.repeat(20000), // espaços finais em linha comprida
  ].join('\n'));
  const nome = 'a'.repeat(200);
  criar(raiz, nome);
  criar(raiz, 'y');
  const inicio = Date.now();
  const r = await glob({ pattern: '*', path: raiz });
  assert.ok(Date.now() - inicio < 2000, `demorou ${Date.now() - inicio} ms`);
  assert.deepEqual(achados(r, raiz), [nome]);
});

test('.git e node_modules ficam sempre de fora; ocultos só com include_hidden', async () => {
  const raiz = projeto();
  for (const f of ['app.js', '.git/config', '.git/objects/x.js', 'node_modules/pkg/index.js', 'sub/node_modules/y.js',
    '.github/workflows/ci.yml', '.eslintrc.js']) criar(raiz, f);
  criar(raiz, 'sub/.git', 'gitdir: ../.git/worktrees/sub'); // .git como arquivo (worktree)
  criar(raiz, 'sub/z.js');

  assert.deepEqual(ordenado(achados(await glob({ pattern: '**', path: raiz }), raiz)), ['app.js', 'sub/z.js']);
  assert.deepEqual(ordenado(achados(await glob({ pattern: '**', path: raiz, include_hidden: true }), raiz)),
    ['.eslintrc.js', '.github/workflows/ci.yml', 'app.js', 'sub/z.js']);
  assert.deepEqual(ordenado(achados(await glob({ pattern: '**/*.js', path: raiz, include_hidden: true }), raiz)),
    ['.eslintrc.js', 'app.js', 'sub/z.js']);

  const semOcultos = await glob({ pattern: '.github/**', path: raiz });
  assert.match(semOcultos, /^Nenhum arquivo corresponde/);
  assert.match(semOcultos, /include_hidden=true/);
});

test('não entra em pasta que é symlink (evita laço); link para arquivo vale', { skip: semSymlink }, async () => {
  const raiz = projeto();
  criar(raiz, 'src/a.js');
  const fora = projeto();
  criar(fora, 'b.js');
  fs.symlinkSync(raiz, path.join(raiz, 'src', 'laco'));
  fs.symlinkSync(fora, path.join(raiz, 'externo'));
  fs.symlinkSync(path.join(raiz, 'src', 'a.js'), path.join(raiz, 'atalho.js'));
  fs.symlinkSync(path.join(raiz, 'nao-existe.js'), path.join(raiz, 'quebrado.js'));
  assert.deepEqual(ordenado(achados(await glob({ pattern: '**/*.js', path: raiz }), raiz)), ['atalho.js', 'src/a.js']);
});

test('pasta ilegível é pulada sem derrubar a busca', async () => {
  const raiz = projeto();
  criar(raiz, 'ok/a.js');
  criar(raiz, 'trancada/b.js');
  const trancada = path.join(raiz, 'trancada');
  const original = fs.readdirSync;
  fs.readdirSync = function (dir, ...resto) {
    if (path.resolve(String(dir)) === trancada) {
      throw Object.assign(new Error(`EACCES: permission denied, scandir '${dir}'`), { code: 'EACCES' });
    }
    return original.call(this, dir, ...resto);
  };
  try {
    assert.deepEqual(achados(await glob({ pattern: '**/*.js', path: raiz }), raiz), ['ok/a.js']);
  } finally {
    fs.readdirSync = original;
  }
});

const ehRoot = typeof process.getuid === 'function' && process.getuid() === 0;
test('pasta sem permissão de leitura (chmod 000) é pulada', {
  skip: process.platform === 'win32' ? 'sem chmod no Windows' : ehRoot ? 'root lê qualquer pasta' : false,
}, async () => {
  const raiz = projeto();
  criar(raiz, 'ok/a.js');
  criar(raiz, 'trancada/b.js');
  fs.chmodSync(path.join(raiz, 'trancada'), 0o000);
  try {
    assert.deepEqual(achados(await glob({ pattern: '**/*.js', path: raiz }), raiz), ['ok/a.js']);
  } finally {
    fs.chmodSync(path.join(raiz, 'trancada'), 0o755);
  }
});

test('ordena do mais novo para o mais antigo', async () => {
  const raiz = projeto();
  criar(raiz, 'velho.js', '', 1000000000);
  criar(raiz, 'novo.js', '', 1600000000);
  criar(raiz, 'medio.js', '', 1300000000);
  assert.deepEqual(achados(await glob({ pattern: '*.js', path: raiz }), raiz), ['novo.js', 'medio.js', 'velho.js']);
});

test('limite de 300 resultados: mostra os mais recentes e avisa o corte', async () => {
  assert.equal(LIMITES.maxResultados, 300);
  assert.equal(LIMITES.maxVarredura, 50000);
  const raiz = projeto();
  for (let i = 0; i < 305; i++) criar(raiz, `f${String(i).padStart(3, '0')}.txt`, '', 1000000000 + i);
  const r = await glob({ pattern: '*.txt', path: raiz });
  const lista = achados(r, raiz);
  assert.equal(lista.length, 300);
  assert.equal(lista[0], 'f304.txt');
  assert.ok(lista.includes('f005.txt'));
  assert.ok(!lista.includes('f004.txt'), 'os 5 mais antigos ficam de fora');
  assert.match(r, /mostrando os 300 mais recentes de 305 arquivos/);
});

test('para de varrer depois do limite de arquivos e avisa (só quando passa do limite)', async () => {
  const original = LIMITES.maxVarredura;
  LIMITES.maxVarredura = 20;
  try {
    const raiz = projeto();
    for (let i = 0; i < 20; i++) criar(raiz, `d/f${i}.txt`);
    let r = await glob({ pattern: '**/*.txt', path: raiz });
    assert.doesNotMatch(r, /varredura parou/, 'exatamente no limite a varredura está completa');
    assert.equal(achados(r, raiz).length, 20);

    for (let i = 0; i < 30; i++) criar(raiz, `e/g${i}.txt`);
    r = await glob({ pattern: '**/*.txt', path: raiz });
    assert.match(r, /varredura parou depois de 20 arquivos/);
    assert.ok(achados(r, raiz).length <= 20);

    r = await glob({ pattern: '**/*.nada', path: raiz });
    assert.match(r, /^Nenhum arquivo corresponde/);
    assert.match(r, /varredura parou/);
  } finally {
    LIMITES.maxVarredura = original;
  }
});

test('pastas que o padrão não alcança nem são varridas (não gastam o limite)', async () => {
  const original = LIMITES.maxVarredura;
  LIMITES.maxVarredura = 10;
  try {
    const raiz = projeto();
    for (let i = 0; i < 50; i++) criar(raiz, `outros/f${i}.js`);
    for (const f of ['src/a.js', 'src/b/c.js', 'src/b/d.js']) criar(raiz, f);
    const r = await glob({ pattern: 'src/**/*.js', path: raiz });
    assert.doesNotMatch(r, /varredura parou/);
    assert.deepEqual(ordenado(achados(r, raiz)), ['src/a.js', 'src/b/c.js', 'src/b/d.js']);
  } finally {
    LIMITES.maxVarredura = original;
  }
});

test('sem resultado: mensagem clara, com dica de **/ para padrão sem barra', async () => {
  const raiz = projeto();
  criar(raiz, 'src/main.rs');
  const r = await glob({ pattern: '*.rs', path: raiz });
  assert.match(r, /^Nenhum arquivo corresponde a "\*\.rs"/);
  assert.match(r, /"\*\*\/\*\.rs"/);
});

test('caminhos saem relativos ao process.cwd()', async () => {
  const raiz = projeto();
  criar(raiz, 'src/a.js');
  const antes = process.cwd();
  try {
    process.chdir(raiz);
    assert.equal(await glob({ pattern: 'src/*.js' }), path.join('src', 'a.js'));
    process.chdir(path.dirname(raiz));
    assert.equal(await glob({ pattern: 'src/*.js', path: path.basename(raiz) }), path.join(path.basename(raiz), 'src', 'a.js'));
  } finally {
    process.chdir(antes);
  }
});

test('entrada inválida devolve "Erro: ..." sem lançar; nome desconhecido lança', async () => {
  const raiz = projeto();
  const arquivo = criar(raiz, 'a.txt');
  for (const args of [undefined, {}, { pattern: '' }, { pattern: '   ' }, { pattern: 42 }]) {
    assert.match(await glob(args), /^Erro: glob_files precisa de "pattern"/, JSON.stringify(args));
  }
  assert.match(await glob({ pattern: '*', path: 7 }), /^Erro: "path"/);
  assert.match(await glob({ pattern: '*', path: raiz, include_hidden: 'sim' }), /^Erro: "include_hidden"/);
  assert.match(await glob({ pattern: '/etc/*', path: raiz }), /^Erro: "pattern" é relativo/);
  assert.match(await glob({ pattern: '../*.js', path: raiz }), /^Erro: "pattern" não pode subir/);
  assert.match(await glob({ pattern: 'src/../../*.js', path: raiz }), /^Erro: "pattern" não pode subir/);
  assert.match(await glob({ pattern: '*', path: path.join(raiz, 'nao-existe') }), /^Erro: diretório não existe/);
  assert.match(await glob({ pattern: '*', path: arquivo }), /^Erro: ".*" não é um diretório/);
  assert.match(await glob({ pattern: '[z-a].js', path: raiz }), /^Erro: padrão inválido/);
  assert.match(await glob({ pattern: '{a,b}'.repeat(9), path: raiz }), /^Erro: padrão inválido \(chaves/);
  assert.match(await glob({ pattern: 'a'.repeat(1001), path: raiz }), /^Erro: padrão inválido \(padrão longo demais/);
  await assert.rejects(globTools.execute('glob_inexistente', { pattern: '*' }), /desconhecida/);
});

// --- Segurança -------------------------------------------------------------
const SEGREDO = 'AIza-segredo-de-teste-glob';
function gravarConfigFalsa() {
  fs.mkdirSync(config.HOME_DIR, { recursive: true });
  // Linha "segredo.txt" também vale como regra de .gitignore: serve para provar que não foi lida.
  fs.writeFileSync(config.CONFIG_PATH, `segredo.txt\n{"apiKey":"${SEGREDO}"}\n`);
}

test('path apontando para arquivo de segredo devolve MSG_SEGREDO', async () => {
  gravarConfigFalsa();
  assert.equal(await glob({ pattern: '*', path: config.CONFIG_PATH }), MSG_SEGREDO);
});

test('path que é link para o segredo também é recusado', { skip: semSymlink }, async () => {
  gravarConfigFalsa();
  const link = path.join(projeto(), 'cfg');
  fs.symlinkSync(config.CONFIG_PATH, link);
  assert.equal(await glob({ pattern: '*', path: link }), MSG_SEGREDO);
});

test('.gitignore que é symlink para um segredo não é lido', { skip: semSymlink }, async () => {
  gravarConfigFalsa();
  // Controle: com o mesmo conteúdo copiado, segredo.txt seria ignorado.
  const controle = projeto();
  fs.copyFileSync(config.CONFIG_PATH, path.join(controle, '.gitignore'));
  criar(controle, 'segredo.txt');
  criar(controle, 'outro.txt');
  assert.deepEqual(achados(await glob({ pattern: '*.txt', path: controle }), controle), ['outro.txt']);

  const raiz = projeto();
  fs.symlinkSync(config.CONFIG_PATH, path.join(raiz, '.gitignore'));
  criar(raiz, 'segredo.txt');
  criar(raiz, 'outro.txt');
  assert.deepEqual(ordenado(achados(await glob({ pattern: '*.txt', path: raiz }), raiz)), ['outro.txt', 'segredo.txt']);
  assert.equal(criarFiltroGitignore(raiz)('segredo.txt'), false);
});

test('.gitignore que é hard link para um segredo não é lido', async () => {
  gravarConfigFalsa();
  const raiz = projeto();
  fs.linkSync(config.CONFIG_PATH, path.join(raiz, '.gitignore'));
  criar(raiz, 'segredo.txt');
  assert.deepEqual(achados(await glob({ pattern: '*.txt', path: raiz }), raiz), ['segredo.txt']);
});

test('listar ~/.gemini-code mostra só nomes, nunca o conteúdo dos segredos', async () => {
  gravarConfigFalsa();
  const r = await glob({ pattern: '*.json', path: config.HOME_DIR });
  assert.deepEqual(achados(r, config.HOME_DIR), ['config.json']);
  assert.ok(!r.includes(SEGREDO));
});

test('glob_files só lê: não cria nem altera nada no projeto', async () => {
  const raiz = projetoComGitignore();
  const retrato = () => {
    const linhas = [];
    const visitar = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) visitar(p);
        else linhas.push(`${path.relative(raiz, p)} ${fs.statSync(p).mtimeMs} ${fs.statSync(p).size}`);
      }
    };
    visitar(raiz);
    return linhas.sort();
  };
  const antes = retrato();
  await glob({ pattern: '**', path: raiz, include_hidden: true });
  await glob({ pattern: '{a,b}/**/*.log', path: raiz });
  assert.deepEqual(retrato(), antes);
});

// Revisão adversarial da v0.41.0 (comparado com o git e o bash).
test('numa subpasta do repositório, o .gitignore do topo também vale (como no git)', async () => {
  const repo = projeto();
  fs.mkdirSync(path.join(repo, '.git'));
  criar(repo, '.gitignore', 'dist/\n*.log\n');
  for (const f of ['packages/app/src/index.js', 'packages/app/dist/bundle.js', 'packages/app/debug.log']) criar(repo, f, 'x');
  const app = path.join(repo, 'packages', 'app');
  assert.deepEqual(achados(await glob({ pattern: '**/*', path: app }), app), ['src/index.js']);
  // Pasta que o repositório ignora, pedida de propósito: olhar dentro dela é a intenção.
  const dist = path.join(app, 'dist');
  assert.deepEqual(achados(await glob({ pattern: '**/*', path: dist }), dist), ['bundle.js']);
});

test('.gitignore salvo com BOM (Bloco de Notas) não perde a primeira regra', async () => {
  const raiz = projeto();
  criar(raiz, '.gitignore', '﻿dist/\n');
  criar(raiz, 'a.js');
  criar(raiz, 'dist/b.js');
  assert.deepEqual(achados(await glob({ pattern: '**/*.js', path: raiz }), raiz), ['a.js']);
});

test('classe negada com "-" no começo ([!-9]) é literal, como no bash e no git', async () => {
  const raiz = projeto();
  for (const n of ['5.txt', '-a.txt', 'b.txt']) criar(raiz, n);
  assert.deepEqual(ordenado(achados(await glob({ pattern: '[!-9]*.txt', path: raiz }), raiz)), ['5.txt', 'b.txt']);
  const ignora = projeto();
  criar(ignora, '.gitignore', '[!-9]*.txt\n');
  for (const n of ['5.txt', '-a.txt', 'b.txt']) criar(ignora, n);
  assert.deepEqual(achados(await glob({ pattern: '*.txt', path: ignora }), ignora), ['-a.txt']);
});
