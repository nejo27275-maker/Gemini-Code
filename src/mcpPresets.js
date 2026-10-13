// src/mcpPresets.js (v0.34.0)
// `gemini-code mcp ...`: instala/remove/lista servidores MCP prontos (Spotify, Blender, Roblox Studio) em
// ~/.gemini-code/mcp.json sem editar JSON na mão. Tudo aqui devolve TEXTO (testável); o bin só imprime.
// Segredos nunca são impressos: `list` mascara chaves/tokens/senhas.
'use strict';

const fs = require('fs');
const path = require('path');

const PLACEHOLDER = 'COLE_AQUI';

// ---- presets -------------------------------------------------------------------------------------------
// Nomes de servidor e comandos conferidos nas páginas oficiais em out/2026 (README do ahujasid/blender-mcp, do
// varunneal/spotify-mcp e a doc "Connect to the Roblox Studio MCP server" em create.roblox.com).
const PRESETS = {
  spotify: {
    resumo: 'Spotify: buscar música, tocar/pausar, fila e playlists (controle de reprodução exige Premium).',
    flags: ['client-id', 'client-secret', 'redirect'],
    montar(f, env) {
      const id = f['client-id'] || env.SPOTIFY_CLIENT_ID || PLACEHOLDER;
      const secret = f['client-secret'] || env.SPOTIFY_CLIENT_SECRET || PLACEHOLDER;
      return {
        command: 'uvx',
        args: ['--python', '3.12', '--from', 'git+https://github.com/varunneal/spotify-mcp', 'spotify-mcp'],
        env: { SPOTIFY_CLIENT_ID: id, SPOTIFY_CLIENT_SECRET: secret, SPOTIFY_REDIRECT_URI: f.redirect || 'http://127.0.0.1:8080/callback' },
      };
    },
    notas: [
      'Crie um app em https://developer.spotify.com/dashboard e use como Redirect URI exatamente o valor de SPOTIFY_REDIRECT_URI (precisa ser http e 127.0.0.1).',
      'Rode `gemini-code mcp add spotify --client-id ID --client-secret SEGREDO` ou deixe SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET no ambiente antes de adicionar (assim o segredo não fica no histórico do terminal).',
      'Precisa do `uv` (uvx) e do `git`. No Termux tente `pkg install uv git` (ou `pip install uv`). Tocar/pausar exige conta Premium e um aparelho Spotify ativo.',
      'Na primeira vez o Spotify pede autorização no navegador. Não testei esse login dentro do Termux.',
    ],
  },
  blender: {
    resumo: 'Blender: criar/editar cenas 3D, materiais e rodar Python dentro do Blender aberto.',
    flags: ['host', 'port'],
    montar(f) {
      return {
        command: 'uvx',
        args: ['blender-mcp'],
        env: { BLENDER_HOST: f.host || 'localhost', BLENDER_PORT: String(f.port || 9876), DISABLE_TELEMETRY: 'true' },
        confirmar: ['execute'],
      };
    },
    notas: [
      'O Blender precisa estar ABERTO com o addon "Interface: Blender MCP" ligado (instale com `uvx blender-mcp install-addon`; na barra lateral do 3D View clique em conectar).',
      'O Blender não roda no Android. Use no computador, ou no celular aponte para o PC com `--host IP_DO_PC` (o PC precisa aceitar a conexão; não verifiquei se o addon escuta fora de localhost).',
      'A telemetria do servidor vem DESLIGADA (DISABLE_TELEMETRY=true). A ferramenta que roda Python no Blender pede confirmação (s/n) a cada uso.',
    ],
  },
  roblox: {
    resumo: 'Roblox Studio: ler a árvore do jogo, editar scripts, inserir modelos, rodar Luau e playtest.',
    flags: ['ssh', 'launcher'],
    montar(f) {
      const launcher = f.launcher || '%LOCALAPPDATA%\\Roblox\\mcp.bat';
      if (f.ssh) {
        return {
          command: 'ssh',
          args: ['-T', '-o', 'BatchMode=yes', f.ssh, `cmd.exe /c ${launcher}`],
          confirmar: ['execute', 'run_code', 'luau'],
        };
      }
      return { command: 'cmd.exe', args: ['/c', launcher], confirmar: ['execute', 'run_code', 'luau'] };
    },
    notas: [
      'Usa o servidor MCP EMBUTIDO no Roblox Studio (o antigo studio-rust-mcp-server foi descontinuado pela Roblox). No Studio: Assistente → ⋯ → Gerenciar servidores MCP → ligue "Enable Studio as MCP server".',
      'O padrão é o caminho do Windows (%LOCALAPPDATA%\\Roblox\\mcp.bat). Em outro sistema passe `--launcher CAMINHO`.',
      'O Studio não roda no Android. No celular, rode isto via SSH no PC: `--ssh usuario@IP_DO_PC` (precisa de servidor OpenSSH no Windows e login por chave, sem senha). Não testei esse caminho.',
      'Não confirmei os nomes exatos das ferramentas de execução de código do Roblox; por isso confirmo as que contêm "execute", "run_code" ou "luau". Para confirmar TODAS, edite o mcp.json e troque por "confirmar": ["*"].',
    ],
  },
};

