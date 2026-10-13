// src/tools/fileTools.js
'use strict';

const fs = require('fs');
const path = require('path');
const { CONFIG_PATH, MCP_PATH } = require('../config');
const { backupBeforeWrite } = require('./backup');
const rewind = require('../rewind');

// Achado num teste (set/2026): o agente reescreveu sozinho o config.json
// (model/fastModel/imageModel) sem o usuário pedir nem confirmar, voltando
// pra modelos sem cota grátis / já descontinuados que já tinham sido
// corrigidos antes. write_file não tinha nenhuma trava — qualquer arquivo
// valia, incluindo a própria config do gemini-code. Agora esses dois
// arquivos são protegidos: nem o modelo consegue escrever neles direto,
// só via "gemini-code config set-*" (uma ação explícita do usuário).
const PROTECTED_PATHS = [CONFIG_PATH, MCP_PATH];

function isProtected(p) {
  const resolved = path.resolve(p);
  return PROTECTED_PATHS.some((prot) => resolved === path.resolve(prot));
}

// Achado num teste (set/2026, itens 1 e 2 da revisão): read_file não tinha
// limite de tamanho nem tratamento de erro — um arquivo binário grande (ex.:
// uma imagem ou um .zip) enchia o histórico de lixo e podia estourar a cota
// de contexto do modelo numa tacada só; e um caminho inexistente ou uma
// pasta passada por engano derrubavam a chamada com uma exceção crua
// ("ENOENT..."), sem contexto nenhum pro modelo entender o que fazer a
// seguir. Agora: checa existência e tipo antes de ler, detecta binário
// olhando os primeiros bytes, e trunca com aviso explícito em vez de
// silencioso.
const MAX_READ_CHARS = 200 * 1024; // 200 KB de texto
// v0.3.8: readFileSync carregava arquivos gigantes (logs de GB) inteiros na memória só para truncar depois.
const MAX_READ_BYTES = 50 * 1024 * 1024;
const MAX_LIST_ENTRIES = 500;

// v0.3.6: a mensagem de truncamento já mandava "leia em partes", mas não
// existia nenhum jeito de ler em partes — o modelo ficava sem saída em
// arquivos grandes. Intervalo 1-based e inclusivo, linhas numeradas para o
// modelo conseguir apontar exatamente onde editar.
function lerIntervalo(text, args) {
  const linhas = text.split('\n');
  const total = linhas.length;
  const ini = args.start_line == null ? 1 : Math.floor(Number(args.start_line));
  const fim = args.end_line == null ? total : Math.floor(Number(args.end_line));
  if (Number.isFinite(ini) && ini > total) return `Erro: start_line (${ini}) passa do fim do arquivo, que tem ${total} linhas.`;
  if (!Number.isFinite(ini) || !Number.isFinite(fim) || ini < 1 || fim < ini) {
    return `Erro: intervalo inválido (start_line=${args.start_line}, end_line=${args.end_line}). Use inteiros com 1 <= start_line <= end_line.`;
  }
  const ate = Math.min(fim, total);
  const largura = String(ate).length;
  let saida = linhas
    .slice(ini - 1, ate)
    .map((l, i) => `${String(ini + i).padStart(largura)}\t${l}`)
    .join('\n');
  if (saida.length > MAX_READ_CHARS) {
    saida = saida.slice(0, MAX_READ_CHARS) + '\n[... trecho truncado: peça um intervalo menor]';
  }
  return `${saida}\n[linhas ${ini}-${ate} de ${total}]`;
}

const declarations = [
  {
    name: 'read_file',
    description:
      'Lê o conteúdo de um arquivo de texto do disco. Para arquivos grandes, use start_line/end_line ' +
      '(1-based, inclusivo) para ler só um trecho; com um intervalo, as linhas voltam numeradas.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho do arquivo' },
        start_line: { type: 'integer', description: 'Primeira linha a ler (1 = início do arquivo)' },
        end_line: { type: 'integer', description: 'Última linha a ler (inclusiva)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Cria ou sobrescreve um arquivo de texto no disco.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description:
      'Substitui um trecho exato (old_text) por new_text num arquivo existente, sem reescrever ' +
      'o arquivo inteiro. old_text precisa ocorrer exatamente uma vez no arquivo — inclua contexto ' +
      'suficiente (linhas ao redor) para garantir isso.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_text: { type: 'string', description: 'Trecho exato a ser substituído (deve ser único no arquivo)' },
        new_text: { type: 'string', description: 'Texto que entra no lugar' },
      },
      required: ['path', 'old_text', 'new_text'],
    },
  },
  {
    name: 'list_dir',
    description: 'Lista arquivos e pastas de um diretório.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Diretório (padrão: .)' } },
    },
  },
];

