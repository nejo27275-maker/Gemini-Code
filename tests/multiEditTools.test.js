'use strict';
// edit_files: várias edições em um ou mais arquivos, atômicas (ou todas ou nada).
// HOME falso ANTES de qualquer require de src/: backups e rewind vão para
// ~/.gemini-code, e os testes de segurança mexem nos arquivos protegidos de lá.
// Cada arquivo de teste roda em processo próprio: trocar o HOME aqui não vaza.
const fs = require('fs');
const os = require('os');
const path = require('path');
const HOME_FALSO = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-multiedit-'));
process.env.HOME = HOME_FALSO;
process.env.USERPROFILE = HOME_FALSO;

const test = require('node:test');
const assert = require('node:assert/strict');
const { HOME_DIR, CONFIG_PATH, MCP_PATH, HOOKS_PATH, COWORK_TOKEN_PATH } = require('../src/config');
const { MSG_SEGREDO } = require('../src/tools/protectedPaths');
const rewind = require('../src/rewind');
const { pastaBackupPara } = require('../src/tools/backup');
const multi = require('../src/tools/multiEditTools');

const { execute, aplicarEdicoes, declarations } = multi;
const semSymlink = process.platform === 'win32';
const projeto = () => fs.mkdtempSync(path.join(HOME_FALSO, 'projeto-'));
const criar = (dir, nome, conteudo) => {
  const p = path.join(dir, nome);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, conteudo);
  return p;
};
const ler = (p) => fs.readFileSync(p, 'utf8');
const editar = (edits) => execute('edit_files', { edits });

test('HOME falso em uso: nada vai para o ~/.gemini-code de verdade', () => {
  assert.ok(HOME_DIR.startsWith(HOME_FALSO), HOME_DIR);
});

test('declaração no formato Gemini', () => {
  assert.equal(declarations.length, 1);
  const d = declarations[0];
  assert.equal(d.name, 'edit_files');
  assert.equal(typeof d.description, 'string');
  assert.equal(d.parameters.type, 'object');
  assert.deepEqual(d.parameters.required, ['edits']);
  assert.equal(d.parameters.properties.edits.type, 'array');
  assert.deepEqual(d.parameters.properties.edits.items.required, ['path', 'old_text', 'new_text']);
});

test('ferramenta desconhecida lança Error', async () => {
  await assert.rejects(() => execute('nao_existe', {}), /desconhecida/);
});

// ---------- aplicarEdicoes (pura) ----------

test('aplicarEdicoes: edições em ordem se somam', () => {
  const r = aplicarEdicoes('a b c', [
    { path: 'x', old_text: 'a', new_text: 'A1' },
    { path: 'x', old_text: 'A1 b', new_text: 'B2' }, // só existe depois da primeira
  ]);
  assert.deepEqual(r, { ok: true, conteudo: 'B2 c' });
});

test('aplicarEdicoes: replace_all troca todas; sem ele, repetido é erro com a contagem', () => {
  assert.deepEqual(aplicarEdicoes('x-x-x', [{ old_text: 'x', new_text: 'y', replace_all: true }]), { ok: true, conteudo: 'y-y-y' });
  const r = aplicarEdicoes('x-x-x', [{ old_text: 'x', new_text: 'y' }]);
  assert.equal(r.ok, false);
  assert.equal(r.indice, 0);
  assert.match(r.erro, /aparece 3 vezes/);
  const r2 = aplicarEdicoes('x', [{ old_text: 'x', new_text: 'y', replace_all: false }, { old_text: 'zzz', new_text: '', replace_all: true }]);
  assert.equal(r2.ok, false);
  assert.equal(r2.indice, 1, 'replace_all também exige pelo menos 1 ocorrência');
  assert.match(r2.erro, /não encontrado/);
  assert.match(r2.erro, /edições anteriores/);
});

test('aplicarEdicoes: new_text com $& e $1 entra literal (sem padrões de String.replace)', () => {
  assert.deepEqual(aplicarEdicoes('preco', [{ old_text: 'preco', new_text: '$& $1 $$' }]), { ok: true, conteudo: '$& $1 $$' });
  assert.deepEqual(aplicarEdicoes('a a', [{ old_text: 'a', new_text: '$&$&', replace_all: true }]), { ok: true, conteudo: '$&$& $&$&' });
});

