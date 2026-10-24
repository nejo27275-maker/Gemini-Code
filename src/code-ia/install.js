// src/code-ia/install.js
// "Instalação" automática do code-ia. Não baixa nada: o modelo é CONSTRUÍDO aqui, no aparelho,
// a partir do corpus (seed embutido + ~/.gemini-code/knowledge + skills + o que você ensinou).
// Primeira execução => constrói e salva em ~/.gemini-code/code-ia/model.json.
// Depois => só confere o hash do corpus e reconstrói sozinho se algo mudou.
'use strict';

const fs = require('fs');
const path = require('path');
const { HOME_DIR } = require('../config');
const modelo = require('./model');

const SEED_DIR = path.join(__dirname, 'seed');
const EXT = new Set(['.md', '.txt']);
// Código que o code-ia aprende a partir do que você ensina (pasta learn/): vira blocos pesquisáveis
// e alimenta o gerador com o SEU estilo.
const EXT_CODIGO = new Set(['.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx', '.py', '.sh', '.html', '.css', '.json', '.kt', '.java', '.lua', '.nl']);
const PASTAS_IGNORADAS = new Set(['node_modules', 'dist', 'build', 'coverage', '__pycache__', 'venv', '.git']);
const TAMANHO_MAX_ARQUIVO = 200 * 1024;
const LINHAS_POR_BLOCO = 45;

function ehSegredo(nome) {
  return /^\.env/i.test(nome) || /(^|[-_.])(secret|secrets|credentials|token|id_rsa)/i.test(nome) || /\.(pem|key|p12|keystore)$/i.test(nome) || /^package-lock\.json$|\.min\.(js|css)$/i.test(nome);
}

function codeIaDir(home = HOME_DIR) { return path.join(home, 'code-ia'); }
function modelPath(home = HOME_DIR) { return path.join(codeIaDir(home), 'model.json'); }
function learnDir(home = HOME_DIR) { return path.join(codeIaDir(home), 'learn'); }

function listar(dir, recursivo = false, { codigo = false } = {}) {
  const out = [];
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    const ext = path.extname(e.name).toLowerCase();
    if (e.isFile() && (EXT.has(ext) || (codigo && EXT_CODIGO.has(ext))) && !(codigo && ehSegredo(e.name))) out.push(p);
    else if (e.isDirectory() && recursivo && !PASTAS_IGNORADAS.has(e.name) && !e.name.startsWith('.')) out.push(...listar(p, true, { codigo }));
  }
  return out.sort();
}

