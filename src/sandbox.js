// src/sandbox.js
// v0.45.0 — sandbox do sistema operacional para o run_shell (Linux, com bubblewrap).
//
// Antes, a única barreira do run_shell era a confirmação (confirmShell) e as heurísticas de texto
// (destrutivo, arquivo protegido). Com confirmShell:false, uma regra "permitir" ou uma rotina, o comando
// rodava com todos os poderes do usuário: um texto de página da web que convencesse o modelo podia ler
// ~/.ssh, mandar a chave para fora ou deixar algo no ~/.bashrc. Agora esses comandos rodam isolados:
//   - o disco inteiro fica SÓ LEITURA, menos a pasta do projeto (e as pastas extras que o usuário liberar);
//   - /tmp e /run são vazios e descartáveis (somem com o comando, junto com os sockets do sistema);
//   - ~/.gemini-code (chave da API, tokens, regras) e as pastas de credencial comuns (~/.ssh, ~/.aws,
//     perfis de navegador...) ficam invisíveis, e variáveis de ambiente com cara de segredo não passam;
//   - sem rede (só se o usuário ligar shellSandboxRede);
//   - a pasta .git inteira fica só leitura: com ela gravável, um hook, o core.fsmonitor do .git/config ou um
//     .git/commondir apontando para outra config fariam o próximo "git" do usuário (ou o autoGit) rodar um
//     comando plantado FORA da sandbox. Commit e checkout pedem para sair dela (fora_da_sandbox);
//   - um filtro seccomp nega criar socket AF_UNIX, io_uring e o chaveiro do kernel: com o disco só leitura ainda
//     dá para CONECTAR num socket que já existe (docker.sock, D-Bus, X11, ssh-agent) e sair por ele;
//   - sem capabilities, sem criar user namespace dentro, processos isolados (PID) e nova sessão (sem TIOCSTI).
// Só Linux: Android/Termux não deixa criar namespaces e o macOS ainda não é suportado aqui.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const MODOS = Object.freeze(['off', 'auto', 'sempre']);

/** Pastas e arquivos de credencial comuns (relativos à HOME) que a sandbox esconde. */
const CREDENCIAIS_HOME = Object.freeze([
  '.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker', '.config/gcloud', '.config/gh', '.config/hub',
  '.netrc', '.git-credentials', '.npmrc', '.yarnrc', '.pypirc', '.Xauthority', '.password-store', '.pki',
  '.local/share/keyrings', '.mozilla', '.config/google-chrome', '.config/chromium', '.config/BraveSoftware',
  '.config/microsoft-edge',
]);

