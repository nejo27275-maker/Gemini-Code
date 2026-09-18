// src/tools/index.js
'use strict';

const fileTools = require('./fileTools');
const shellTools = require('./shellTools');
const mcpClient = require('./mcpClient');
const skillLoader = require('../skills/loader');

/**
 * @param {string[]} [allowedNames] Se informado, só devolve as ferramentas
 *   cujo nome está nessa lista (usado pelos agentes/personas de agents/*.json,
 *   campo "allowedTools"). Sem lista, devolve todas (comportamento antigo).
 */
async function getAllDeclarations(allowedNames) {
  const mcpDecls = await mcpClient.declarationsForGemini();
  const all = [
    ...fileTools.declarations,
    ...shellTools.declarations,
    ...skillLoader.declarations,
    ...mcpDecls,
  ];
  if (!allowedNames || !allowedNames.length) return all;
  return all.filter((d) => allowedNames.includes(d.name));
}

async function execute(name, args, allowedNames) {
  if (allowedNames && allowedNames.length && !allowedNames.includes(name)) {
    throw new Error(`Ferramenta "${name}" não está liberada para este agente.`);
  }
  if (fileTools.declarations.some((d) => d.name === name)) return fileTools.execute(name, args);
  if (shellTools.declarations.some((d) => d.name === name)) return shellTools.execute(name, args);
  if (skillLoader.declarations.some((d) => d.name === name)) return skillLoader.execute(name, args);
  if (name.startsWith('mcp__')) return mcpClient.execute(name, args);
  throw new Error(`Ferramenta desconhecida: ${name}`);
}

module.exports = { getAllDeclarations, execute, stopMcp: mcpClient.stopAll };
