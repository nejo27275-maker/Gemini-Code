// src/tools/index.js
'use strict';

const fileTools = require('./fileTools');
const shellTools = require('./shellTools');
const searchTools = require('./searchTools');
const checkTools = require('./checkTools');
const mcpClient = require('./mcpClient');
const subagent = require('../subagent');
const skillLoader = require('../skills/loader');
const todoTools = require('./todoTools');
const workflowTools = require('./workflowTools');

/**
 * @param {string[]} [allowedNames] Se informado, só devolve as ferramentas
 *   cujo nome está nessa lista (usado pelos agentes/personas de agents/*.json,
 *   campo "allowedTools"). Sem lista, devolve todas (comportamento antigo).
 */
async function getAllDeclarations(allowedNames) {
  // Evita iniciar/consultar servidores MCP quando o perfil de permissão
  // só admite ferramentas locais (ex.: run --read-only). Só carregamos MCP
  // se não houver restrição ou se a allowlist pedir explicitamente uma delas.
  const needsMcp = !allowedNames || !allowedNames.length || allowedNames.some((name) => name.startsWith('mcp__'));
  const mcpDecls = needsMcp ? await mcpClient.declarationsForGemini() : [];
  const all = [
    ...fileTools.declarations,
    ...shellTools.declarations,
    ...searchTools.declarations,
    ...checkTools.declarations,
    ...todoTools.declarations,
    ...workflowTools.declarations,
    ...skillLoader.declarations,
    ...subagent.declarations,
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
  if (searchTools.declarations.some((d) => d.name === name)) return searchTools.execute(name, args);
  if (checkTools.declarations.some((d) => d.name === name)) return checkTools.execute(name, args);
  if (todoTools.declarations.some((d) => d.name === name)) return todoTools.execute(name, args);
  if (workflowTools.declarations.some((d) => d.name === name)) return workflowTools.execute(name, args, { allowedPai: allowedNames });
  if (skillLoader.declarations.some((d) => d.name === name)) return skillLoader.execute(name, args);
  if (subagent.declarations.some((d) => d.name === name)) return subagent.execute(name, args, { allowedPai: allowedNames });
  if (name.startsWith('mcp__')) return mcpClient.execute(name, args);
  throw new Error(`Ferramenta desconhecida: ${name}`);
}

module.exports = { getAllDeclarations, execute, stopMcp: mcpClient.stopAll };
