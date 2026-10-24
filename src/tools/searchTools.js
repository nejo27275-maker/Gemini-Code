// src/tools/searchTools.js
// Item 3 da revisão (set/2026): sem nenhuma forma de busca por conteúdo, o
// agente só enxergava um projeto arquivo por arquivo (list_dir + read_file
// um de cada vez), o que fica inviável em projetos com mais de uns 20
// arquivos. Implementado em Node puro (sem depender de `grep` existir no
// PATH — no Termux geralmente existe, mas não é garantido em todo ambiente)
// e ignorando pastas pesadas/irrelevantes por padrão.
'use strict';

const fs = require('fs');
const path = require('path');
const { verificadorDeSegredos, foraDoProjetoParaConvidado } = require('./protectedPaths');

const IGNORAR_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.cache', 'coverage']);
const MAX_RESULTADOS = 100;
const MAX_TAMANHO_ARQUIVO = 2 * 1024 * 1024; // 2 MB — acima disso, provavelmente não é texto de código

const declarations = [
  {
    name: 'search_files',
    description:
      'Busca um texto ou padrão (regex simples) dentro dos arquivos de um diretório, recursivamente. ' +
      'Devolve caminho, número da linha e o trecho da linha para cada ocorrência (até 100 resultados).',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Texto ou regex a procurar' },
        path: { type: 'string', description: 'Diretório onde procurar (padrão: .)' },
        is_regex: { type: 'boolean', description: 'Se true, trata "pattern" como regex JS. Padrão: false (busca literal).' },
        ignore_case: { type: 'boolean', description: 'Se true, ignora maiúsculas/minúsculas. Padrão: false.' },
        include_hidden: { type: 'boolean', description: 'Se true, também entra em pastas/arquivos que começam com ponto (ex.: .github). Nunca lê arquivos .env*. Padrão: false.' },
        file_glob: { type: 'string', description: 'Filtro simples de extensão/sufixo, ex: ".js" ou ".json" (opcional)' },
      },
      required: ['pattern'],
    },
  },
];

function* listarArquivos(dir, incluirOcultos = false) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (IGNORAR_DIRS.has(entry.name) || entry.name === '.git') continue;
    // v0.3.8: antes TODO nome com ponto era pulado (.github/workflows, .eslintrc.json
    // ficavam invisíveis). Agora é opt-in, e segredos (.env*, .ssh) continuam fora.
    if (entry.name.startsWith('.') && (!incluirOcultos || /^\.(env|ssh|gnupg|aws)/i.test(entry.name))) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* listarArquivos(full, incluirOcultos);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

async function execute(name, args) {
  if (name !== 'search_files') throw new Error(`Ferramenta de busca desconhecida: ${name}`);
  if (typeof args.pattern !== 'string' || args.pattern === '') return 'Erro: search_files precisa de "pattern" (texto não vazio).';

  const raiz = path.resolve(args.path || '.');
  const fora = foraDoProjetoParaConvidado(raiz);
  if (fora) return fora;
  if (!fs.existsSync(raiz)) return `Erro: diretório não existe: ${args.path || '.'}`;

  let matcher;
  if (args.is_regex) {
    try {
      matcher = new RegExp(args.pattern, args.ignore_case ? 'i' : '');
    } catch (err) {
      return `Erro: regex inválida (${err.message})`;
    }
  } else {
    // Busca literal: escapa qualquer caractere especial de regex.
    const escapado = args.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    matcher = new RegExp(escapado, args.ignore_case ? 'i' : '');
  }

  const resultados = [];
  const ehSegredo = verificadorDeSegredos();
  for (const arquivo of listarArquivos(raiz, !!args.include_hidden)) {
    if (resultados.length >= MAX_RESULTADOS) break;
    if (args.file_glob && !arquivo.endsWith(args.file_glob)) continue;

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

    const linhas = conteudo.split('\n');
    for (let i = 0; i < linhas.length; i++) {
      if (matcher.test(linhas[i])) {
        resultados.push(`${path.relative(process.cwd(), arquivo)}:${i + 1}: ${linhas[i].trim().slice(0, 200)}`);
        if (resultados.length >= MAX_RESULTADOS) break;
      }
    }
  }

  if (!resultados.length) return `Nenhuma ocorrência de "${args.pattern}" encontrada em ${args.path || '.'}`;
  const aviso = resultados.length >= MAX_RESULTADOS ? `\n[... parando em ${MAX_RESULTADOS} resultados, refine a busca]` : '';
  return resultados.join('\n') + aviso;
}

module.exports = { declarations, execute };
