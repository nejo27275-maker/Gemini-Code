'use strict';
// v0.50.0: editar como um profissional — o motor de edição (src/tools/edicao.js), o registro do que o agente leu
// (src/tools/leituras.js), a conferência de sintaxe depois de editar (src/tools/sintaxe.js) e o que isso muda no
// edit_file, no edit_files e no write_file. HOME falso ANTES de qualquer require de src/ (backups vão para lá).
const fs = require('fs');
const os = require('os');
const path = require('path');
const HOME_FALSO = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-edicao-pro-'));
process.env.HOME = HOME_FALSO;
process.env.USERPROFILE = HOME_FALSO;

const test = require('node:test');
const assert = require('node:assert/strict');
const { aplicarUmaEdicao, resumoDiff } = require('../src/tools/edicao');
const fileTools = require('../src/tools/fileTools');
const multi = require('../src/tools/multiEditTools');
const sintaxe = require('../src/tools/sintaxe');
const sandbox = require('../src/sandbox');

test.after(() => fs.rmSync(HOME_FALSO, { recursive: true, force: true }));

const projeto = () => fs.mkdtempSync(path.join(HOME_FALSO, 'projeto-'));
const criar = (dir, nome, conteudo) => {
  const p = path.join(dir, nome);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, conteudo);
  return p;
};
const ler = (p) => fs.readFileSync(p, 'utf8');
const editar = (args) => fileTools.execute('edit_file', args);
const gravar = (args) => fileTools.execute('write_file', args);
const temPython = Boolean(sandbox.acharProgramaConfiavel('python3', { locais: sintaxe.LOCAIS.python3 }));
const temBash = Boolean(sandbox.acharProgramaConfiavel('bash', { locais: sintaxe.LOCAIS.bash }));
const pularUnix = process.platform === 'win32' ? 'sem python3/bash do sistema no Windows' : false;

