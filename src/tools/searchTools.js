// src/tools/searchTools.js
// Item 3 da revisão (set/2026): sem nenhuma forma de busca por conteúdo, o
// agente só enxergava um projeto arquivo por arquivo (list_dir + read_file
// um de cada vez), o que fica inviável em projetos com mais de uns 20
// arquivos. Implementado em Node puro (sem depender de `grep` existir no
// PATH — no Termux geralmente existe, mas não é garantido em todo ambiente)
// e ignorando pastas pesadas/irrelevantes por padrão.
//
// v0.45.1:
// - "path" pode ser um ARQUIVO (antes respondia "nenhuma ocorrência" sem nem abrir);
// - linhas com \r\n (Windows): "fim$" não casava porque a linha terminava em \r;
// - file_glob aceita glob ("*.js", "src/**/*.ts"), que é o que o modelo costuma mandar — antes era só sufixo e
//   "*.js" nunca casava nada;
// - respeita os .gitignore (como o glob_files): build/, dist/ de verdade e afins não enchem o resultado;
// - regex do modelo roda numa thread separada com prazo: "(a+)+$" numa linha comprida travava o processo
//   inteiro (o chat e o cowork server junto);
// - linha longa mostra o trecho em volta da ocorrência, não só os 200 primeiros caracteres.
'use strict';

const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { verificadorDeSegredos, foraDoProjetoParaConvidado } = require('./protectedPaths');

const IGNORAR_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.cache', 'coverage']);
const MAX_RESULTADOS = 100;
const MAX_TAMANHO_ARQUIVO = 2 * 1024 * 1024; // 2 MB — acima disso, provavelmente não é texto de código
const LARGURA_TRECHO = 200;
const PRAZO_REGEX_MS = 15000;

const declarations = [
  {
    name: 'search_files',
    description:
      'Busca um texto ou padrão (regex simples) dentro dos arquivos de um diretório (ou de um arquivo), recursivamente. ' +
      'Devolve caminho, número da linha e o trecho da linha para cada ocorrência (até 100 resultados). ' +
      'Ignora node_modules, .git e o que os .gitignore ignoram.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Texto ou regex a procurar' },
        path: { type: 'string', description: 'Diretório (ou arquivo) onde procurar (padrão: .)' },
        is_regex: { type: 'boolean', description: 'Se true, trata "pattern" como regex JS. Padrão: false (busca literal).' },
        ignore_case: { type: 'boolean', description: 'Se true, ignora maiúsculas/minúsculas. Padrão: false.' },
        include_hidden: { type: 'boolean', description: 'Se true, também entra em pastas/arquivos que começam com ponto (ex.: .github). Nunca lê arquivos .env*. Padrão: false.' },
        file_glob: { type: 'string', description: 'Filtro de arquivos: glob ("*.js", "src/**/*.ts") ou sufixo (".json") (opcional)' },
      },
      required: ['pattern'],
    },
  },
];

function* listarArquivos(raiz, dir, incluirOcultos, ignorado) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (IGNORAR_DIRS.has(entry.name)) continue;
    // v0.3.8: antes TODO nome com ponto era pulado (.github/workflows, .eslintrc.json
    // ficavam invisíveis). Agora é opt-in, e segredos (.env*, .ssh) continuam fora.
    if (entry.name.startsWith('.') && (!incluirOcultos || /^\.(env|ssh|gnupg|aws)/i.test(entry.name))) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(raiz, full).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (!ignorado(rel, true)) yield* listarArquivos(raiz, full, incluirOcultos, ignorado);
    } else if (entry.isFile() && !ignorado(rel, false)) {
      yield { full, rel };
    }
  }
}

function montarMatcher({ pattern, is_regex: ehRegex, ignore_case: ignorarCaixa }) {
  if (ehRegex) {
    try {
      return { matcher: new RegExp(pattern, ignorarCaixa ? 'i' : '') };
    } catch (err) {
      return { erro: `Erro: regex inválida (${err.message})` };
    }
  }
  // Busca literal: escapa qualquer caractere especial de regex.
  return { matcher: new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), ignorarCaixa ? 'i' : '') };
}