/** Arquivo de código -> markdown em blocos de ~45 linhas (cortando em linha vazia), com título pesquisável. */
function codigoComoMarkdown(nome, texto) {
  const ext = path.extname(nome).slice(1);
  const linhas = texto.replace(/\r\n/g, '\n').split('\n');
  const partes = [];
  let atual = [];
  for (const l of linhas) {
    atual.push(l);
    if (atual.length >= LINHAS_POR_BLOCO && l.trim() === '') { partes.push(atual); atual = []; }
  }
  if (atual.some((l) => l.trim())) partes.push(atual);
  return partes.map((p, i) => {
    const corpo = p.join('\n').replace(/```/g, "'''");
    const ids = [...corpo.matchAll(/(?:function\*?\s+|class\s+|def\s+|(?:const|let|var)\s+)([A-Za-z_$][\w$]*)/g)].slice(0, 6).map((m) => m[1]);
    return `# Código ${nome} parte ${i + 1}${ids.length ? ` (${ids.join(', ')})` : ''}\n\`\`\`${ext}\n${corpo}\n\`\`\``;
  }).join('\n\n');
}

function fontes(home = HOME_DIR) {
  const por = [
    ['seed', SEED_DIR, listar(SEED_DIR)],
    ['knowledge', path.join(home, 'knowledge'), listar(path.join(home, 'knowledge'))],
    ['skills', path.join(home, 'skills'), listar(path.join(home, 'skills'), true)],
    ['learn', learnDir(home), listar(learnDir(home), true, { codigo: true })],
  ];
  const out = [];
  for (const [origem, raiz, lista] of por) for (const f of lista) out.push({ origem, raiz, f });
  return out;
}

/** Assinatura barata (só stat: nome, tamanho, mtime) — se não mudou, nem precisa ler os arquivos. */
function assinatura(home = HOME_DIR) {
  const h = require('crypto').createHash('sha256');
  for (const { f } of fontes(home)) {
    try { const st = fs.statSync(f); h.update(`${f}|${st.size}|${Math.floor(st.mtimeMs)}\n`); } catch { /* sumiu no meio */ }
  }
  return h.digest('hex').slice(0, 16);
}

function lerCorpus(home = HOME_DIR) {
  const arquivos = [];
  let bytesDeCodigo = 0;
  for (const { origem, raiz, f } of fontes(home)) {
    try {
      let texto = fs.readFileSync(f, 'utf8');
      const nome = `${origem}/${path.relative(raiz, f)}`;
      if (EXT_CODIGO.has(path.extname(f).toLowerCase()) && origem === 'learn') {
        if (texto.length > TAMANHO_MAX_ARQUIVO || bytesDeCodigo + texto.length > 5 * 1024 * 1024) continue;
        bytesDeCodigo += texto.length;
        texto = codigoComoMarkdown(path.relative(learnDir(home), f), texto);
      }
      if (texto.trim()) arquivos.push({ nome, texto });
    } catch { /* arquivo ilegível: ignora */ }
  }
  return arquivos;
}

function salvar(m, home) {
  fs.mkdirSync(codeIaDir(home), { recursive: true });
  const destino = modelPath(home);
  const tmp = `${destino}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(m));
  fs.renameSync(tmp, destino);
}

/** { modelo, existia }: existia=true mesmo quando o arquivo é de uma versão antiga (vira "atualizando"). */
function carregarDoDisco(home) {
  let m;
  try { m = JSON.parse(fs.readFileSync(modelPath(home), 'utf8')); } catch { return { modelo: null, existia: fs.existsSync(modelPath(home)) }; }
  const ok = m && m.version === modelo.MODEL_VERSION && Array.isArray(m.docs);
  return { modelo: ok ? m : null, existia: true };
}

/**
 * Garante que o modelo existe e está em dia. Retorna { modelo, acao: 'instalado'|'atualizado'|'ok', stats }.
 * `log` (opcional) recebe mensagens de progresso — só é chamado quando há trabalho a fazer.
 */
function ensureInstalled({ home = HOME_DIR, log } = {}) {
  const { modelo: atual, existia } = carregarDoDisco(home);
  const sig = assinatura(home);
  // caminho rápido: nada mudou nos arquivos (mesmos nomes/tamanhos/datas) -> não lê o corpus de novo
  if (atual && atual.sig === sig) return { modelo: atual, acao: 'ok', stats: atual.stats };

  const arquivos = lerCorpus(home);
  const hash = modelo.hashDoCorpus(arquivos);
  if (atual && atual.corpusHash === hash) {
    atual.sig = sig; // só as datas mudaram (ex.: copiou os arquivos de novo): conteúdo igual
    try { salvar(atual, home); } catch { /* não é crítico */ }
    return { modelo: atual, acao: 'ok', stats: atual.stats };
  }

  const primeira = !existia;
  if (log) log(primeira
    ? '[code-ia] Primeira execução: instalando o modelo próprio (code-ia)… roda 100% neste aparelho, sem internet.'
    : atual ? '[code-ia] Seu conhecimento mudou: atualizando o modelo…'
      : '[code-ia] Atualizando o code-ia para a versão nova (ou refazendo um modelo corrompido)…');
  const inicio = Date.now();
  const novo = modelo.treinar(arquivos);
  novo.sig = sig;
  salvar(novo, home);
  if (log) log(`[code-ia] Pronto em ${Date.now() - inicio} ms — ${novo.stats.blocos} blocos de conhecimento, ${novo.stats.blocosDeCodigo} trechos de código. Salvo em ${modelPath(home)}`);
  return { modelo: novo, acao: primeira || !atual ? 'instalado' : 'atualizado', stats: novo.stats };
}

/** Copia arquivos/pastas (.md/.txt e código) para a pasta "learn" e refaz o modelo. */
function ensinar(origem, { home = HOME_DIR, log } = {}) {
  const alvo = path.resolve(origem);
  let st;
  try { st = fs.statSync(alvo); } catch { throw new Error(`Não achei: ${origem}`); }
  const base = st.isDirectory() ? alvo : path.dirname(alvo);
  const arquivos = st.isDirectory() ? listar(alvo, true, { codigo: true }) : [alvo];
  const validos = arquivos.filter((f) => (EXT.has(path.extname(f).toLowerCase()) || EXT_CODIGO.has(path.extname(f).toLowerCase())) && !ehSegredo(path.basename(f)));
  if (!validos.length) throw new Error('Nada pra ensinar: use arquivos .md/.txt (cada título vira uma pergunta) ou código (.js, .py, .html, .sh…).');
  const destinoBase = st.isDirectory() ? path.join(learnDir(home), path.basename(alvo)) : learnDir(home);
  for (const f of validos) {
    const destino = path.join(destinoBase, path.relative(base, f));
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.copyFileSync(f, destino);
  }
  limparCache();
  const r = ensureInstalled({ home, log });
  return { copiados: validos.length, ...r };
}

/** Esquece tudo que foi ensinado (apaga a pasta learn) e refaz o modelo só com o corpus base. */
function esquecer({ home = HOME_DIR, log } = {}) {
  fs.rmSync(learnDir(home), { recursive: true, force: true });
  limparCache();
  return ensureInstalled({ home, log });
}

/** Divide um markdown em seções "# título", respeitando blocos ``` (um "# comentário" dentro de código não é título). */
function secoes(texto) {
  const out = [];
  let atual = null;
  let cerca = false;
  for (const l of String(texto || '').replace(/\r\n/g, '\n').split('\n')) {
    if (/^```/.test(l)) cerca = !cerca;
    if (!cerca && /^#{1,3}\s+/.test(l)) { atual = { titulo: l.replace(/^#{1,3}\s+/, '').trim(), linhas: [l] }; out.push(atual); } else if (atual) atual.linhas.push(l);
  }
  return out.map((x) => ({ titulo: x.titulo, texto: x.linhas.join('\n').trimEnd() }));
}

/** Ensina uma pergunta + resposta numa linha só (chat: /ensinar). Mesma pergunta de novo = substitui. */
function anotar(titulo, resposta, { home = HOME_DIR, log } = {}) {
  const t = String(titulo || '').replace(/\s+/g, ' ').trim().replace(/^#+\s*/, '');
  const r = String(resposta || '').trim();
  if (t.length < 3 || r.length < 3) throw new Error('Use: pergunta :: resposta (os dois com pelo menos 3 letras)');
  const arquivo = path.join(learnDir(home), 'anotacoes.md');
  let antigas = [];
  try { antigas = secoes(fs.readFileSync(arquivo, 'utf8')); } catch { /* primeira anotação */ }
  const chave = (x) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const mantidas = antigas.filter((x) => chave(x.titulo) !== chave(t));
  const substituiu = mantidas.length !== antigas.length;
  const corpo = r.split('\n').map((l) => (/^#{1,3}\s/.test(l) ? ` ${l}` : l)).join('\n');
  mantidas.push({ titulo: t, texto: `# ${t}\n${corpo}` });
  fs.mkdirSync(learnDir(home), { recursive: true });
  fs.writeFileSync(arquivo, mantidas.map((x) => x.texto).join('\n\n') + '\n', 'utf8');
  limparCache();
  const info = ensureInstalled({ home, log });
  return { substituiu, ...info };
}

/** Perguntas ensinadas com /ensinar ou `teach` (títulos de anotacoes.md). */
function listarAnotacoes({ home = HOME_DIR } = {}) {
  try { return secoes(fs.readFileSync(path.join(learnDir(home), 'anotacoes.md'), 'utf8')).map((x) => x.titulo); } catch { return []; }
}

/** Esquece UMA anotação (acha pelo título, sem acento/maiúscula; aceita só um pedaço se for único). */
function esquecerAnotacao(titulo, { home = HOME_DIR, log } = {}) {
  const chave = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  const alvo = chave(titulo);
  if (alvo.length < 2) throw new Error('Diga qual pergunta esquecer (veja a lista com /ensinados).');
  const arquivo = path.join(learnDir(home), 'anotacoes.md');
  let todas = [];
  try { todas = secoes(fs.readFileSync(arquivo, 'utf8')); } catch { /* nada ensinado */ }
  let achadas = todas.filter((x) => chave(x.titulo) === alvo);
  if (!achadas.length) achadas = todas.filter((x) => chave(x.titulo).includes(alvo));
  if (!achadas.length) throw new Error(`Não achei nada ensinado parecido com "${titulo}".`);
  if (achadas.length > 1) throw new Error(`Mais de uma opção (${achadas.map((x) => x.titulo).join('; ')}). Escreva a pergunta completa.`);
  const resto = todas.filter((x) => x !== achadas[0]);
  if (resto.length) fs.writeFileSync(arquivo, resto.map((x) => x.texto).join('\n\n') + '\n', 'utf8'); else fs.rmSync(arquivo, { force: true });
  limparCache();
  return { esquecida: achadas[0].titulo, ...ensureInstalled({ home, log }) };
}

let cache = null; // { home, hash do arquivo (mtime) , modelo }
/** Versão com cache pro provedor (não relê o disco a cada mensagem do chat). */
function obterModelo({ home = HOME_DIR, log } = {}) {
  if (cache && cache.home === home) return cache.modelo;
  const r = ensureInstalled({ home, log });
  cache = { home, modelo: r.modelo };
  return r.modelo;
}
function limparCache() { cache = null; }

module.exports = { ensureInstalled, ensinar, esquecer, anotar, listarAnotacoes, esquecerAnotacao, secoes, assinatura, obterModelo, limparCache, codeIaDir, modelPath, learnDir, lerCorpus, SEED_DIR };