// ---------------------------------------------------------------------------
// O motor (puro)
// ---------------------------------------------------------------------------
test('motor: acha o trecho quando a diferença é só espaço no fim das linhas (um lugar só) e não mexe no resto', () => {
  const texto = 'a = 1   \nb = 2\t\nc = 3\n';
  const r = aplicarUmaEdicao(texto, { old_text: 'a = 1\nb = 2\n', new_text: 'a = 10\nb = 20\n' });
  assert.equal(r.ok, true);
  assert.equal(r.texto, 'a = 10\nb = 20\nc = 3\n');
  assert.match(r.ajuste, /espaços no fim das linhas/);
  const amb = aplicarUmaEdicao('x  \ny\nx\ny\n', { old_text: 'x\ny', new_text: 'z' });
  assert.equal(amb.ok, true, 'o exato (sem espaço) ganha: só um lugar casa exatamente');
  assert.equal(amb.texto, 'x  \ny\nz\n');
  const duas = aplicarUmaEdicao('x  \ny\nx \ny\n', { old_text: 'x\ny', new_text: 'z' });
  assert.equal(duas.ok, false);
  assert.match(duas.erro, /aparece 2 vezes \(sem contar os espaços/);
});

test('motor (v0.50.1): o trecho que começa ou termina com o espaço do fim de uma linha leva esse espaço junto', () => {
  // antes, sobrava o "\t" do arquivo colado no texto novo ("a\t X")
  assert.equal(aplicarUmaEdicao('a\t\nfoo\n', { old_text: ' \t\nfoo', new_text: ' X\nbar' }).texto, 'a X\nbar\n');
  assert.equal(aplicarUmaEdicao('foo\t\nbar', { old_text: 'foo  ', new_text: 'X' }).texto, 'X\nbar');
});

test('motor: estresse com 3.000 edições sorteadas — a troca exata é a ingênua e nada muda fora do trecho trocado', () => {
  let semente = 5;
  const r = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648; };
  const escolhe = (l) => l[Math.floor(r() * l.length)];
  const PEDACOS = ['a', 'foo', '{', '}', ';', ' ', '\t', 'x = 1', 'ç'];
  const texto = () => {
    const nl = r() < 0.3 ? '\r\n' : '\n';
    return Array.from({ length: 1 + Math.floor(r() * 8) }, () => Array.from({ length: Math.floor(r() * 4) }, () => escolhe(PEDACOS)).join('') + (r() < 0.3 ? escolhe([' ', '\t']) : '')).join(nl) + nl;
  };
  const N2 = (s) => s.replace(/[ \t]+(?=\r?\n|$)/g, '');
  for (let caso = 0; caso < 3000; caso++) {
    const t = texto();
    const i = Math.floor(r() * t.length);
    let antigo = t.slice(i, i + 1 + Math.floor(r() * 15));
    if (r() < 0.3) antigo = N2(antigo);
    if (!antigo) continue;
    const novo = texto().slice(0, 10);
    const res = aplicarUmaEdicao(t, { old_text: antigo, new_text: novo });
    if (!res.ok) continue;
    if (!res.ajuste) {
      assert.equal(res.texto, t.slice(0, t.indexOf(antigo)) + novo + t.slice(t.indexOf(antigo) + antigo.length), JSON.stringify({ t, antigo, novo }));
      continue;
    }
    // res = t[0:de] + X + t[ate:], com o trecho trocado igual ao old_text sem contar os espaços nos fins de linha
    const Xs = [novo, novo.replace(/\r?\n/g, '\r\n'), novo.replace(/\r\n/g, '\n')];
    const As = [antigo, antigo.replace(/\r?\n/g, '\r\n'), antigo.replace(/\r\n/g, '\n')].map(N2);
    let L = 0;
    while (L < t.length && t[L] === res.texto[L]) L++;
    let achou = false;
    for (let de = 0; de <= L && !achou; de++) {
      for (const X of Xs) {
        const ate = t.length - (res.texto.length - de - X.length);
        if (res.texto.slice(de, de + X.length) === X && ate >= de && t.slice(ate) === res.texto.slice(de + X.length) && As.includes(N2(t.slice(de, ate)))) { achou = true; break; }
      }
    }
    assert.ok(achou, JSON.stringify({ t, antigo, novo, saiu: res.texto }));
  }
});

test('motor: mantém o fim de linha do arquivo (CRLF com trecho em LF e o contrário)', () => {
  const crlf = aplicarUmaEdicao('um\r\ndois\r\ntrês\r\n', { old_text: 'um\ndois', new_text: 'UM\nDOIS' });
  assert.equal(crlf.texto, 'UM\r\nDOIS\r\ntrês\r\n');
  assert.match(crlf.ajuste, /CRLF/);
  const lf = aplicarUmaEdicao('um\ndois\n', { old_text: 'um\r\ndois', new_text: 'UM\r\nDOIS' });
  assert.equal(lf.texto, 'UM\nDOIS\n');
  assert.match(lf.ajuste, /LF/);
});

test('motor: quando não acha, mostra o trecho mais parecido com os números de linha (indentação e erro de digitação)', () => {
  const arq = 'function soma(a, b) {\n    return a - b;\n}\n';
  const ind = aplicarUmaEdicao(arq, { old_text: '\treturn a - b;', new_text: 'x' }); // tab no lugar dos 4 espaços
  assert.equal(ind.ok, false);
  assert.match(ind.erro, /não encontrado/);
  assert.match(ind.dica, /outra indentação/);
  assert.match(ind.dica, /^2\t {4}return a - b;$/m, 'a linha 2 como está no arquivo, com os 4 espaços');
  const parecido = aplicarUmaEdicao(arq, { old_text: 'retorna a - b;', new_text: 'x' });
  assert.match(parecido.dica, /linha parecida \(\d+% igual\)/);
  assert.match(parecido.dica, /^2\t {4}return a - b;$/m);
  assert.equal(aplicarUmaEdicao(arq, { old_text: 'nada a ver com isso aqui', new_text: 'x' }).dica, null, 'sem nada parecido, sem dica');
});