test('aplicarEdicoes: old_text vazio, new_text ausente e replace_all não booleano são recusados', () => {
  assert.match(aplicarEdicoes('abc', [{ old_text: '', new_text: 'x' }]).erro, /old_text não pode ser vazio/);
  assert.match(aplicarEdicoes('abc', [{ old_text: 'a' }]).erro, /new_text/);
  assert.match(aplicarEdicoes('abc', [{ old_text: 'a', new_text: 'b', replace_all: 'false' }]).erro, /booleano/);
});

test('aplicarEdicoes: arquivo CRLF com old_text multilinha em \\n dá a dica de CRLF', () => {
  const r = aplicarEdicoes('um\r\ndois\r\n', [{ old_text: 'um\ndois', new_text: 'x' }]);
  assert.equal(r.ok, false);
  assert.match(r.erro, /CRLF/);
  assert.deepEqual(aplicarEdicoes('um\r\ndois\r\n', [{ old_text: 'um\r\ndois', new_text: 'x' }]), { ok: true, conteudo: 'x\r\n' });
});

// ---------- execute: caso normal ----------

test('edita dois arquivos (duas edições somadas no mesmo arquivo) e informa backup por arquivo', async () => {
  const dir = projeto();
  const a = criar(dir, 'a.js', 'const nome = "velho";\nfunction velho() {}\n');
  const b = criar(dir, 'sub/b.js', 'velho(); velho();\n');
  const r = await editar([
    { path: a, old_text: 'function velho', new_text: 'function novo' },
    { path: b, old_text: 'velho', new_text: 'novo', replace_all: true },
    { path: a, old_text: '"velho"', new_text: '"novo"' },
  ]);
  assert.equal(ler(a), 'const nome = "novo";\nfunction novo() {}\n');
  assert.equal(ler(b), 'novo(); novo();\n');
  const linhas = r.split('\n');
  assert.equal(linhas.length, 2, r);
  assert.match(linhas[0], new RegExp(`^Editado: ${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(2 edições; backup do conteúdo anterior em `));
  assert.match(linhas[1], /\(1 edição; backup do conteúdo anterior em /);
  const backupA = linhas[0].match(/backup do conteúdo anterior em (.+)\)$/)[1];
  assert.equal(ler(backupA), 'const nome = "velho";\nfunction velho() {}\n');
  assert.ok(backupA.startsWith(path.join(HOME_DIR, 'backups')));
});

