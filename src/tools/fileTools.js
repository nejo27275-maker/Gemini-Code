// src/tools/fileTools.js
'use strict';

const fs = require('fs');
const path = require('path');
const { CONFIG_PATH, MCP_PATH } = require('../config');

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

const declarations = [
  {
    name: 'read_file',
    description: 'Lê o conteúdo de um arquivo de texto do disco.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Caminho do arquivo' } },
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
    case 'read_file':
      return fs.readFileSync(args.path, 'utf8');
    case 'write_file':
      if (isProtected(args.path)) {
        return (
          'Bloqueado: este arquivo é a configuração do próprio gemini-code e não pode ' +
          'ser sobrescrito por write_file. Para mudar model/fastModel/imageModel/etc, ' +
          'peça ao usuário para rodar "gemini-code config set-model NOME" (ou o ' +
          'subcomando equivalente) — nunca edite esse arquivo diretamente.'
        );
      }
      fs.mkdirSync(path.dirname(path.resolve(args.path)), { recursive: true });
      fs.writeFileSync(args.path, args.content, 'utf8');
      return `Arquivo salvo: ${args.path}`;
    case 'list_dir': {
      const dir = args.path || '.';
      return fs.readdirSync(dir).join('\n');
    }
    default:
      throw new Error(`Ferramenta de arquivo desconhecida: ${name}`);
  }
}

module.exports = { declarations, execute };