test('motor: diff com números de linha, trechos separados, corte e fim de linha', () => {
  const antes = Array.from({ length: 30 }, (_, i) => `linha ${i + 1}`).join('\n');
  const depois = antes.replace('linha 5', 'LINHA CINCO').replace('linha 25', 'LINHA 25');
  const d = resumoDiff(antes, depois);
  assert.equal(d.mais, 2);
  assert.equal(d.menos, 2);
  const trechos = d.texto.split('\n').filter((l) => l.startsWith('@@'));
  assert.equal(trechos.length, 2, 'duas mudanças longe uma da outra viram dois trechos');
  assert.match(d.texto, /^@@ -2,7 \+2,7 @@$/m);
  assert.match(d.texto, /^- 5\tlinha 5$/m);
  assert.match(d.texto, /^\+ 5\tLINHA CINCO$/m);
  assert.match(d.texto, /^ {2}8\tlinha 8$/m, '3 linhas de contexto em volta');
  assert.doesNotMatch(d.texto, /linha 15/, 'o meio que não mudou fica de fora');
  assert.equal(resumoDiff('igual', 'igual').texto, '');
  assert.match(resumoDiff('a\r\nb', 'a\nb').texto, /só o fim de linha/);
  const muito = resumoDiff(antes, antes.split('\n').map((l) => `${l}!`).join('\n'), { maxLinhas: 10 });
  assert.match(muito.texto, /\+\d+ linhas de diff; leia o arquivo/);
});

// ---------------------------------------------------------------------------
// edit_file
// ---------------------------------------------------------------------------
test('edit_file: o resultado traz o diff com números de linha; replace_all troca todas', async () => {
  const dir = projeto();
  const p = criar(dir, 'app.js', 'const porta = 3000;\nconsole.log(porta);\n');
  const r = await editar({ path: p, old_text: '3000', new_text: '8080' });
  assert.match(r, /^Editado: .*app\.js \(backup do conteúdo anterior em /);
  assert.match(r, /^-1\tconst porta = 3000;$/m);
  assert.match(r, /^\+1\tconst porta = 8080;$/m);
  const n = criar(dir, 'nomes.js', 'velho(); velho(); velho();\n');
  assert.match(await editar({ path: n, old_text: 'velho', new_text: 'novo' }), /aparece 3 vezes/);
  assert.match(await editar({ path: n, old_text: 'velho', new_text: 'novo', replace_all: true }), /^Editado:/);
  assert.equal(ler(n), 'novo(); novo(); novo();\n');
});

test('edit_file: arquivo em Latin-1 é recusado sem corromper os acentos (antes só o edit_files recusava)', async () => {
  const dir = projeto();
  const p = path.join(dir, 'antigo.txt');
  const latin1 = Buffer.from('ação = 1\nx = 2\n', 'latin1');
  fs.writeFileSync(p, latin1);
  assert.match(await editar({ path: p, old_text: 'x = 2', new_text: 'x = 3' }), /não é UTF-8 válido/);
  assert.ok(fs.readFileSync(p).equals(latin1), 'o arquivo ficou intacto');
});

test('edit_file: avisa quando a edição quebra a sintaxe do JavaScript (e a edição fica, para o modelo corrigir)', async () => {
  const dir = projeto();
  const p = criar(dir, 'soma.js', 'function soma(a, b) {\n  return a + b;\n}\nmodule.exports = soma;\n');
  const r = await editar({ path: p, old_text: '  return a + b;\n}', new_text: '  return a + b;\n' });
  assert.match(r, /^Editado:/);
  assert.match(r, /Atenção: depois desta edição, .*soma\.js ficou com erro de sintaxe \(antes estava certo\): linha \d+: SyntaxError/);
  assert.doesNotMatch(ler(p), /^}$/m, 'a edição foi gravada');
  // arquivo que JÁ estava quebrado: a edição não é culpada, nada de alarme
  const q = criar(dir, 'quebrado.js', 'function x( {\nconst a = 1;\n');
  assert.doesNotMatch(await editar({ path: q, old_text: 'const a = 1;', new_text: 'const a = 2;' }), /Atenção/);
  // ESM: .mjs quebrado avisa; .js com import válido não é alarme falso
  const m = criar(dir, 'mod.mjs', 'export const a = 1;\n');
  assert.match(await editar({ path: m, old_text: 'export const a = 1;', new_text: 'export const a = ;' }), /erro de sintaxe/);
  const e = criar(dir, 'esm.js', 'import fs from "fs";\nexport const a = 1;\n');
  assert.doesNotMatch(await editar({ path: e, old_text: 'a = 1', new_text: 'a = 2' }), /Atenção/);
});

