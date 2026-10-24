// Scanner heurístico de segredos: informa arquivo/linha/tipo, nunca o valor detectado.
'use strict';

const fs = require('fs');
const path = require('path');

const MAX_FILES = 20000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'coverage', '.gemini-code', 'vendor']);
const RULES = [
  { name: 'chave privada', regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { name: 'token GitHub', regex: /\b(?:gh[pousr]_[A-Za-z0-9_]{25,}|github_pat_[A-Za-z0-9_]{25,})\b/g },
  { name: 'chave Google API', regex: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { name: 'chave OpenAI', regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{28,}\b/g },
  { name: 'chave AWS', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'token Slack', regex: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
  { name: 'segredo em atribuição', regex: /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|secret)\b\s*[:=]\s*["']([A-Za-z0-9/+_.=-]{24,})["']/gi, group: 1 },
];
const PLACEHOLDER = /(?:your[_ -]?|replace|example|placeholder|changeme|change[_ -]?me|process\.env|os\.environ|dummy|fake|test[_ -]?secret)/i;

function walk(root) {
  const output = [];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) visit(absolute);
      } else if (entry.isFile()) {
        if (output.length >= MAX_FILES) throw new Error(`Scan interrompido: limite de ${MAX_FILES} arquivos.`);
        try {
          const st = fs.statSync(absolute);
          if (st.size <= MAX_FILE_BYTES) output.push(absolute);
        } catch { /* arquivos que mudam durante o scan são ignorados */ }
      }
    }
  }
  visit(root);
  return output;
}

function scanSecrets(root = process.cwd()) {
  const workspace = fs.realpathSync(path.resolve(root));
  if (!fs.statSync(workspace).isDirectory()) throw new Error('Informe uma pasta de projeto válida.');
  const files = walk(workspace);
  const findings = [];
  for (const absolute of files) {
    let content;
    try { content = fs.readFileSync(absolute, 'utf8'); } catch { continue; }
    if (content.includes('\0')) continue; // não tenta analisar binários
    const lines = content.split(/\r?\n/);
    lines.forEach((line, idx) => {
      for (const rule of RULES) {
        rule.regex.lastIndex = 0;
        let match;
        while ((match = rule.regex.exec(line)) !== null) {
          const candidate = rule.group ? match[rule.group] : match[0];
          if (!candidate || PLACEHOLDER.test(candidate)) continue;
          findings.push({ file: path.relative(workspace, absolute), line: idx + 1, type: rule.name });
          break; // no máximo uma ocorrência por regra/linha
        }
      }
    });
  }
  return { root: workspace, scannedFiles: files.length, findings: findings.slice(0, 1000), truncatedFindings: findings.length > 1000,
    summary: findings.length ? `${findings.length} ocorrência(s) potencial(is); revisão manual necessária.` : 'Nenhum padrão conhecido detectado. Isso não garante ausência de segredos.' };
}

// v0.41.0: as mesmas regras mascaram segredos antes de gravar em log (src/decisionLog.js).
const MASCARAR = [...RULES, { name: 'token Bearer', regex: /\bBearer\s+([A-Za-z0-9._~+/-]{20,}=*)/g, group: 1 }];

function mascararSegredos(texto) {
  if (typeof texto !== 'string' || !texto) return texto;
  let saida = texto;
  for (const regra of MASCARAR) {
    saida = saida.replace(regra.regex, (inteiro, grupo) => {
      const valor = regra.group ? grupo : inteiro;
      if (!valor) return inteiro;
      return inteiro.replace(valor, `${valor.slice(0, 4)}…[segredo omitido]`);
    });
  }
  return saida;
}

module.exports = { scanSecrets, mascararSegredos, MAX_FILES, MAX_FILE_BYTES };
