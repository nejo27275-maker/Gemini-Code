// src/config.js
// Guarda e lê a configuração do usuário em ~/.gemini-code/config.json
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const ConfigManager = require('../config-manager');

const HOME_DIR = path.join(os.homedir(), '.gemini-code');
const CONFIG_PATH = path.join(HOME_DIR, 'config.json');
const MCP_PATH = path.join(HOME_DIR, 'mcp.json');
const SKILLS_DIR = path.join(HOME_DIR, 'skills');
const AGENTS_DIR = path.join(HOME_DIR, 'agents');
const WORKFLOWS_DIR = path.join(HOME_DIR, 'workflows');
const HISTORY_DIR = path.join(HOME_DIR, 'history');

const DEFAULT_CONFIG = {
  apiKey: process.env.GEMINI_API_KEY || '',
  model: 'gemini-3.1-pro-preview',
  fastModel: 'gemini-3.6-flash',
  imageModel: 'gemini-2.5-flash-image',
  confirmShell: true,
  shellTimeoutMs: 120000,
  coworkPort: 8765,
};

const configManager = new ConfigManager(CONFIG_PATH);

function ensureDirs() {
  for (const dir of [HOME_DIR, SKILLS_DIR, AGENTS_DIR, WORKFLOWS_DIR, HISTORY_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadConfig() {
  ensureDirs();
  const onDisk = configManager.load();
  if (onDisk) {
    return { ...DEFAULT_CONFIG, ...onDisk };
  }
  // nem principal nem backup existiam/eram válidos: cria do zero
  configManager.save(DEFAULT_CONFIG);
  return { ...DEFAULT_CONFIG };
}

function saveConfig(partial) {
  ensureDirs();
  const current = loadConfig();
  const merged = { ...current, ...partial };
  configManager.save(merged);
  return merged;
}

function loadMcpServers() {
  if (!fs.existsSync(MCP_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(MCP_PATH, 'utf8')).mcpServers || {};
  } catch {
    return {};
  }
}

module.exports = {
  HOME_DIR,
  CONFIG_PATH,
  MCP_PATH,
  SKILLS_DIR,
  AGENTS_DIR,
  WORKFLOWS_DIR,
  HISTORY_DIR,
  DEFAULT_CONFIG,
  ensureDirs,
  loadConfig,
  saveConfig,
  loadMcpServers,
};