async function execute(name, args) {
  switch (name) {
    case 'read_file': {
      // v0.3.8: path ausente fazia path.resolve lançar um TypeError cru.
      if (typeof args.path !== 'string' || !args.path) return 'Erro: read_file precisa de "path".';
      const p = path.resolve(args.path);
      if (!fs.existsSync(p)) return `Erro: arquivo não existe: ${args.path}`;
      const stat = fs.statSync(p);
      if (stat.isDirectory()) return `Erro: "${args.path}" é um diretório, não um arquivo — use list_dir.`;
      if (stat.size > MAX_READ_BYTES) {
        return `Erro: "${args.path}" tem ${stat.size} bytes (limite de leitura: ${MAX_READ_BYTES}). Use search_files ou run_shell (ex.: sed -n '1,200p' arquivo) para ver só um trecho.`;
      }
      const buf = fs.readFileSync(p);
      // Heurística simples de binário: byte nulo nos primeiros 8000 bytes.
      if (buf.subarray(0, 8000).includes(0)) {
        return `Erro: "${args.path}" parece ser um arquivo binário (${stat.size} bytes) — não lido como texto.`;
      }
      const text = buf.toString('utf8');
      if (args.start_line != null || args.end_line != null) {
        return lerIntervalo(text, args);
      }
      if (text.length > MAX_READ_CHARS) {
        return (
          text.slice(0, MAX_READ_CHARS) +
          `\n\n[... arquivo truncado: mostrando os primeiros ${MAX_READ_CHARS} de ${text.length} caracteres. ` +
          'Use search_files ou read_file com start_line/end_line para ler o resto.]'
        );
      }
      return text;
    }
    case 'write_file':
      if (typeof args.path !== 'string' || !args.path) return 'Erro: write_file precisa de "path".';
      // Antes, um `content` ausente gravava a string "undefined" no arquivo.
      if (typeof args.content !== 'string') return 'Erro: write_file precisa de "content" (texto). Nada foi gravado.';
      if (isProtected(args.path)) {
        return (
          'Bloqueado: este arquivo é a configuração do próprio gemini-code e não pode ' +
          'ser sobrescrito por write_file. Para mudar model/fastModel/imageModel/etc, ' +
          'peça ao usuário para rodar "gemini-code config set-model NOME" (ou o ' +
          'subcomando equivalente) — nunca edite esse arquivo diretamente.'
        );
      }
      fs.mkdirSync(path.dirname(path.resolve(args.path)), { recursive: true });
      rewind.registrar(args.path);
      const backupW = backupBeforeWrite(args.path);
      fs.writeFileSync(args.path, args.content, 'utf8');
      return backupW
        ? `Arquivo salvo: ${args.path} (backup do conteúdo anterior em ${backupW})`
        : `Arquivo salvo: ${args.path}`;
    case 'edit_file': {
      if (typeof args.path !== 'string' || !args.path) return 'Erro: edit_file precisa de "path".';
      if (isProtected(args.path)) {
        return 'Bloqueado: este arquivo é a configuração do próprio gemini-code e não pode ser editado diretamente.';
      }
      if (typeof args.old_text !== 'string' || args.old_text === '') {
        return 'Erro: old_text não pode ser vazio — informe o trecho exato a substituir.';
      }
      if (typeof args.new_text !== 'string') return 'Erro: edit_file precisa de "new_text" (pode ser string vazia para apagar o trecho).';
      const p = path.resolve(args.path);
      if (!fs.existsSync(p)) return `Erro: arquivo não existe: ${args.path} (use write_file para criar um novo).`;
      const src = fs.readFileSync(p, 'utf8');
      const n = src.split(args.old_text).length - 1;
      if (n === 0) {
        // v0.3.8: arquivo com CRLF nunca casa com um old_text multilinha escrito com \n.
        if (src.includes('\r\n') && args.old_text.includes('\n') && !args.old_text.includes('\r\n')) {
          return 'Erro: old_text não encontrado — o arquivo usa quebras de linha CRLF (\\r\\n). Inclua \\r\\n no old_text ou edite uma linha só por vez.';
        }
        return 'Erro: old_text não encontrado no arquivo (confira espaços, indentação e quebras de linha).';
      }
      if (n > 1) return `Erro: old_text aparece ${n} vezes no arquivo — inclua mais contexto ao redor para ficar único.`;
      const idx = src.indexOf(args.old_text);
      const novo = src.slice(0, idx) + args.new_text + src.slice(idx + args.old_text.length);
      rewind.registrar(p);
      const backupE = backupBeforeWrite(p);
      fs.writeFileSync(p, novo, 'utf8');
      return backupE
        ? `Editado: ${args.path} (backup do conteúdo anterior em ${backupE})`
        : `Editado: ${args.path}`;
    }
    case 'list_dir': {
      const dir = args.path || '.';
      if (!fs.existsSync(dir)) return `Erro: diretório não existe: ${dir}`;
      if (!fs.statSync(dir).isDirectory()) return `Erro: "${dir}" não é um diretório.`;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      if (!entries.length) return '(vazio)';
      const nomes = entries
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort((a, b) => (a.endsWith('/') === b.endsWith('/') ? a.localeCompare(b) : a.endsWith('/') ? -1 : 1));
      // v0.3.8: pastas com milhares de itens (node_modules, cache) enchiam o contexto.
      if (nomes.length > MAX_LIST_ENTRIES) {
        return nomes.slice(0, MAX_LIST_ENTRIES).join('\n') + `\n[... mostrando ${MAX_LIST_ENTRIES} de ${nomes.length} itens]`;
      }
      return nomes.join('\n');
    }
    default:
      throw new Error(`Ferramenta de arquivo desconhecida: ${name}`);
  }
}

module.exports = { declarations, execute, isProtected };