// Variáveis que dão acesso a algo fora da sandbox (sockets de sessão) ou que têm cara de segredo.
const VARS_FORA = new Set(['SSH_AUTH_SOCK', 'DBUS_SESSION_BUS_ADDRESS', 'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'GPG_AGENT_INFO']);
const VAR_SEGREDO = /(^|_)(API_?KEY|ACCESS_?KEY|KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|AUTH|COOKIE|SESSION)(_|$)/i;
// GIT_CONFIG_COUNT/KEY_n/VALUE_n é configuração do git passada por ambiente (pode levar um cabeçalho com token).
// Sai inteira: tirar só o KEY_n faz o git recusar todo comando ("missing config key").
const VAR_GIT_CONFIG = /^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/;

function modoDe(cfg) {
  const m = cfg && cfg.shellSandbox;
  return MODOS.includes(m) ? m : 'auto';
}

// ---------------------------------------------------------------------------
// Filtro seccomp (BPF clássico, o formato que o bwrap --seccomp lê de um descritor).
// ---------------------------------------------------------------------------
// negadas: io_uring_setup/enter/register (425-427 nos dois; cria socket por fora do seccomp) e
// add_key/request_key/keyctl (chaveiro do kernel, que fica fora do namespace).
const ARCH = {
  x64: { audit: 0xC000003E, socket: 41, x32: true, negadas: [425, 426, 427, 248, 249, 250] },
  arm64: { audit: 0xC00000B7, socket: 198, x32: false, negadas: [425, 426, 427, 217, 218, 219] },
};
const AF_UNIX = 1;
const RET_ALLOW = 0x7FFF0000;
const RET_EPERM = 0x00050000 | 1;

/** Monta o programa; os saltos são resolvidos por rótulo. Devolve null em arquitetura sem filtro. */
function filtroSeccomp(arch = process.arch) {
  const a = ARCH[arch];
  if (!a) return null;
  const prog = []; // { code, jt, jf, k } com jt/jf como rótulo ou número
  const rotulos = {};
  const ld = (off) => prog.push({ code: 0x20, jt: 0, jf: 0, k: off }); // BPF_LD|BPF_W|BPF_ABS
  const jeq = (k, jt, jf) => prog.push({ code: 0x15, jt, jf, k });
  const jge = (k, jt, jf) => prog.push({ code: 0x35, jt, jf, k });
  const ret = (k) => prog.push({ code: 0x06, jt: 0, jf: 0, k });
  const rot = (nome) => { rotulos[nome] = prog.length; };

  ld(4); // seccomp_data.arch
  jeq(a.audit, 'nativo', 'nega'); // outra ABI (32 bits): nega tudo — evita o socketcall de 32 bits
  rot('nativo');
  ld(0); // seccomp_data.nr
  if (a.x32) jge(0x40000000, 'nega', 0); // ABI x32 usa números com esse bit
  jeq(a.socket, 'socket', 0);
  for (const nr of a.negadas) jeq(nr, 'nega', 0);
  ret(RET_ALLOW);
  rot('socket'); // BPF só salta para a frente: cada caminho termina no seu próprio "ret"
  ld(16); // args[0] (família), 32 bits baixos
  jeq(AF_UNIX, 'nega', 0);
  ret(RET_ALLOW);
  rot('nega');
  ret(RET_EPERM);

  const buf = Buffer.alloc(prog.length * 8);
  prog.forEach((ins, i) => {
    const salto = (alvo) => {
      if (typeof alvo === 'number') return alvo;
      const d = rotulos[alvo] - (i + 1);
      if (!(d >= 0 && d <= 255)) throw new Error(`seccomp: salto inválido para ${alvo}`);
      return d;
    };
    buf.writeUInt16LE(ins.code, i * 8);
    buf.writeUInt8(salto(ins.jt), i * 8 + 2);
    buf.writeUInt8(salto(ins.jf), i * 8 + 3);
    buf.writeUInt32LE(ins.k >>> 0, i * 8 + 4);
  });
  return buf;
}

// ---------------------------------------------------------------------------
// Descobrir o bwrap e conferir que ele funciona AQUI (userns, seccomp e flags).
// ---------------------------------------------------------------------------
const LOCAIS_BWRAP = Object.freeze(['/usr/bin/bwrap', '/usr/local/bin/bwrap', '/bin/bwrap']);

/**
 * Onde o modelo grava sem perguntar (projeto, temporária, pastas liberadas; a HOME se o projeto a contém).
 * Um "bwrap" ali pode ter sido plantado por ele — e o gemini-code o rodaria FORA de qualquer sandbox.
 */
function areasDoModelo({ cwd = process.cwd(), home = os.homedir(), extras = [] } = {}) {
  const r = (p) => real(p) || path.resolve(p);
  const homeReal = r(home);
  const cwdReal = r(cwd);
  const lista = [r(os.tmpdir()), dentro(homeReal, cwdReal) ? homeReal : cwdReal];
  for (const d of Array.isArray(extras) ? extras : []) { const x = expandirHome(d, home); if (path.isAbsolute(x)) lista.push(r(x)); }
  return lista;
}

/** Acha o bwrap: pastas do sistema primeiro; do PATH só caminho absoluto fora das áreas do modelo e sem gravação por outros. */
function acharBwrap(env = process.env, { proibidas = [] } = {}) {
  const doPath = String(env.PATH || '').split(path.delimiter).filter((d) => path.isAbsolute(d)).map((d) => path.join(d, 'bwrap'));
  for (const p of [...LOCAIS_BWRAP, ...doPath]) {
    let r;
    let st;
    try { fs.accessSync(p, fs.constants.X_OK); r = fs.realpathSync(p); st = fs.statSync(r); } catch { continue; }
    if (!st.isFile() || (st.mode & 0o022)) continue; // gravável pelo grupo/outros: alguém pode trocar
    if (proibidas.some((d) => dentro(r, d))) continue;
    return r;
  }
  return null;
}

/** Flags de isolamento comuns (fora os mounts). */
function flagsIsolamento({ rede = false, disableUserns = true } = {}) {
  return [
    '--unshare-all', ...(rede ? ['--share-net'] : []),
    '--unshare-user', ...(disableUserns ? ['--disable-userns'] : []),
    '--die-with-parent', '--new-session', '--cap-drop', 'ALL',
  ];
}

/** Roda o bwrap com o filtro no fd 3; devolve { codigo, saida }. Nunca lança. */
function rodarSonda(arquivo, args, bpf, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let saida = '';
    let filho;
    try {
      filho = spawn(arquivo, args, { stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
    } catch (err) { return resolve({ codigo: -1, saida: err.message }); }
    const t = setTimeout(() => { try { filho.kill('SIGKILL'); } catch { /* já saiu */ } }, timeoutMs);
    filho.stdout.on('data', (d) => { saida += d; });
    filho.stderr.on('data', (d) => { saida += d; });
    filho.stdio[3].on('error', () => { /* bwrap saiu antes de ler */ });
    filho.stdio[3].end(bpf);
    filho.on('error', (err) => { clearTimeout(t); resolve({ codigo: -1, saida: err.message }); });
    filho.on('close', (codigo) => { clearTimeout(t); resolve({ codigo, saida: saida.trim() }); });
  });
}

const cache = new Map();

/**
 * A sandbox funciona nesta máquina? Resultado guardado por caminho do bwrap.
 * @returns {Promise<{ok:boolean, motivo?:string, arquivo?:string, disableUserns?:boolean}>}
 */
function verificar({ plataforma = process.platform, arch = process.arch, arquivo } = {}) {
  if (plataforma === 'android') return Promise.resolve({ ok: false, motivo: 'o Android (Termux) não deixa um app comum criar os namespaces que a sandbox usa' });
  if (plataforma === 'darwin') return Promise.resolve({ ok: false, motivo: 'no macOS a sandbox ainda não é suportada pelo gemini-code' });
  if (plataforma !== 'linux') return Promise.resolve({ ok: false, motivo: `a sandbox só existe no Linux (aqui: ${plataforma})` });
  const bpf = filtroSeccomp(arch);
  if (!bpf) return Promise.resolve({ ok: false, motivo: `sem filtro seccomp para a arquitetura ${arch}` });
  let extras = [];
  try { extras = require('./config').loadConfig().pastasGravaveis; } catch { /* sem config: só projeto e temporária */ }
  const bwrap = arquivo || acharBwrap(process.env, { proibidas: areasDoModelo({ extras }) });
  if (!bwrap) return Promise.resolve({ ok: false, motivo: 'o bubblewrap (bwrap) não está instalado — ex.: sudo apt install bubblewrap' });
  if (!cache.has(bwrap)) {
    cache.set(bwrap, (async () => {
      const base = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc'];
      const fim = ['--seccomp', '3', '--', '/bin/sh', '-c', 'true'];
      let r = await rodarSonda(bwrap, [...base, ...flagsIsolamento(), ...fim], bpf);
      if (r.codigo === 0) return { ok: true, arquivo: bwrap, disableUserns: true };
      // bwrap antigo (< 0.8) não conhece --disable-userns: funciona sem ele
      if (/disable-userns/.test(r.saida)) {
        r = await rodarSonda(bwrap, [...base, ...flagsIsolamento({ disableUserns: false }), ...fim], bpf);
        if (r.codigo === 0) return { ok: true, arquivo: bwrap, disableUserns: false };
      }
      const linha = (r.saida.split('\n').find((l) => l.trim()) || `código ${r.codigo}`).slice(0, 200);
      const dica = /uid map|Permission denied|Operation not permitted|No permissions/i.test(r.saida)
        ? ' (o sistema bloqueia user namespaces: no Ubuntu 24.04, veja o perfil do AppArmor para o bwrap)'
        : '';
      return { ok: false, motivo: `o bwrap não conseguiu isolar um comando aqui: ${linha}${dica}` };
    })());
  }
  return cache.get(bwrap);
}

function limparCache() { cache.clear(); }

// ---------------------------------------------------------------------------
// Montagem do comando
// ---------------------------------------------------------------------------
function real(p) { try { return fs.realpathSync(p); } catch { return null; } }
const dentro = (p, base) => p === base || p.startsWith(base.endsWith(path.sep) ? base : base + path.sep);

function expandirHome(p, home) {
  const s = String(p || '').trim();
  if (s === '~') return home;
  if (s.startsWith('~/')) return path.join(home, s.slice(2));
  return s;
}

/**
 * Pastas em que o comando pode gravar: a do projeto e as extras do config. Recusa a raiz, a HOME e
 * qualquer pasta que contenha a HOME (gravar ~/.bashrc é sair da sandbox no próximo terminal).
 * @returns {{gravaveis:string[], avisos:string[]}}
 */
function areasGravaveis({ projeto = process.cwd(), extras = [], home = os.homedir(), escondidos = [] } = {}) {
  const gravaveis = [];
  const avisos = [];
  const homeReal = real(home) || path.resolve(home);
  const candidatos = [{ dir: projeto, origem: 'projeto' }, ...(Array.isArray(extras) ? extras : []).map((d) => ({ dir: expandirHome(d, home), origem: 'pastasGravaveis' }))];
  for (const { dir, origem } of candidatos) {
    if (!dir || !path.isAbsolute(dir)) { avisos.push(`${origem}: "${dir}" não é um caminho absoluto — ignorado`); continue; }
    const r = real(dir);
    if (!r) { avisos.push(`${origem}: ${dir} não existe — ignorado`); continue; }
    if (!fs.statSync(r).isDirectory()) { avisos.push(`${origem}: ${dir} não é uma pasta — ignorado`); continue; }
    if (r === path.parse(r).root || dentro(homeReal, r)) {
      avisos.push(origem === 'projeto'
        ? `a pasta atual (${r}) é a raiz, a sua HOME ou contém a HOME: na sandbox ela fica só leitura — abra o gemini-code na pasta do projeto`
        : `${origem}: ${r} contém a sua HOME — ignorado`);
      continue;
    }
    if (escondidos.some((e) => dentro(r, e))) { avisos.push(`${origem}: ${r} fica numa pasta escondida pela sandbox — ignorado`); continue; }
    if (!gravaveis.includes(r)) gravaveis.push(r);
  }
  return { gravaveis, avisos };
}

/** Caminhos reais a esconder: ~/.gemini-code, os arquivos protegidos (podem ser links) e as credenciais. */
function caminhosEscondidos({ home = os.homedir(), homeDir, protegidos = [] } = {}) {
  const lista = [];
  const add = (p) => {
    const r = real(p);
    if (!r || r === '/' || lista.some((x) => dentro(r, x.caminho))) return;
    let st;
    try { st = fs.statSync(r); } catch { return; }
    if (!st.isDirectory() && !st.isFile()) return;
    lista.push({ caminho: r, pasta: st.isDirectory() });
  };
  if (homeDir) add(homeDir);
  protegidos.forEach(add);
  CREDENCIAIS_HOME.forEach((rel) => add(path.join(home, rel)));
  return lista;
}

function ambiente(env = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (VARS_FORA.has(k) || VAR_SEGREDO.test(k) || VAR_GIT_CONFIG.test(k)) continue;
    out[k] = v;
  }
  out.TMPDIR = '/tmp';
  out.GEMINI_CODE_SANDBOX = '1';
  return out;
}

/**
 * Monta a chamada do bwrap para um comando de shell.
 * @returns {{arquivo:string, args:string[], env:object, gravaveis:string[], avisos:string[], bpf:Buffer, rede:boolean}}
 */
/** O que a sandbox libera e esconde com este config (sem efeito colateral; usado também pelo "gemini-code sandbox"). */
function resumo({ cfg = {}, projeto = process.cwd(), home = os.homedir() } = {}) {
  const config = require('./config');
  const escondidos = caminhosEscondidos({
    home, homeDir: config.HOME_DIR, protegidos: [...config.PROTECTED_PATHS, ...config.SECRET_PATHS, ...config.PROTECTED_DIRS],
  });
  const { gravaveis, avisos } = areasGravaveis({
    projeto, extras: cfg.pastasGravaveis, home, escondidos: escondidos.map((e) => e.caminho),
  });
  return { rede: cfg.shellSandboxRede === true, escondidos, gravaveis, avisos };
}

function montar(comando, {
  info, cfg = {}, cwd, projeto = process.cwd(), home = os.homedir(), env = process.env,
} = {}) {
  const { rede, escondidos, gravaveis, avisos } = resumo({ cfg, projeto, home });

  const args = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp'];
  if (fs.existsSync('/run')) {
    args.push('--tmpfs', '/run');
    if (rede) {
      // o resolv.conf costuma apontar para /run (systemd-resolved, NetworkManager): sem ele, sem DNS
      const resolv = real('/etc/resolv.conf');
      if (resolv && resolv.startsWith('/run/')) args.push('--ro-bind', path.dirname(resolv), path.dirname(resolv));
    }
  }
  for (const g of gravaveis) {
    args.push('--bind', g, g);
    // .git (pasta, ou o arquivo "gitdir:" de worktree/submódulo) só leitura e impossível de renomear
    const git = path.join(g, '.git');
    let existe = false;
    try { const st = fs.lstatSync(git); existe = st.isDirectory() || st.isFile(); } catch { /* não é repositório */ }
    if (existe) args.push('--ro-bind', git, git);
  }
  for (const e of escondidos) {
    // vazio e só leitura: gravar ali falha na hora, em vez de sumir sem aviso
    if (e.pasta) args.push('--tmpfs', e.caminho, '--remount-ro', e.caminho);
    else args.push('--ro-bind', '/dev/null', e.caminho);
  }
  const dir = path.resolve(cwd || projeto);
  args.push(...flagsIsolamento({ rede, disableUserns: info.disableUserns !== false }), '--chdir', dir, '--seccomp', '3', '--', '/bin/sh', '-c', comando);
  return { arquivo: info.arquivo, args, env: ambiente(env), gravaveis, avisos, bpf: filtroSeccomp(), rede };
}

/**
 * SIGKILL em todos os descendentes de `pid` (o bwrap de fora). O bwrap de dentro só liga o --die-with-parent
 * no FIM da montagem: encerrado logo no começo, o de fora morria e o comando seguia vivo, órfão. Matar o
 * processo 1 do namespace de PID derruba tudo o que roda lá dentro. Só Linux (/proc); devolve quantos achou.
 */
function matarDescendentes(pid) {
  try {
    const porPai = new Map();
    for (const n of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(n)) continue;
      let st;
      try { st = fs.readFileSync(`/proc/${n}/stat`, 'utf8'); } catch { continue; }
      const ppid = Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[1]);
      if (!porPai.has(ppid)) porPai.set(ppid, []);
      porPai.get(ppid).push(Number(n));
    }
    const todos = [];
    const fila = [...(porPai.get(pid) || [])];
    while (fila.length) {
      const p = fila.shift();
      todos.push(p);
      fila.push(...(porPai.get(p) || []));
    }
    for (const p of todos) { try { process.kill(p, 'SIGKILL'); } catch { /* já saiu */ } }
    return todos.length;
  } catch { return 0; }
}

/** Uma linha para o modelo (e o status) dizendo o que a sandbox permite. */
function descrever({ gravaveis = [], rede = false } = {}) {
  const onde = gravaveis.length ? gravaveis.join(', ') : 'nenhuma pasta (só um /tmp descartável)';
  return `${rede ? 'com rede' : 'sem rede'}; grava só em ${onde}${gravaveis.length ? ' e num /tmp descartável' : ''} (o .git só lê); ~/.gemini-code e credenciais invisíveis`;
}

module.exports = {
  MODOS, CREDENCIAIS_HOME, LOCAIS_BWRAP, modoDe, filtroSeccomp, acharBwrap, areasDoModelo, verificar, limparCache, flagsIsolamento,
  areasGravaveis, caminhosEscondidos, ambiente, resumo, montar, descrever, matarDescendentes,
};
