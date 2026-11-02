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
  const linhas = match[1].split(/\r?\n/);
  for (let i = 0; i < linhas.length; i++) {
    const line = linhas[i];
    if (/^\s/.test(line)) continue; // continuação de um bloco já lido
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    let valor = line.slice(idx + 1).trim();
    // v0.46.0: bloco do YAML ("description: >" ou "|", com as linhas seguintes recuadas) — antes a descrição
    // virava só ">" e o agente não sabia para que servia a skill (engenharia-agente vinha assim)
    if (/^[>|][+-]?$/.test(valor)) {
      const bloco = [];
      while (i + 1 < linhas.length && (/^\s+\S/.test(linhas[i + 1]) || linhas[i + 1].trim() === '')) bloco.push(linhas[++i].trim());
      valor = valor.startsWith('|') ? bloco.join('\n').trim() : bloco.join(' ').replace(/\s+/g, ' ').trim();
    } else if (/^(["']).*\1$/.test(valor)) {
      valor = valor.slice(1, -1);
    }
    meta[line.slice(0, idx).trim()] = valor;
  }
  return { meta, body: content.slice(match[0].length) };
}

function listSkills(extraDirs = []) {
  const dirs = [SKILLS_DIR, ...extraDirs].filter((d) => d && fs.existsSync(d));
  const skills = [];
  for (const dir of dirs) {
    let entradas;
    try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; } // não é pasta / sem permissão
    for (const entry of entradas) {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(dir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;
      let meta;
      // um SKILL.md ilegível não pode derrubar o prompt do sistema (e com ele o chat inteiro)
      try { ({ meta } = parseFrontMatter(fs.readFileSync(skillFile, 'utf8'))); } catch { continue; }
      skills.push({
        name: meta.name || entry.name,
        description: meta.description || '(sem descrição)',
        path: skillFile,
      });
    }
  }
  return skills;
}

const MAX_SKILL_BYTES = 512 * 1024; // um SKILL.md é texto; maior que isso não cabe no contexto

function readSkill(skillPath) {
  const { body } = parseFrontMatter(fs.readFileSync(skillPath, 'utf8'));
  return body.trim();
}

/**
 * v0.45.1: o modelo passava a PASTA da skill (EISDIR cru) ou só o NOME ("engenharia-agente"). Agora: pasta com
 * SKILL.md vale; nome sem barra procura entre as skills instaladas. Devolve o caminho do arquivo, ou null.
 */
function resolverSkill(pedido) {
  const p = path.resolve(pedido);
  try {
    const st = fs.statSync(p);
    if (st.isFile()) return p;
    if (st.isDirectory() && fs.existsSync(path.join(p, 'SKILL.md'))) return path.join(p, 'SKILL.md');
  } catch { /* não existe: tenta pelo nome */ }
  if (/[\\/]/.test(pedido)) return null;
  const nome = pedido.trim().toLowerCase();
  const achada = listSkills().find((s) => s.name.toLowerCase() === nome || path.basename(path.dirname(s.path)).toLowerCase() === nome);
  return achada ? achada.path : null;
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
  // read_skill lê qualquer caminho: sem isto, era outro jeito de ler os segredos.
  const { isSecret, foraDoProjetoParaConvidado, MSG_SEGREDO } = require('../tools/protectedPaths');
  if (isSecret(args.path)) return MSG_SEGREDO;
  // Convidado: só skills instaladas (~/.gemini-code/skills) ou do projeto.
  const { SKILLS_DIR } = require('../config');
  const fora = foraDoProjetoParaConvidado(args.path) && foraDoProjetoParaConvidado(args.path, SKILLS_DIR);
  if (fora) return fora;
  const arquivo = resolverSkill(args.path);
  if (!arquivo) {
    const nomes = listSkills().map((s) => s.name);
    return `Erro: skill não encontrada: ${args.path}${nomes.length ? ` (instaladas: ${nomes.join(', ')})` : ''}`;
  }
  // o caminho resolvido (pasta -> SKILL.md, nome -> arquivo) passa pelas mesmas travas
  if (isSecret(arquivo)) return MSG_SEGREDO;
  const foraR = foraDoProjetoParaConvidado(arquivo) && foraDoProjetoParaConvidado(arquivo, SKILLS_DIR);
  if (foraR) return foraR;
  const st = fs.statSync(arquivo);
  if (st.size > MAX_SKILL_BYTES) return `Erro: ${args.path} tem ${st.size} bytes — grande demais para uma skill (máximo ${MAX_SKILL_BYTES}).`;
  return readSkill(arquivo);
}

module.exports = { listSkills, readSkill, declarations, execute };