/** file_glob -> filtro (rel, nome). Sem caractere de glob, continua sendo sufixo (".js"), como antes. */
function filtroDeArquivo(fileGlob) {
  if (typeof fileGlob !== 'string' || !fileGlob.trim()) return { filtro: () => true };
  const g = fileGlob.trim().replace(/^\.\//, '');
  if (!/[*?[{]/.test(g)) return { filtro: (rel) => rel.endsWith(g) };
  let re;
  try { re = require('./globTools').globParaRegex(g); } catch (err) { return { erro: `Erro: file_glob inválido (${err.message}).` }; }
  // Com "/", compara com o caminho relativo; sem, só com o nome (como "*.js" no shell).
  return { filtro: g.includes('/') ? (rel) => re.test(rel) : (rel) => re.test(rel.slice(rel.lastIndexOf('/') + 1)) };
}

function trecho(linha, indice) {
  const t = linha.replace(/\s+$/, '');
  if (t.length <= LARGURA_TRECHO) return t.trim();
  const ini = Math.max(0, Math.min(indice - 60, t.length - LARGURA_TRECHO));
  return `${ini > 0 ? '…' : ''}${t.slice(ini, ini + LARGURA_TRECHO).trim()}${ini + LARGURA_TRECHO < t.length ? '…' : ''}`;
}

/** A busca em si: síncrona e sem terminal (roda na thread principal ou numa Worker). */
function buscar({ raiz, cwd, opcoes }) {
  const { matcher, erro } = montarMatcher(opcoes);
  if (erro) return { erro };
  const arquivoFiltro = filtroDeArquivo(opcoes.file_glob);
  if (arquivoFiltro.erro) return { erro: arquivoFiltro.erro };

  let arquivos;
  let st;
  try { st = fs.statSync(raiz); } catch { return { erro: `Erro: diretório não existe: ${opcoes.path || '.'}` }; }
  if (st.isFile()) {
    arquivos = [{ full: raiz, rel: path.basename(raiz) }];
  } else {
    let ignorado = () => false;
    try { ignorado = require('./globTools').criarFiltroGitignore(raiz); } catch { /* sem filtro: busca tudo */ }
    arquivos = listarArquivos(raiz, raiz, Boolean(opcoes.include_hidden), ignorado);
  }

  const resultados = [];
  const ehSegredo = verificadorDeSegredos();
  for (const { full: arquivo, rel } of arquivos) {
    if (resultados.length >= MAX_RESULTADOS) break;
    if (!arquivoFiltro.filtro(rel)) continue;

    let stat;
    try {
      stat = fs.statSync(arquivo);
    } catch {
      continue;
    }
    if (stat.size > MAX_TAMANHO_ARQUIVO) continue;
    // v0.41.0: buscar dentro de ~/.gemini-code devolvia a linha do token ou da API key.
    if (ehSegredo(arquivo, stat)) continue;

    let conteudo;
    try {
      const buf = fs.readFileSync(arquivo);
      if (buf.subarray(0, 8000).includes(0)) continue; // pula binário
      conteudo = buf.toString('utf8');
    } catch {
      continue;
    }

    const linhas = conteudo.split(/\r?\n/);
    for (let i = 0; i < linhas.length; i++) {
      const m = matcher.exec(linhas[i]);
      if (m) {
        resultados.push(`${path.relative(cwd, arquivo) || path.basename(arquivo)}:${i + 1}: ${trecho(linhas[i], m.index)}`);
        if (resultados.length >= MAX_RESULTADOS) break;
      }
    }
  }
  return { resultados };
}

/** Regex escrita pelo modelo pode ter backtracking catastrófico: roda numa Worker e mata no prazo. */
function buscarComPrazo(dados, prazoMs = PRAZO_REGEX_MS) {
  return new Promise((resolve) => {
    let fim = false;
    const terminar = (r) => { if (!fim) { fim = true; clearTimeout(relogio); resolve(r); } };
    const w = new Worker(__filename, { workerData: { buscaGeminiCode: true, ...dados } });
    const relogio = setTimeout(() => {
      w.terminate();
      terminar({ erro: `Erro: a regex levou mais de ${prazoMs / 1000} s e a busca foi interrompida (provável backtracking catastrófico, ex.: "(a+)+" ou "(.*)*"). Simplifique o padrão ou use is_regex: false.` });
    }, prazoMs);
    w.once('message', terminar);
    w.once('error', (err) => terminar({ erro: `Erro na busca: ${err.message}` }));
    w.once('exit', () => terminar({ erro: 'Erro na busca: a busca terminou sem resultado.' }));
  });
}

async function execute(name, args, { prazoMs } = {}) {
  if (name !== 'search_files') throw new Error(`Ferramenta de busca desconhecida: ${name}`);
  args = args || {};
  if (typeof args.pattern !== 'string' || args.pattern === '') return 'Erro: search_files precisa de "pattern" (texto não vazio).';
  if (args.path != null && typeof args.path !== 'string') return 'Erro: "path" precisa ser texto (a pasta ou o arquivo onde procurar).';

  const raiz = path.resolve(args.path || '.');
  const fora = foraDoProjetoParaConvidado(raiz);
  if (fora) return fora;
  if (!fs.existsSync(raiz)) return `Erro: diretório não existe: ${args.path || '.'}`;

  const opcoes = {
    pattern: args.pattern, path: args.path, is_regex: args.is_regex === true, ignore_case: args.ignore_case === true,
    include_hidden: args.include_hidden === true, file_glob: args.file_glob,
  };
  const dados = { raiz, cwd: process.cwd(), opcoes };
  const r = opcoes.is_regex ? await buscarComPrazo(dados, prazoMs) : buscar(dados);
  if (r.erro) return r.erro;

  const { resultados } = r;
  if (!resultados.length) return `Nenhuma ocorrência de "${args.pattern}" encontrada em ${args.path || '.'}`;
  const aviso = resultados.length >= MAX_RESULTADOS ? `\n[... parando em ${MAX_RESULTADOS} resultados, refine a busca]` : '';
  return resultados.join('\n') + aviso;
}

if (!isMainThread && workerData && workerData.buscaGeminiCode) {
  parentPort.postMessage(buscar(workerData));
}

module.exports = { declarations, execute, filtroDeArquivo };
