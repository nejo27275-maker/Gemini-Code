// Artefatos auditáveis: relatórios de execução e resultados podem ser consultados após a sessão.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { HOME_DIR } = require('./config');
const { lerJson, escreverJson } = require('./jsonStore');

const ARTIFACTS_DIR = path.join(HOME_DIR, 'artifacts');
const INDEX_PATH = path.join(ARTIFACTS_DIR, 'index.json');
function readIndex() {
  return lerJson(INDEX_PATH, (v) => v && v.version === 1 && Array.isArray(v.items), () => ({ version: 1, items: [] }));
}
function slug(s) { return String(s || 'artefato').toLowerCase().replace(/[^a-z0-9\-_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'artefato'; }
function createArtifact({ title, type = 'relatorio', status = 'concluido', summary = '', content = '', taskId = null, cwd = process.cwd(), metadata = {} } = {}) {
  if (!String(title || '').trim()) throw new Error('O artefato precisa de um título.');
  const id = `art_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true, mode: 0o700 });
  const fileName = `${slug(title)}-${id}.md`;
  const filePath = path.join(ARTIFACTS_DIR, fileName);
  const body = String(content || summary || '(sem conteúdo)');
  fs.writeFileSync(filePath, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  const item = { id, title: String(title).slice(0, 180), type: String(type).slice(0, 60), status: String(status).slice(0, 40),
    summary: String(summary).slice(0, 1200), taskId, cwd: path.resolve(cwd), createdAt: new Date().toISOString(),
    fileName, bytes: Buffer.byteLength(body), sha256: crypto.createHash('sha256').update(body).digest('hex'),
    metadata: metadata && typeof metadata === 'object' ? metadata : {} };
  const index = readIndex();
  index.items.unshift(item);
  index.items = index.items.slice(0, 2000);
  escreverJson(INDEX_PATH, index);
  return item;
}
function listArtifacts({ limit = 30, type, status } = {}) {
  const n = Number(limit);
  if (!Number.isInteger(n) || n < 1 || n > 500) throw new Error('limit deve estar entre 1 e 500.');
  return readIndex().items.filter((a) => (!type || a.type === type) && (!status || a.status === status)).slice(0, n);
}
function getArtifact(id) { return readIndex().items.find((a) => a.id === id) || null; }
function readArtifact(id) {
  const item = getArtifact(id);
  if (!item) return null;
  const p = path.join(ARTIFACTS_DIR, path.basename(item.fileName));
  const content = fs.readFileSync(p, 'utf8');
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  if (hash !== item.sha256) throw new Error(`O artefato ${id} não passou na verificação SHA-256.`);
  return { ...item, content };
}
module.exports = { ARTIFACTS_DIR, INDEX_PATH, createArtifact, listArtifacts, getArtifact, readArtifact };