test('caminho relativo funciona (resolvido a partir do cwd)', async () => {
  const dir = projeto();
  criar(dir, 'rel.txt', 'oi mundo');
  const antes = process.cwd();
  process.chdir(dir);
  try {
    assert.match(await editar([{ path: 'rel.txt', old_text: 'mundo', new_text: 'Brasil' }]), /^Editado: rel\.txt \(1 edição/);
  } finally { process.chdir(antes); }
  assert.equal(ler(path.join(dir, 'rel.txt')), 'oi Brasil');
});

test('edições que não mudam nada não gravam nem criam backup', async () => {
  const dir = projeto();
  const p = criar(dir, 'igual.txt', 'abc');
  const mtime = fs.statSync(p).mtimeMs;
  const r = await editar([{ path: p, old_text: 'b', new_text: 'X' }, { path: p, old_text: 'X', new_text: 'b' }]);
  assert.match(r, /^Sem mudança: .*igual\.txt \(2 edições/);
  assert.equal(ler(p), 'abc');
  assert.equal(fs.statSync(p).mtimeMs, mtime);
});

// ---------- atomicidade ----------

test('se QUALQUER edição falha, nada é gravado e o erro diz índice e arquivo', async () => {
  const dir = projeto();
  const a = criar(dir, 'a.txt', 'alfa\n');
  const b = criar(dir, 'b.txt', 'beta beta\n');
  const r = await editar([
    { path: a, old_text: 'alfa', new_text: 'ALFA' },
    { path: a, old_text: 'ALFA', new_text: 'ALFA2' },
    { path: b, old_text: 'beta', new_text: 'BETA' }, // aparece 2 vezes
  ]);
  assert.match(r, /^Erro: edição 3 de 3 \(.*b\.txt\): old_text aparece 2 vezes/);
  assert.match(r, /Nada foi gravado/);
  assert.equal(ler(a), 'alfa\n');
  assert.equal(ler(b), 'beta beta\n');
  assert.equal(fs.existsSync(pastaBackupPara(fs.realpathSync(a))), false, 'nem backup deve ter sido criado');
});

test('com falhas em dois arquivos, aponta a edição que vem primeiro na lista', async () => {
  const dir = projeto();
  const a = criar(dir, 'a.txt', 'a');
  const b = criar(dir, 'b.txt', 'b');
  const r = await editar([
    { path: a, old_text: 'a', new_text: 'A' },
    { path: b, old_text: 'nao tem', new_text: 'x' },
    { path: a, old_text: 'tambem nao', new_text: 'x' },
  ]);
  assert.match(r, /^Erro: edição 2 de 3 \(.*b\.txt\): old_text não encontrado/);
  assert.equal(ler(a), 'a');
});

test('falha de gravação no meio restaura os arquivos já gravados', async () => {
  const dir = projeto();
  const a = criar(dir, 'a.txt', 'um');
  const b = criar(dir, 'b.txt', 'dois');
  const original = fs.writeFileSync;
  const bReal = fs.realpathSync(b);
  fs.writeFileSync = function (p, ...resto) {
    if (p === bReal) { const e = new Error('disco cheio'); e.code = 'ENOSPC'; throw e; }
    return original.call(this, p, ...resto);
  };
  let r;
  try {
    r = await editar([{ path: a, old_text: 'um', new_text: 'UM' }, { path: b, old_text: 'dois', new_text: 'DOIS' }]);
  } finally { fs.writeFileSync = original; }
  assert.match(r, /^Erro: falha ao gravar .*b\.txt \(ENOSPC\)/);
  assert.match(r, /voltaram ao conteúdo original/);
  assert.doesNotMatch(r, /ATENÇÃO/);
  assert.equal(ler(a), 'um', 'o arquivo já gravado precisa voltar ao original');
  assert.equal(ler(b), 'dois');
});

test('se a restauração também falhar, avisa e aponta o backup', async () => {
  const dir = projeto();
  const a = criar(dir, 'a.txt', 'um');
  const b = criar(dir, 'b.txt', 'dois');
  const original = fs.writeFileSync;
  const aReal = fs.realpathSync(a);
  const bReal = fs.realpathSync(b);
  let gravouA = false;
  fs.writeFileSync = function (p, ...resto) {
    if (p === bReal) throw Object.assign(new Error('falhou'), { code: 'EIO' });
    if (p === aReal && gravouA) throw Object.assign(new Error('falhou'), { code: 'EIO' }); // a restauração
    if (p === aReal) gravouA = true;
    return original.call(this, p, ...resto);
  };
  let r;
  try {
    r = await editar([{ path: a, old_text: 'um', new_text: 'UM' }, { path: b, old_text: 'dois', new_text: 'DOIS' }]);
  } finally { fs.writeFileSync = original; }
  const m = r.match(/ATENÇÃO: não deu para restaurar .*a\.txt — o conteúdo anterior está em (.+)\.$/m);
  assert.ok(m, r);
  assert.equal(ler(m[1]), 'um');
  assert.equal(ler(b), 'dois');
});

test('integra com o /rewind: o turno desfaz a edição múltipla', async () => {
  rewind.definirPasta(fs.mkdtempSync(path.join(HOME_FALSO, 'rewind-')));
  const dir = projeto();
  const a = criar(dir, 'a.txt', 'antes A');
  const b = criar(dir, 'b.txt', 'antes B');
  rewind.iniciarTurno('teste', { cwd: dir });
  assert.match(await editar([{ path: a, old_text: 'antes', new_text: 'depois' }, { path: b, old_text: 'antes', new_text: 'depois' }]), /^Editado/);
  assert.ok(rewind.finalizarTurno());
  const d = rewind.desfazer({ cwd: dir });
  assert.equal(d.restaurados.length, 2, JSON.stringify(d));
  assert.equal(ler(a), 'antes A');
  assert.equal(ler(b), 'antes B');
});

// ---------- entrada inválida e limites ----------

test('entrada inválida devolve "Erro:" sem lançar', async () => {
  const dir = projeto();
  const p = criar(dir, 'x.txt', 'abc');
  const casos = [
    [undefined, /precisa de "edits"/],
    [{}, /precisa de "edits"/],
    [{ edits: 'abc' }, /precisa de "edits"/],
    [{ edits: [] }, /precisa de "edits"/],
    [{ edits: [null] }, /edição 1 de 1: cada edição precisa ser um objeto/],
    [{ edits: [{ old_text: 'a', new_text: 'b' }] }, /edição 1 de 1: falta "path"/],
    [{ edits: [{ path: p, old_text: 'a', new_text: 'A' }, { path: p, old_text: '', new_text: 'b' }] }, /edição 2 de 2 \(.*x\.txt\): old_text não pode ser vazio/],
    [{ edits: [{ path: p, old_text: 'a' }] }, /new_text/],
    [{ edits: [{ path: p, old_text: 'a', new_text: 'b', replace_all: 'true' }] }, /booleano/],
    [{ edits: [{ path: p, old_text: 'zzz', new_text: 'b' }] }, /não encontrado \(0 ocorrências/],
    [{ edits: [{ path: `${p}\0x`, old_text: 'a', new_text: 'b' }] }, /^Erro: edição 1 de 1/],
  ];
  for (const [args, re] of casos) {
    const r = await execute('edit_files', args);
    assert.match(r, /^Erro: /, JSON.stringify(args));
    assert.match(r, re, JSON.stringify(args));
  }
  assert.equal(ler(p), 'abc', 'a edição válida antes da inválida não pode ter sido gravada');
});

test('arquivo inexistente, diretório, binário e não-UTF-8 são recusados', async () => {
  const dir = projeto();
  const ok = criar(dir, 'ok.txt', 'ok');
  const bin = criar(dir, 'img.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x61]));
  const latin1 = criar(dir, 'latin1.txt', Buffer.from('ação = 1', 'latin1'));
  const casos = [
    [path.join(dir, 'nao-existe.txt'), /não existe/],
    [dir, /é um diretório/],
    [bin, /binário/],
    [latin1, /não é UTF-8 válido/],
  ];
  for (const [p, re] of casos) {
    const r = await editar([{ path: ok, old_text: 'ok', new_text: 'OK' }, { path: p, old_text: 'a', new_text: 'b' }]);
    assert.match(r, /^Erro: edição 2 de 2/, p);
    assert.match(r, re, p);
  }
  assert.equal(ler(ok), 'ok');
  assert.deepEqual(fs.readFileSync(latin1), Buffer.from('ação = 1', 'latin1'));
});

test('arquivo maior que o limite é recusado sem ser lido', async () => {
  const dir = projeto();
  const p = path.join(dir, 'grande.txt');
  fs.writeFileSync(p, '');
  fs.truncateSync(p, multi.MAX_BYTES_ARQUIVO + 1);
  assert.match(await editar([{ path: p, old_text: 'a', new_text: 'b' }]), /^Erro: edição 1 de 1 .*limite do edit_files/);
});

test(`limite de ${multi.MAX_EDICOES} edições por chamada`, async () => {
  const dir = projeto();
  const n = multi.MAX_EDICOES;
  const p = criar(dir, 'muitas.txt', Array.from({ length: n + 1 }, (_, i) => `L${i};`).join(''));
  const edicoes = Array.from({ length: n }, (_, i) => ({ path: p, old_text: `L${i};`, new_text: `M${i};` }));
  assert.match(await editar(edicoes), /^Editado: .*muitas\.txt \(50 edições/);
  const demais = [...edicoes, { path: p, old_text: `L${n};`, new_text: 'x' }];
  assert.match(await editar(demais), new RegExp(`^Erro: .*no máximo ${n} edições .*recebeu ${n + 1}`));
});

test(`limite de ${multi.MAX_ARQUIVOS} arquivos distintos por chamada`, async () => {
  const dir = projeto();
  const n = multi.MAX_ARQUIVOS;
  const arquivos = Array.from({ length: n + 1 }, (_, i) => criar(dir, `f${i}.txt`, 'v'));
  const r20 = await editar(arquivos.slice(0, n).map((p) => ({ path: p, old_text: 'v', new_text: 'w' })));
  assert.equal(r20.split('\n').length, n);
  const r21 = await editar(arquivos.map((p) => ({ path: p, old_text: 'w', new_text: 'z' })));
  assert.match(r21, new RegExp(`^Erro: edição ${n + 1} de ${n + 1} \\(.*f${n}\\.txt\\): passa do limite de ${n} arquivos`));
  assert.equal(ler(arquivos[0]), 'w', 'nada da chamada recusada foi gravado');
});

test('o mesmo arquivo por symlink e caminho direto é UM arquivo: as edições se somam', { skip: semSymlink }, async () => {
  const dir = projeto();
  const real = criar(dir, 'real.txt', 'um dois');
  const link = path.join(dir, 'link.txt');
  fs.symlinkSync(real, link);
  const r = await editar([{ path: real, old_text: 'um', new_text: 'UM' }, { path: link, old_text: 'dois', new_text: 'DOIS' }]);
  assert.match(r, /^Editado: .*real\.txt \(2 edições/);
  assert.equal(r.split('\n').length, 1);
  assert.equal(ler(real), 'UM DOIS');
  assert.ok(fs.lstatSync(link).isSymbolicLink(), 'o link continua sendo link');
});

// ---------- segurança ----------

test('arquivo protegido (hooks.json) é bloqueado e nenhum outro arquivo é gravado', async () => {
  fs.mkdirSync(HOME_DIR, { recursive: true });
  fs.writeFileSync(HOOKS_PATH, '{"PreToolUse": []}');
  const dir = projeto();
  const ok = criar(dir, 'ok.txt', 'ok');
  try {
    const r = await editar([
      { path: ok, old_text: 'ok', new_text: 'OK' },
      { path: HOOKS_PATH, old_text: '[]', new_text: '[{"command":"id"}]' },
    ]);
    assert.match(r, /^Bloqueado: edição 2 de 2/);
    assert.equal(ler(HOOKS_PATH), '{"PreToolUse": []}');
    assert.equal(ler(ok), 'ok');
  } finally { fs.rmSync(HOOKS_PATH, { force: true }); }
});

test('segredos (config.json, mcp.json, token) nem são lidos: devolve MSG_SEGREDO', async () => {
  fs.mkdirSync(HOME_DIR, { recursive: true });
  for (const p of [CONFIG_PATH, MCP_PATH, COWORK_TOKEN_PATH]) {
    const existia = fs.existsSync(p);
    if (!existia) fs.writeFileSync(p, '{"apiKey":"segredo"}');
    const antes = ler(p);
    try {
      const r = await editar([{ path: p, old_text: 'segredo', new_text: 'x' }]);
      assert.ok(r.startsWith(MSG_SEGREDO), r);
      assert.match(r, /^Bloqueado:/);
      assert.match(r, /edição 1 de 1/);
      assert.doesNotMatch(r, /segredo"/, 'o conteúdo do segredo não pode vazar na resposta');
      assert.equal(ler(p), antes);
    } finally { if (!existia) fs.rmSync(p, { force: true }); }
  }
});

test('symlink de projeto apontando para config.json ou hooks.json é barrado', { skip: semSymlink }, async () => {
  fs.mkdirSync(HOME_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, '{"confirmShell": true}');
  fs.writeFileSync(HOOKS_PATH, '{"PreToolUse": []}');
  const dir = projeto();
  try {
    fs.symlinkSync(CONFIG_PATH, path.join(dir, 'settings.json'));
    fs.symlinkSync(path.relative(dir, HOOKS_PATH), path.join(dir, 'h.json'));
    fs.symlinkSync(HOME_DIR, path.join(dir, 'cfg'), 'dir');
    const r1 = await editar([{ path: path.join(dir, 'settings.json'), old_text: 'true', new_text: 'false' }]);
    assert.match(r1, /^Bloqueado:/);
    const r2 = await editar([{ path: path.join(dir, 'h.json'), old_text: '[]', new_text: '[{"command":"id"}]' }]);
    assert.match(r2, /^Bloqueado:/);
    const r3 = await editar([{ path: path.join(dir, 'cfg', 'sub', '..', 'hooks.json'), old_text: '[]', new_text: '[1]' }]);
    assert.match(r3, /^Bloqueado:/);
    assert.equal(ler(CONFIG_PATH), '{"confirmShell": true}');
    assert.equal(ler(HOOKS_PATH), '{"PreToolUse": []}');
  } finally {
    fs.rmSync(HOOKS_PATH, { force: true });
    fs.rmSync(CONFIG_PATH, { force: true });
  }
});

test('hard link para hooks.json é barrado', { skip: semSymlink }, async () => {
  fs.mkdirSync(HOME_DIR, { recursive: true });
  fs.writeFileSync(HOOKS_PATH, '{"PreToolUse": []}');
  const link = path.join(projeto(), 'copia.json');
  try {
    try { fs.linkSync(HOOKS_PATH, link); } catch { return; } // FS sem hard link
    assert.match(await editar([{ path: link, old_text: '[]', new_text: '[1]' }]), /^Bloqueado:/);
    assert.equal(ler(HOOKS_PATH), '{"PreToolUse": []}');
  } finally { fs.rmSync(HOOKS_PATH, { force: true }); }
});

test('sem regressão: arquivos comuns com nome de arquivo protegido continuam editáveis', async () => {
  const dir = projeto();
  const arquivos = ['hooks.json', 'config.json', 'mcp.json'].map((n) => criar(dir, n, '{"a":1}'));
  const r = await editar(arquivos.map((p) => ({ path: p, old_text: '1', new_text: '2' })));
  assert.equal(r.split('\n').filter((l) => l.startsWith('Editado:')).length, 3, r);
  for (const p of arquivos) assert.equal(ler(p), '{"a":2}');
});