// ---- util ----------------------------------------------------------------------------------------------
function lerFlags(args) {
  const flags = {}; const posicionais = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const prox = args[i + 1];
      if (prox !== undefined && !prox.startsWith('--')) { flags[k] = prox; i++; } else flags[k] = true;
    } else posicionais.push(a);
  }
  return { flags, posicionais };
}

function lerMcp(mcpPath) {
  if (!fs.existsSync(mcpPath)) return { mcpServers: {} };
  const bruto = JSON.parse(fs.readFileSync(mcpPath, 'utf8')); // JSON quebrado: deixa lançar (não sobrescrever!)
  if (!bruto || typeof bruto !== 'object') throw new Error('mcp.json inválido (não é um objeto).');
  if (!bruto.mcpServers || typeof bruto.mcpServers !== 'object') bruto.mcpServers = {};
  return bruto;
}

function gravarMcp(mcpPath, dados) {
  fs.mkdirSync(path.dirname(mcpPath), { recursive: true });
  if (fs.existsSync(mcpPath)) { try { fs.copyFileSync(mcpPath, `${mcpPath}.bak`); } catch { /* sem backup: segue */ } }
  const tmp = `${mcpPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(dados, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, mcpPath);
  try { fs.chmodSync(mcpPath, 0o600); } catch { /* best-effort (pode haver segredos) */ }
}

const SEGREDO = /(secret|token|password|senha|key)/i;
function mascarar(env = {}) {
  return Object.entries(env).map(([k, v]) => `${k}=${SEGREDO.test(k) ? (String(v).startsWith(PLACEHOLDER) ? PLACEHOLDER + ' (falta preencher)' : '********') : v}`).join(', ');
}

function temNoPath(cmd, pathEnv = process.env.PATH || '') {
  if (!cmd) return false;
  if (cmd.includes('/') || cmd.includes('\\')) return fs.existsSync(cmd);
  const exts = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
  return pathEnv.split(path.delimiter).some((d) => d && exts.some((e) => fs.existsSync(path.join(d, cmd + e))));
}

function problemas(nome, e, pathEnv) {
  const r = [];
  if (!e || typeof e.command !== 'string') return [`${nome}: sem "command".`];
  for (const [k, v] of Object.entries(e.env || {})) if (String(v).startsWith(PLACEHOLDER)) r.push(`${nome}: falta preencher ${k}.`);
  if (!temNoPath(e.command, pathEnv)) r.push(`${nome}: comando "${e.command}" não encontrado no PATH.`);
  return r;
}

// ---- comandos ------------------------------------------------------------------------------------------
function comando(args, { mcpPath, env = process.env, pathEnv } = {}) {
  const [sub, ...resto] = args;
  const { flags, posicionais } = lerFlags(resto);

  if (!sub || sub === 'presets') {
    return ['Presets de MCP prontos (use: gemini-code mcp add NOME):',
      ...Object.entries(PRESETS).map(([n, p]) => `  ${n.padEnd(8)} ${p.resumo}`),
      '', 'Outros: mcp list | mcp on|off NOME | mcp remove NOME | mcp check'].join('\n');
  }

  if (sub === 'add') {
    const nome = posicionais[0];
    const p = PRESETS[nome];
    if (!p) return `Preset desconhecido: "${nome || ''}". Disponíveis: ${Object.keys(PRESETS).join(', ')}.`;
    const desconhecidas = Object.keys(flags).filter((k) => k !== 'forcar' && !p.flags.includes(k));
    if (desconhecidas.length) return `Opção(ões) não existe(m) para ${nome}: ${desconhecidas.map((k) => '--' + k).join(', ')}. Aceita: ${p.flags.map((k) => '--' + k).join(' ')} --forcar`;
    for (const k of p.flags) if (flags[k] === true) return `A opção --${k} precisa de um valor.`;
    if (flags.port !== undefined && !(Number(flags.port) >= 1 && Number(flags.port) <= 65535)) return 'Porta inválida (use 1-65535).';
    const dados = lerMcp(mcpPath);
    if (dados.mcpServers[nome] && !flags.forcar) return `Já existe um servidor "${nome}" no mcp.json. Use --forcar para substituir (o arquivo antigo fica em mcp.json.bak).`;
    const entrada = p.montar(flags, env);
    dados.mcpServers[nome] = entrada;
    gravarMcp(mcpPath, dados);
    const falta = problemas(nome, entrada, pathEnv);
    return [`Servidor "${nome}" salvo em ${mcpPath}.`, ...p.notas.map((n) => `- ${n}`),
      ...(falta.length ? ['', 'Pendências:', ...falta.map((x) => `  ! ${x}`)] : ['', 'Pronto. Abra o chat; as ferramentas aparecem como mcp__' + nome + '__*.'])].join('\n');
  }

  if (sub === 'remove' || sub === 'remover') {
    const nome = posicionais[0];
    if (!nome) return 'Uso: gemini-code mcp remove NOME';
    const dados = lerMcp(mcpPath);
    if (!dados.mcpServers[nome]) return `Não existe servidor "${nome}" no mcp.json.`;
    delete dados.mcpServers[nome];
    gravarMcp(mcpPath, dados);
    return `Servidor "${nome}" removido.`;
  }

  if (sub === 'on' || sub === 'off' || sub === 'ligar' || sub === 'desligar') {
    const ligar = sub === 'on' || sub === 'ligar';
    const nome = posicionais[0];
    if (!nome) return `Uso: gemini-code mcp ${ligar ? 'on' : 'off'} NOME`;
    const dados = lerMcp(mcpPath);
    const e = dados.mcpServers[nome];
    if (!e) return `Não existe servidor "${nome}" no mcp.json.`;
    if (ligar) delete e.desativado; else e.desativado = true;
    gravarMcp(mcpPath, dados);
    return ligar ? `Servidor "${nome}" ligado.` : `Servidor "${nome}" desligado (continua no mcp.json; não sobe nem gasta tokens). Religue com: mcp on ${nome}`;
  }

  if (sub === 'list' || sub === 'listar') {
    const s = lerMcp(mcpPath).mcpServers;
    const nomes = Object.keys(s);
    if (!nomes.length) return 'Nenhum servidor MCP configurado. Veja: gemini-code mcp presets';
    return nomes.map((n) => `${n}${s[n].desativado === true ? ' [DESLIGADO]' : ''}: ${s[n].command} ${(s[n].args || []).join(' ')}${s[n].env ? `\n    env: ${mascarar(s[n].env)}` : ''}${s[n].confirmar ? `\n    confirma antes de: ${[].concat(s[n].confirmar).join(', ')}` : ''}`).join('\n');
  }

  if (sub === 'check' || sub === 'doctor') {
    const s = lerMcp(mcpPath).mcpServers;
    const todos = Object.entries(s).filter(([, e]) => !(e && e.desativado === true)).flatMap(([n, e]) => problemas(n, e, pathEnv));
    return todos.length ? ['Pendências:', ...todos.map((x) => `  ! ${x}`)].join('\n') : `Tudo certo (${Object.keys(s).length} servidor(es); só confere preenchimento e comando no PATH, não conecta).`;
  }

  return 'Uso: gemini-code mcp presets | add NOME [opções] | list | on|off NOME | remove NOME | check';
}

module.exports = { comando, PRESETS, lerFlags, mascarar, temNoPath, PLACEHOLDER };
