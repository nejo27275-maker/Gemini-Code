// Checkpoints locais de projeto com manifesto SHA-256 e restauração conservadora.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { HOME_DIR } = require('./config');

const CHECKPOINTS_DIR = path.join(HOME_DIR, 'checkpoints');
const MAX_FILES = 10000;
const MAX_BYTES = 100 * 1024 * 1024;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.gemini-code', '.claude', '.hermes', '.next', 'dist', 'build', 'coverage']);
const SENSITIVE_FILE = /^(\.env(?:\..*)?|.*\.(?:pem|p12|pfx|key)|id_rsa(?:\.pub)?|credentials\.json)$/i;

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function idNow() { return `cp_${new Date().toISOString().replace(/[:.]/g, '-')}_${crypto.randomBytes(3).toString('hex')}`; }
function normalizeRoot(root) {
  const resolved = fs.realpathSync(path.resolve(root || process.cwd()));
  if (!fs.statSync(resolved).isDirectory()) throw new Error('O workspace precisa ser uma pasta.');
  if (resolved === path.parse(resolved).root || resolved === fs.realpathSync(os.homedir())) {
    throw new Error('Checkpoint de raiz do sistema ou da pasta pessoal inteira não é permitido. Informe a pasta específica do projeto.');
  }
  return resolved;
}
function shouldSkip(name, rel, isDir) {
  if (isDir && SKIP_DIRS.has(name)) return true;
  if (name === '.env.example') return false;
  if (SENSITIVE_FILE.test(name)) return true;
  if (rel.split(path.sep).some((part) => part === '.git' || part === 'node_modules')) return true;
  return false;
}
function walkFiles(root) {
  const files = [];
  let totalBytes = 0;
  function walk(dir, relBase = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const rel = relBase ? path.join(relBase, entry.name) : entry.name;
      const abs = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue; // não segue symlinks para evitar sair do workspace
      if (shouldSkip(entry.name, rel, entry.isDirectory())) continue;
      if (entry.isDirectory()) { walk(abs, rel); continue; }
      if (!entry.isFile()) continue;
      const st = fs.statSync(abs);
      totalBytes += st.size;
      if (files.length + 1 > MAX_FILES) throw new Error(`Checkpoint excedeu o limite de ${MAX_FILES} arquivos.`);
      if (totalBytes > MAX_BYTES) throw new Error(`Checkpoint excedeu o limite de ${MAX_BYTES / (1024 * 1024)} MB.`);
      files.push({ abs, rel, size: st.size, mode: st.mode & 0o777, sha256: sha256(abs) });
    }
  }
  walk(root);
  return { files, totalBytes };
}

function readManifest(dir) {
  const file = path.join(dir, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (m.version !== 1 || typeof m.id !== 'string' || typeof m.root !== 'string' || !Array.isArray(m.files)) {
    throw new Error('Manifesto de checkpoint inválido.');
  }
  for (const f of m.files) {
    if (!f || typeof f.path !== 'string' || path.isAbsolute(f.path) || f.path.split(/[\\/]/).includes('..')) {
      throw new Error('Manifesto contém um caminho inseguro.');
    }
  }
  return m;
}

function createCheckpoint({ root = process.cwd(), reason = 'manual', label = '' } = {}) {
  const workspace = normalizeRoot(root);
  const { files, totalBytes } = walkFiles(workspace);
  const id = idNow();
  const dir = path.join(CHECKPOINTS_DIR, id);
  const fileDir = path.join(dir, 'files');
  fs.mkdirSync(fileDir, { recursive: true });
  try {
    const manifestFiles = [];
    for (const f of files) {
      const dest = path.join(fileDir, f.rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(f.abs, dest);
      fs.chmodSync(dest, f.mode);
      manifestFiles.push({ path: f.rel, size: f.size, mode: f.mode, sha256: f.sha256 });
    }
    const manifest = {
      version: 1, id, root: workspace, label: String(label).slice(0, 120), reason: String(reason).slice(0, 200),
      createdAt: new Date().toISOString(), files: manifestFiles, fileCount: manifestFiles.length, totalBytes,
    };
    const tmp = path.join(dir, 'manifest.json.tmp');
    fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, path.join(dir, 'manifest.json'));
    return manifest;
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function listCheckpoints({ root } = {}) {
  let dirs;
  try { dirs = fs.readdirSync(CHECKPOINTS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()); }
  catch { return []; }
  return dirs.map((e) => {
    try { return readManifest(path.join(CHECKPOINTS_DIR, e.name)); } catch { return null; }
  }).filter((m) => m && (!root || path.resolve(root) === m.root))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(({ id, root: workspace, label, reason, createdAt, fileCount, totalBytes }) => ({ id, root: workspace, label, reason, createdAt, fileCount, totalBytes }));
}

function safeTarget(root, rel) {
  if (!rel || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) throw new Error('Caminho de arquivo inseguro.');
  const target = path.resolve(root, rel);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error('O arquivo sairia do workspace.');
  let parent = root;
  const pieces = rel.split(path.sep);
  for (const part of pieces.slice(0, -1)) {
    parent = path.join(parent, part);
    if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) throw new Error(`Restauração recusada: diretório simbólico em ${part}.`);
  }
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error(`Restauração recusada: o destino ${rel} é um link simbólico.`);
  return target;
}

function restoreCheckpoint(id, { yes = false, root = process.cwd() } = {}) {
  if (!yes) throw new Error('Restauração exige confirmação explícita com --yes.');
  const dir = path.join(CHECKPOINTS_DIR, path.basename(String(id || '')));
  const manifest = readManifest(dir);
  const workspace = normalizeRoot(root);
  if (manifest.root !== workspace) throw new Error(`Este checkpoint pertence a ${manifest.root}, não a ${workspace}.`);
  // Valida o snapshot inteiro ANTES de alterar arquivos, para não deixar uma
  // restauração parcial caso algum conteúdo esteja corrompido.
  for (const item of manifest.files) {
    const source = path.join(dir, 'files', item.path);
    if (!fs.existsSync(source) || sha256(source) !== item.sha256) throw new Error(`Checkpoint corrompido: ${item.path}`);
    safeTarget(workspace, item.path);
  }
  // Guardamos o estado atual antes de sobrepor qualquer arquivo do snapshot.
  const safety = createCheckpoint({ root: workspace, reason: `safety-before-restore:${id}`, label: 'Segurança antes da restauração' });
  let restored = 0;
  for (const item of manifest.files) {
    const source = path.join(dir, 'files', item.path);
    const dest = safeTarget(workspace, item.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.gemini-code-restore-${process.pid}`;
    fs.copyFileSync(source, tmp);
    fs.chmodSync(tmp, item.mode & 0o777);
    fs.renameSync(tmp, dest);
    restored++;
  }
  return { id: manifest.id, restored, safetyCheckpointId: safety.id, root: workspace,
    note: 'Arquivos do checkpoint foram restaurados. Arquivos criados após o checkpoint não foram removidos.' };
}

module.exports = { CHECKPOINTS_DIR, MAX_FILES, MAX_BYTES, createCheckpoint, listCheckpoints, restoreCheckpoint };