test('edit_file: JSON quebrado avisa; JSON com comentários (tsconfig) não é alarme falso; config desliga', async () => {
  const dir = projeto();
  const p = criar(dir, 'pacote.json', '{\n  "nome": "x",\n  "versao": 1\n}\n');
  assert.match(await editar({ path: p, old_text: '"versao": 1', new_text: '"versao": 1,' }), /erro de sintaxe .*linha 4/s);
  const t = criar(dir, 'tsconfig.json', '{\n  // comentário\n  "strict": true,\n}\n');
  assert.doesNotMatch(await editar({ path: t, old_text: '"strict": true', new_text: '"strict": false' }), /Atenção/);
  assert.equal(await sintaxe.conferirDepoisDeEditar('a.json', '{}', '{', { cfg: { conferirSintaxe: false } }), null);
});

test('edit_file: Python e shell quebrados avisam com o número da linha', { skip: pularUnix }, async (t) => {
  const dir = projeto();
  if (temPython) {
    const p = criar(dir, 'calc.py', 'def soma(a, b):\n    return a + b\n');
    assert.match(await editar({ path: p, old_text: 'def soma(a, b):', new_text: 'def soma(a, b)' }), /erro de sintaxe .*linha 1: SyntaxError/s);
  } else t.diagnostic('sem python3 do sistema: parte do Python pulada');
  if (temBash) {
    const s = criar(dir, 'instala.sh', 'if true; then\n  echo oi\nfi\n');
    assert.match(await editar({ path: s, old_text: 'fi\n', new_text: '\n' }), /erro de sintaxe .*linha \d+/s);
  } else t.diagnostic('sem bash do sistema: parte do shell pulada');
});

