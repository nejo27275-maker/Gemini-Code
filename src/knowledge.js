// src/knowledge.js
// "Conhecimento fixo" do agente: a spec da NetoLang, convenções dos seus
// projetos, exemplos de código — qualquer .md/.txt colocado em
// ~/.gemini-code/knowledge/ (vale pra tudo) ou no projeto atual (GEMINI.md,
// AGENTS.md ou .gemini-code/knowledge/*.md). Esse texto entra direto no prompt
// do sistema, sem depender do modelo "lembrar" de chamar uma ferramenta —
// modelos locais pequenos são ruins nisso, e é isso que faz um agente
// especialista na SUA linguagem/arquitetura.
'use strict';

const fs = require('fs');
const path = require('path');
const { HOME_DIR } = require('./config');

const EXTENSOES = new Set(['.md', '.txt']);

function knowledgeDir() {
  return path.join(HOME_DIR, 'knowledge');
}

function lerSeExiste(arquivo) {
  try {
    const st = fs.statSync(arquivo);
    if (!st.isFile()) return null;
    return fs.readFileSync(arquivo, 'utf8').trim();
  } catch {
    return null;
  }
}

function arquivosDaPasta(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && EXTENSOES.has(path.extname(e.name).toLowerCase()))
      .map((e) => path.join(dir, e.name))
      .sort();
  } catch {
    return [];
  }
}

/** Sobe do cwd até a raiz procurando GEMINI.md / AGENTS.md (o mais perto vem primeiro). */
function arquivosDeProjeto(cwd) {
  const achados = [];
  let dir = path.resolve(cwd);
  for (;;) {
    // Convenções de contexto comuns em agentes de programação. AGENTS.md é compartilhado
    // por Codex e outras ferramentas; os demais são lidos apenas se existirem.
    for (const nome of ['AGENTS.md', 'GEMINI.md', 'CLAUDE.md', '.hermes.md', 'SOUL.md', '.cursorrules', 'CODEX.md', 'ANTIGRAVITY.md', 'KIMI.md', 'KIMI_CODE.md', 'SYSTEM.md']) {
      const f = path.join(dir, nome);
      if (fs.existsSync(f)) achados.push(f);
    }
    achados.push(...arquivosDaPasta(path.join(dir, '.gemini-code', 'knowledge')));
    const pai = path.dirname(dir);
    if (pai === dir) break;
    dir = pai;
  }
  return achados;
}

/**
 * @returns {{ text: string, files: string[], truncated: boolean }}
 * Projeto vem antes do global (é mais específico) e o orçamento `maxChars`
 * protege o contexto do modelo — o que não couber é cortado com aviso.
 */
function loadKnowledge({ cwd = process.cwd(), maxChars = 10000 } = {}) {
  // v0.41.0: projeto em que o usuário negou confiança (src/trust.js) só usa o conhecimento global.
  const doProjeto = require('./trust').projetoLiberado(cwd) ? arquivosDeProjeto(cwd) : [];
  const candidatos = [...doProjeto, ...arquivosDaPasta(knowledgeDir())];
  const vistos = new Set();
  const blocos = [];
  const usados = [];
  let restante = maxChars;
  let truncated = false;

  for (const arq of candidatos) {
    const real = path.resolve(arq);
    if (vistos.has(real)) continue;
    vistos.add(real);
    const conteudo = lerSeExiste(real);
    if (!conteudo) continue;
    if (restante <= 200) { truncated = true; break; }
    const cab = `### ${path.basename(real)}\n`;
    let corpo = conteudo;
    if (cab.length + corpo.length > restante) {
      corpo = corpo.slice(0, Math.max(0, restante - cab.length - 60)) + '\n[... cortado: passou do orçamento de conhecimento ...]';
      truncated = true;
    }
    blocos.push(cab + corpo);
    usados.push(real);
    restante -= cab.length + corpo.length;
  }
  return { text: blocos.join('\n\n'), files: usados, truncated };
}

function addKnowledge(origem) {
  const src = path.resolve(origem);
  const st = fs.statSync(src); // lança ENOENT com mensagem clara se não existir
  const dest = knowledgeDir();
  fs.mkdirSync(dest, { recursive: true });
  const copiados = [];
  const arquivos = st.isDirectory()
    ? fs.readdirSync(src, { withFileTypes: true }).filter((e) => e.isFile() && EXTENSOES.has(path.extname(e.name).toLowerCase())).map((e) => path.join(src, e.name))
    : [src];
  for (const f of arquivos) {
    if (!EXTENSOES.has(path.extname(f).toLowerCase())) throw new Error(`Só aceito .md ou .txt (recebi ${path.basename(f)})`);
    const alvo = path.join(dest, path.basename(f));
    fs.copyFileSync(f, alvo);
    copiados.push(alvo);
  }
  return copiados;
}

function listKnowledge() {
  return arquivosDaPasta(knowledgeDir()).map((f) => ({ path: f, chars: (lerSeExiste(f) || '').length }));
}

module.exports = { loadKnowledge, addKnowledge, listKnowledge, knowledgeDir, arquivosDeProjeto };
