// src/skills/loader.js
// Skills = pastas com um SKILL.md descrevendo boas práticas/instruções para
// um tipo de tarefa (igual ao formato usado pelo Claude Code). O agente lê
// só o título+descrição de cada skill no prompt do sistema, e usa a
// ferramenta "read_skill" para carregar o conteúdo completo quando precisar.
'use strict';

const fs = require('fs');
const path = require('path');
const { SKILLS_DIR } = require('../config');

function parseFrontMatter(content) {
  // v0.3.10: aceita CRLF (SKILL.md editado no Windows/sincronizado) e BOM; antes o front matter era ignorado.
  content = content.replace(/^\uFEFF/, '');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { meta: {}, body: content };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { meta, body: content.slice(match[0].length) };
}

function listSkills(extraDirs = []) {
  const dirs = [SKILLS_DIR, ...extraDirs].filter((d) => d && fs.existsSync(d));
  const skills = [];
  for (const dir of dirs) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(dir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;
      const { meta } = parseFrontMatter(fs.readFileSync(skillFile, 'utf8'));
      skills.push({
        name: meta.name || entry.name,
        description: meta.description || '(sem descrição)',
        path: skillFile,
      });
    }
  }
  return skills;
}

function readSkill(skillPath) {
  const { body } = parseFrontMatter(fs.readFileSync(skillPath, 'utf8'));
  return body.trim();
}

const declarations = [
  {
    name: 'read_skill',
    description: 'Lê o conteúdo completo de uma skill pelo caminho do SKILL.md.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
];

async function execute(name, args) {
  if (name !== 'read_skill') throw new Error(`Ferramenta de skill desconhecida: ${name}`);
  if (typeof args.path !== 'string' || !args.path) return 'Erro: read_skill precisa de "path" (caminho do SKILL.md).';
  if (!fs.existsSync(args.path)) return `Erro: skill não encontrada: ${args.path}`;
  return readSkill(args.path);
}

module.exports = { listSkills, readSkill, declarations, execute };