test('conferidor: um "python3"/"bash" plantado numa área do modelo nunca roda (só o do sistema)', { skip: pularUnix || (!temPython && 'sem python3 do sistema') }, async () => {
  const dir = projeto(); // dentro da pasta temporária: área que o modelo grava
  const bin = path.join(dir, 'bin');
  const marca = path.join(dir, 'RODOU');
  for (const nome of ['python3', 'bash']) criar(dir, path.join('bin', nome), `#!/bin/sh\necho x > "${marca}"\nexit 1\n`);
  fs.chmodSync(path.join(bin, 'python3'), 0o755);
  fs.chmodSync(path.join(bin, 'bash'), 0o755);
  const antes = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${antes}`;
  try {
    const falso = fs.realpathSync(path.join(bin, 'python3'));
    assert.equal(sandbox.acharProgramaConfiavel('python3', { locais: [], proibidas: [] }), falso, 'sem a trava, o PATH acharia o plantado');
    assert.notEqual(sandbox.acharProgramaConfiavel('python3', { locais: [], proibidas: sandbox.areasDoModelo() }), falso, 'com a trava, nunca');
    const r = await sintaxe.checar('python', 'x = (\n', {});
    assert.equal(r && r.ok, false, 'conferiu com o python3 do sistema');
    await sintaxe.checar('shell', 'if true; then\n', {});
  } finally { process.env.PATH = antes; }
  assert.equal(fs.existsSync(marca), false, 'o programa plantado não rodou');
});

// ---------------------------------------------------------------------------
// write_file
// ---------------------------------------------------------------------------
test('write_file: não sobrescreve um arquivo que o agente não leu; depois de ler, grava e mostra o que mudou', async () => {
  const dir = projeto();
  const p = criar(dir, 'notas.txt', 'um\ndois\ntrês\n');
  const recusa = await gravar({ path: p, content: 'outro\n' });
  assert.match(recusa, /já existe \(3 linhas\) e você não leu este arquivo nesta sessão/);
  assert.equal(ler(p), 'um\ndois\ntrês\n', 'nada foi gravado');
  await fileTools.execute('read_file', { path: p });
  const r = await gravar({ path: p, content: 'um\nDOIS\ntrês\n' });
  assert.match(r, /^Arquivo salvo: .*notas\.txt \(substituiu o conteúdo anterior: \+1 -1 linhas; backup do conteúdo anterior em /);
  assert.match(r, /^-2\tdois$/m);
  assert.match(r, /^\+2\tDOIS$/m);
  // o que o próprio agente gravou ele conhece: pode gravar de novo sem ler
  assert.match(await gravar({ path: p, content: 'final\n' }), /^Arquivo salvo:/);
});

test('write_file: recusa se o arquivo mudou no disco depois da leitura; conteúdo igual não grava nada', async () => {
  const dir = projeto();
  const p = criar(dir, 'config.ini', 'a=1\n');
  await fileTools.execute('read_file', { path: p });
  fs.writeFileSync(p, 'a=1\nb=2 (a pessoa mexeu)\n');
  assert.match(await gravar({ path: p, content: 'a=9\n' }), /mudou no disco depois da última vez que você o leu/);
  assert.equal(ler(p), 'a=1\nb=2 (a pessoa mexeu)\n');
  assert.match(await gravar({ path: p, content: 'a=1\nb=2 (a pessoa mexeu)\n' }), /^Sem mudança:/, 'igual ao que está lá: sem erro e sem gravar');
});

test('write_file: arquivo novo diz quantas linhas; arquivo vazio que existe pode ser escrito sem ler', async () => {
  const dir = projeto();
  assert.match(await gravar({ path: path.join(dir, 'novo', 'a.md'), content: '# Título\n\ntexto\n' }), /^Arquivo salvo: .*a\.md \(arquivo novo, 3 linhas\)$/);
  const vazio = criar(dir, 'vazio.txt', '');
  assert.match(await gravar({ path: vazio, content: 'agora tem\n' }), /^Arquivo salvo:/);
});

test('write_file: mantém o CRLF e o BOM do arquivo que sobrescreve', async () => {
  const dir = projeto();
  const p = criar(dir, 'win.txt', '\uFEFFlinha 1\r\nlinha 2\r\n');
  await fileTools.execute('read_file', { path: p });
  const r = await gravar({ path: p, content: 'linha 1\nlinha DOIS\n' });
  assert.match(r, /CRLF \(Windows\) do arquivo foi mantido/);
  assert.match(r, /BOM do início do arquivo foi mantido/);
  assert.equal(ler(p), '\uFEFFlinha 1\r\nlinha DOIS\r\n');
});

test('write_file: arquivo novo de código com erro de sintaxe já avisa', async () => {
  const dir = projeto();
  assert.match(await gravar({ path: path.join(dir, 'novo.js'), content: 'const x = {\n' }), /Atenção: o arquivo novo .*novo\.js tem erro de sintaxe/);
  assert.doesNotMatch(await gravar({ path: path.join(dir, 'ok.js'), content: 'const x = {};\n' }), /Atenção/);
});

test('write_file: não sobrescreve (nem carrega na memória) um arquivo maior que o limite de leitura', async () => {
  const dir = projeto();
  const p = path.join(dir, 'enorme.log');
  fs.writeFileSync(p, '');
  fs.truncateSync(p, 50 * 1024 * 1024 + 1); // esparso: não ocupa o disco
  assert.match(await gravar({ path: p, content: 'x' }), /não sobrescreve um arquivo desse tamanho/);
  assert.equal(fs.statSync(p).size, 50 * 1024 * 1024 + 1);
});

// ---------------------------------------------------------------------------
// edit_files
// ---------------------------------------------------------------------------
test('edit_files: avisa quando o arquivo mudou no disco desde a última leitura (a troca vale no conteúdo atual)', async () => {
  const dir = projeto();
  const p = criar(dir, 'lista.txt', 'arroz\nfeijão\n');
  await fileTools.execute('read_file', { path: p });
  fs.writeFileSync(p, 'arroz\nfeijão\nmacarrão\n');
  const r = await multi.execute('edit_files', { edits: [{ path: p, old_text: 'feijão', new_text: 'feijão preto' }] });
  assert.match(r, /^Editado:/);
  assert.match(r, /Aviso: este arquivo tinha mudado no disco desde a última vez que você o leu/);
  assert.equal(ler(p), 'arroz\nfeijão preto\nmacarrão\n', 'a mudança de fora continua lá');
  // depois desta edição o agente conhece o conteúdo: a próxima não avisa
  assert.doesNotMatch(await multi.execute('edit_files', { edits: [{ path: p, old_text: 'arroz', new_text: 'arroz integral' }] }), /Aviso:/);
});

test('/passo (v0.50.1): a prévia mostra o diff de verdade, com números de linha; de um segredo, nunca o conteúdo', () => {
  const sa = require('../src/stepApproval');
  const dir = projeto();
  const p = criar(dir, 'conta.js', 'const a = 1;\nconst b = 2;\nconsole.log(a + b);\n');
  const e = sa.previa('edit_file', { path: p, old_text: 'const b = 2;', new_text: 'const b = 3;' });
  assert.match(e, /^edit_file .*conta\.js \(\+1 -1 linhas\)$/m);
  assert.match(e, /^-2\tconst b = 2;$/m);
  assert.match(e, /^\+2\tconst b = 3;$/m);
  assert.match(e, /^ 1\tconst a = 1;$/m, 'com o contexto em volta');
  const w = sa.previa('write_file', { path: p, content: 'const a = 1;\nconst b = 20;\nconsole.log(a * b);\n' });
  assert.match(w, /SOBRESCREVE \(4 → 4 linhas\), \+2 -2/);
  assert.match(w, /^-3\tconsole\.log\(a \+ b\);$/m);
  // trecho que não existe: a prévia antiga (só o texto pedido)
  assert.match(sa.previa('edit_file', { path: p, old_text: 'nao tem', new_text: 'x' }), /- nao tem\n\+ x/);
  // segredo do gemini-code: a prévia nunca lê o arquivo
  const { CONFIG_PATH } = require('../src/config');
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, '{\n  "apiKey": "SEGREDO-DA-PREVIA"\n}\n');
  try {
    assert.doesNotMatch(sa.previa('edit_file', { path: CONFIG_PATH, old_text: '"apiKey"', new_text: '"x"' }), /SEGREDO-DA-PREVIA/);
    assert.doesNotMatch(sa.previa('write_file', { path: CONFIG_PATH, content: '{}' }), /SEGREDO-DA-PREVIA/);
  } finally { fs.rmSync(CONFIG_PATH, { force: true }); }
});

test('instrução do agente: editar como um profissional', () => {
  const { buildSystemInstruction } = require('../src/agent');
  assert.match(buildSystemInstruction('', { cwd: os.tmpdir() }), /Edite como um profissional/);
});
