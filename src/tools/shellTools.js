// src/tools/shellTools.js
// Executa comandos de shell a pedido do modelo. Por segurança, pede
// confirmação no terminal antes de rodar qualquer coisa (a não ser que
// confirmShell:false esteja no config).
//
// Melhoria (2ª revisão, set/2026): antes usava `execSync`, que bloqueia a
// thread principal do Node por INTEIRO enquanto o comando roda. Isso
// anulava na prática o timeout de 20s do cliente MCP (o setTimeout não
// dispara com o event loop travado) e, mais grave ainda no `cowork server`,
// congelava o WebSocket inteiro — nenhum outro cliente conectado conseguia
// ser atendido enquanto um `run_shell` estivesse rodando, mesmo que fosse
// para outra tarefa. Um comando que nunca termina (ex.: o modelo digitar
// "npm run dev" ou "tail -f" por engano) travava o processo pra sempre, sem
// jeito de recuperar a não ser Ctrl+C matando tudo.
//
// Agora usa `exec` assíncrono (não bloqueia o event loop) com um timeout
// próprio configurável (`shellTimeoutMs`, padrão 2 minutos) que mata o
// comando sozinho se ele não terminar a tempo.
'use strict';

const { exec, spawn } = require('child_process');
const path = require('path');
const { loadConfig, PROTECTED_PATHS, PROTECTED_DIRS } = require('../config');
const prompt = require('../ui/prompt'); // pelo objeto: os testes trocam prompt.ask
const { paraExibir } = require('../ui/textoSeguro');
const sandbox = require('../sandbox');

// Achado num teste (set/2026): com confirmShell:false, o agente rodou um
// "node -e ...fs.writeFileSync(configPath...)" via run_shell e reescreveu
// sozinho o config.json (voltando model/fastModel/imageModel pra valores
// sem cota grátis / já descontinuados). O write_file tem trava própria
// (fileTools.js), mas o run_shell conseguia o mesmo resultado por fora,
// sem confirmação nenhuma. Agora: qualquer comando que mencione o caminho
// do config.json ou do mcp.json força confirmação MESMO com
// confirmShell:false — essa é a única exceção ao auto-aceite.
// v0.40.0: mesma lista do write_file (src/config.js), que inclui hooks.json e
// os tokens. É heurística (texto do comando), não barreira: a barreira é
// confirmShell, ligado por padrão.
// v0.42.0: pastas protegidas (agentes pessoais) pelo caminho completo ou pelo trecho ".gemini-code/aliados".
function touchesProtectedFile(command) {
  return PROTECTED_PATHS.some(
    (p) => command.includes(p) || command.includes(path.basename(p))
  ) || PROTECTED_DIRS.some(
    (d) => command.includes(d) || command.includes(path.join(path.basename(path.dirname(d)), path.basename(d)))
  );
}

// Item 2 do roadmap "top 1" (set/2026): mesmo com confirmShell:false, um
// comando que destrói dados sem chance de recuperação (apagar em massa,
// reescrever histórico do git, formatar) merece confirmação explícita —
// diferente de write_file/edit_file, aqui não dá pra fazer backup
// automático antes (o próprio comando decide o que apaga). Lista
// deliberadamente conservadora: prefere pedir confirmação a mais do que a
// menos.
const PADROES_DESTRUTIVOS = [
  /\brm\s+(-\w*r\w*f\w*|-\w*f\w*r\w*)\b/i, // rm -rf, rm -fr, rm -Rf...
  /\bgit\s+push\s+.*(--force|-f)\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+.*-[a-z]*f/i,
  /\bdrop\s+(table|database)\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  />\s*\/dev\/sd/i,
  /\btruncate\s+-s\s*0\b/i,
  /\bchmod\s+-R\s+000\b/i,
  // v0.3.6 — o padrão antigo só pegava rm -rf; faltavam variações igualmente
  // irreversíveis (e o clássico "baixa e executa").
  /\brm\b[^|;&\n]*\s(-[a-z]*r[a-z]*|--recursive)\b/i, // rm -r, rm -r -f, rm --recursive
  /\bfind\b[^|;&\n]*\s-delete\b/i,
  /\bshred\b/i,
  /\bgit\s+branch\s+(-D\b|.*--delete\s+--force)/,
  /\bgit\s+checkout\s+(--\s+)?\.(\s|$)/,
  /\bgit\s+restore\s+(?!--staged)[^|;&\n]*\./i,
  /\bgit\s+stash\s+(drop|clear)\b/i,
  /\b(curl|wget)\b[^|;&\n]*\|\s*(sudo\s+)?(ba|z)?sh\b/i, // curl ... | sh
  /\bmv\s+[^|;&\n]*\s\/dev\/null\b/i,
];

function isDestructiveCommand(command) {
  return PADROES_DESTRUTIVOS.some((re) => re.test(command));
}

const declarations = [
  {
    name: 'run_shell',
    description: 'Executa um comando no shell do Termux/Linux e retorna a saída. No Linux pode rodar numa sandbox (a saída termina com "[sandbox ...]"): sem rede, grava só na pasta do projeto e num /tmp que some depois do comando.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        cwd: { type: 'string', description: 'Diretório onde rodar o comando (padrão: diretório atual do processo)' },
        em_segundo_plano: { type: 'boolean', description: 'true para comandos que não terminam sozinhos (servidor de dev, watch): roda em segundo plano e devolve um id; veja a saída com shell_status.' },
        fora_da_sandbox: { type: 'boolean', description: 'true só se o comando falhou POR CAUSA da sandbox (precisa de rede ou de gravar fora do projeto): roda sem ela e o usuário sempre confirma antes.' },
      },
      required: ['command'],
    },
  },
  {
    name: 'shell_status',
    description: 'Mostra a saída recente e o estado de comandos iniciados com run_shell em_segundo_plano; com encerrar=true, encerra o comando. Sem id, lista todos.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Id devolvido pelo run_shell (ex.: bg1)' },
        encerrar: { type: 'boolean', description: 'true para encerrar o comando' },
        linhas: { type: 'integer', description: 'Quantas linhas finais da saída mostrar (padrão 40, máx. 400)' },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// v0.41.0 — comandos em segundo plano (servidor de dev, watch). Antes run_shell só esperava o
// comando terminar: "npm run dev" travava até o timeout e era morto. Agora roda destacado, com
// a saída num log em ~/.gemini-code/shells/, e shell_status mostra/encerra. No máximo 5 ao
// mesmo tempo; todos são encerrados quando o gemini-code sai (sem processo órfão).
// ---------------------------------------------------------------------------
const MAX_SEGUNDO_PLANO = 5;
const segundoPlano = new Map();
let proximoId = 1;

// O grupo de processos pode sobreviver ao shell que o iniciou ("npm run dev &", "a & b"): o sh sai
// com 0 e o servidor continua. Por isso o limite e o encerramento olham o GRUPO, não só o código.
function grupoVivo(item) {
  if (process.platform === 'win32') return item.codigo === null;
  try { process.kill(-item.filho.pid, 0); } catch { return false; }
  return process.platform !== 'linux' || grupoTemProcessoNaoZumbi(item.filho.pid);
}

// kill(-pgid, 0) também responde por processo zumbi (morto, esperando o init recolher) — e em contêiner
// sem init de verdade ele nunca é recolhido: o comando encerrado contaria para sempre no limite.
function grupoTemProcessoNaoZumbi(pgid) {
  const fs = require('fs');
  try {
    for (const n of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(n)) continue;
      let st;
      try { st = fs.readFileSync(`/proc/${n}/stat`, 'utf8'); } catch { continue; }
      const [estado, , pgrp] = st.slice(st.lastIndexOf(')') + 2).split(' '); // estado ppid pgrp ...
      if (Number(pgrp) === pgid && estado !== 'Z') return true;
    }
    return false;
  } catch { return true; } // sem /proc: fica com a resposta do kill
}

function encerrarGrupo(item) {
  if (item.sandbox) sandbox.matarDescendentes(item.filho.pid);
  if (process.platform === 'win32') {
    if (item.codigo === null) { try { item.filho.kill('SIGTERM'); } catch { /* já saiu */ } }
    return;
  }
  try { process.kill(-item.filho.pid, 'SIGTERM'); } catch { /* grupo já acabou */ }
}

process.on('exit', () => { for (const item of segundoPlano.values()) encerrarGrupo(item); });

function iniciarSegundoPlano(command, cwd, prep = null) {
  const ativos = [...segundoPlano.values()].filter(grupoVivo).length;
  if (ativos >= MAX_SEGUNDO_PLANO) return `Erro: já há ${ativos} comandos em segundo plano (máximo ${MAX_SEGUNDO_PLANO}). Encerre um com shell_status (encerrar: true).`;
  const fs = require('fs');
  const { HOME_DIR } = require('../config');
  const id = `bg${proximoId++}`;
  const dir = path.join(HOME_DIR, 'shells');
  fs.mkdirSync(dir, { recursive: true });
  const log = path.join(dir, `${process.pid}-${id}.log`);
  const fd = fs.openSync(log, 'a');
  // v0.45.0: na sandbox, o bwrap é o líder do grupo; com --die-with-parent o comando morre junto com ele.
  const filho = prep
    ? spawn(prep.arquivo, prep.args, { env: prep.env, detached: true, stdio: ['ignore', fd, fd, 'pipe'] })
    : spawn(command, { shell: true, cwd: cwd || undefined, detached: process.platform !== 'win32', stdio: ['ignore', fd, fd] });
  fs.closeSync(fd);
  if (prep) { filho.stdio[3].on('error', () => { /* bwrap saiu antes de ler o filtro */ }); filho.stdio[3].end(prep.bpf); }
  const item = { id, command, log, filho, inicio: Date.now(), codigo: null, sandbox: Boolean(prep) };
  filho.on('exit', (codigo, sinal) => { item.codigo = codigo === null ? `sinal ${sinal}` : codigo; });
  filho.on('error', (err) => { item.codigo = `erro: ${err.message}`; });
  segundoPlano.set(id, item);
  return `Iniciado em segundo plano${prep ? ' na sandbox' : ''}: id=${id} (pid ${filho.pid}). Veja a saída com shell_status {"id":"${id}"}; encerre com {"id":"${id}","encerrar":true}.`;
}

function ultimasLinhas(arquivo, n) {
  try {
    const fs = require('fs');
    const tam = fs.statSync(arquivo).size;
    const ler = Math.min(tam, 64 * 1024);
    const buf = Buffer.alloc(ler);
    const fd = fs.openSync(arquivo, 'r');
    fs.readSync(fd, buf, 0, ler, tam - ler);
    fs.closeSync(fd);
    const linhas = buf.toString('utf8').split('\n');
    if (linhas[linhas.length - 1] === '') linhas.pop();
    return linhas.slice(-n).join('\n') || '(sem saída ainda)';
  } catch { return '(sem saída ainda)'; }
}

function estadoDe(item, prefixo = '') {
  if (item.codigo === null) return 'rodando';
  const fim = `terminou (${prefixo}${item.codigo})`;
  return grupoVivo(item) ? `${fim}, mas deixou processos rodando no grupo — encerre com encerrar: true` : fim;
}

function statusSegundoPlano(args) {
  if (!args.id) {
    if (!segundoPlano.size) return 'Nenhum comando em segundo plano nesta sessão.';
    return [...segundoPlano.values()].map((i) => `${i.id}: ${estadoDe(i)} há ${Math.round((Date.now() - i.inicio) / 1000)}s — ${i.command}`).join('\n');
  }
  const item = segundoPlano.get(String(args.id));
  if (!item) return `Erro: não há comando em segundo plano com id "${args.id}". Chame shell_status sem id para listar.`;
  if (args.encerrar) encerrarGrupo(item);
  const n = Math.min(400, Math.max(1, Math.floor(Number(args.linhas)) || 40));
  // o grupo pode morrer antes do evento 'exit' chegar: sem código ainda, é "encerrando", não "rodando"
  const estado = args.encerrar && (item.codigo === null || grupoVivo(item)) ? 'encerrando (sinal enviado)' : estadoDe(item, 'exit ');
  return `${item.id}: ${estado} — ${item.command}\n--- últimas linhas ---\n${ultimasLinhas(item.log, n)}`;
}

// Item 7 da revisão (set/2026): antes não dava pra escolher `cwd` (todo
// comando rodava no diretório em que o próprio agente foi iniciado — em
// tarefas de várias etapas em pastas diferentes isso obrigava a prefixar
// tudo com "cd pasta && ..."), e `stdout || stderr` escondia o stderr
// sempre que também havia stdout (comum: um comando que imprime aviso no
// stderr e ainda assim produz saída normal). Agora as duas saídas vêm
// concatenadas e identificadas, junto com o exit code.
function formatarResultado(err, stdout, stderr, timeoutMs) {
  const partes = [];
  if (stdout) partes.push(stdout);
  if (stderr) partes.push(`[stderr]\n${stderr}`);
  const saida = partes.join('\n').trim() || '(sem saída)';
  if (!err) return `${saida}\n[exit code 0]`;
  // v0.3.8: estouro do maxBuffer aparecia como "exit code ERR_CHILD_PROCESS_..."
  const motivo = err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
    ? 'a saída passou do limite de 10 MB e o comando foi interrompido — redirecione para um arquivo ou filtre com head/tail/grep'
    : err.killed
    ? `comando cancelado após ${timeoutMs}ms sem terminar (timeout)`
    : `exit code ${err.code ?? '?'}`;
  return `Erro ao executar (${motivo}):\n${saida}`;
}

function runCommand(command, { timeoutMs, maxBuffer, cwd }) {
  return new Promise((resolve) => {
    const child = exec(
      command,
      { encoding: 'utf8', maxBuffer, timeout: timeoutMs, killSignal: 'SIGKILL', cwd: cwd || undefined },
      (err, stdout, stderr) => resolve(formatarResultado(err, stdout, stderr, timeoutMs))
    );
    // Timeout extra de segurança: o `timeout` do próprio `exec` já cuida de
    // matar o processo, mas alguns ambientes (ex.: certas builds de Termux)
    // não repassam SIGKILL para netos do processo filho (ex.: um `sh -c`
    // encadeando outro comando) — então garantimos aqui também.
    if (timeoutMs) {
      setTimeout(() => {
        if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
      }, timeoutMs + 2000).unref();
    }
  });
}

// v0.45.0: o mesmo que runCommand, mas pelo bwrap (src/sandbox.js). Usa spawn porque o filtro seccomp vai
// por um descritor extra (fd 3), que o exec não deixa passar. stdin fechado: nada fica esperando entrada.
function rodarNaSandbox(prep, { timeoutMs, maxBuffer }) {
  return new Promise((resolve) => {
    const saidas = [[], []];
    let tamanho = 0;
    let estourou = false;
    let expirou = false;
    let terminou = false;
    let filho;
    try {
      filho = spawn(prep.arquivo, prep.args, { env: prep.env, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
    } catch (err) {
      return resolve(formatarResultado({ code: err.code || err.message }, '', '', timeoutMs));
    }
    const matar = () => { sandbox.matarDescendentes(filho.pid); try { filho.kill('SIGKILL'); } catch { /* já saiu */ } };
    const relogio = timeoutMs ? setTimeout(() => { expirou = true; matar(); }, timeoutMs) : null;
    const acabar = (err) => {
      if (terminou) return;
      terminou = true;
      if (relogio) clearTimeout(relogio);
      resolve(formatarResultado(err, Buffer.concat(saidas[0]).toString('utf8'), Buffer.concat(saidas[1]).toString('utf8'), timeoutMs));
    };
    [filho.stdout, filho.stderr].forEach((stream, i) => stream.on('data', (d) => {
      tamanho += d.length;
      if (tamanho > maxBuffer) { estourou = true; matar(); return; }
      saidas[i].push(d);
    }));
    filho.stdio[3].on('error', () => { /* bwrap saiu antes de ler o filtro */ });
    filho.stdio[3].end(prep.bpf);
    filho.on('error', (err) => acabar({ code: err.code || err.message }));
    filho.on('close', (codigo, sinal) => acabar(
      estourou ? { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }
        : expirou ? { killed: true }
          : codigo === 0 ? null : { code: codigo ?? sinal }
    ));
  });
}

async function execute(name, args) {
  if (name === 'shell_status') return statusSegundoPlano(args || {});
  if (name !== 'run_shell') throw new Error(`Ferramenta de shell desconhecida: ${name}`);
  // Antes, command ausente estourava um TypeError cru em touchesProtectedFile.
  if (typeof args.command !== 'string' || !args.command.trim()) return 'Erro: run_shell precisa de "command" (texto não vazio).';
  const cfg = loadConfig();

  if (args.cwd && !require('fs').existsSync(args.cwd)) {
    return `Erro: diretório cwd não existe: ${args.cwd}`;
  }

  const protegido = touchesProtectedFile(args.command);
  const destrutivo = isDestructiveCommand(args.command);
  // v0.41.0: "permitir" do config dispensa a confirmação só de comando simples (ver src/permissions.js).
  const permitido = require('../permissions').shellPermitido(args.command, cfg);

  // v0.45.0: sandbox (src/sandbox.js). Regra: comando que roda SEM uma pessoa aprovar na hora roda isolado.
  //   auto (padrão): sandbox quando não há pergunta (confirmShell:false, regra "permitir") e nas rotinas —
  //     lá, em vez de recusar ("ninguém para responder"), roda isolado. Aprovado no terminal, roda normal.
  //   sempre: todo comando roda isolado, mesmo aprovado.   off: como antes da v0.45.0.
  //   fora_da_sandbox: sai dela, e SEMPRE pergunta (mesmo com confirmShell:false ou regra "permitir").
  const modo = sandbox.modoDe(cfg);
  const info = modo === 'off' ? null : await sandbox.verificar();
  const temSandbox = Boolean(info && info.ok);
  const foraPedido = args.fora_da_sandbox === true && modo !== 'off';
  const semNinguem = prompt.perguntasSuspensas();
  let perguntar = (cfg.confirmShell && !permitido) || protegido || destrutivo || foraPedido;
  let naSandbox = false;
  if (temSandbox && !foraPedido) {
    naSandbox = modo === 'sempre' || !perguntar || semNinguem;
    if (semNinguem && !protegido && !destrutivo) perguntar = false;
  }
  if (modo === 'sempre' && !temSandbox && !foraPedido) {
    return `Erro: a sandbox está no modo "sempre", mas não funciona aqui (${info.motivo}). O comando não rodou. ` +
      'Se ele precisa mesmo rodar, repita com fora_da_sandbox: true (o usuário confirma) ou peça ao usuário para instalar o bubblewrap.';
  }
  const prep = naSandbox ? sandbox.montar(args.command, { info, cfg, cwd: args.cwd }) : null;

  if (perguntar) {
    // v0.43.2: o comando aparece SEM ser interpretado pelo terminal (src/ui/textoSeguro.js) — antes um
    // "\r" + "ESC[2K" no meio dele apagava a parte perigosa da tela e o usuário confirmava outra coisa.
    const linhas = args.command.split('\n').length;
    const exibido = `${linhas > 1 ? `(comando de ${linhas} linhas)\n  ` : ''}${paraExibir(args.command)}`;
    const onde = prep ? `\n  (na sandbox: ${sandbox.descrever(prep)})` : '';
    const pergunta = protegido
      ? `\n[gemini-code] ATENÇÃO: esse comando mexe no arquivo de configuração do gemini-code.\n  ${exibido}${onde}\nConfirmar mesmo assim? (s/n) `
      : destrutivo
      ? `\n[gemini-code] ATENÇÃO: esse comando parece destrutivo/irreversível.\n  ${exibido}${onde}\nConfirmar mesmo assim? (s/n) `
      : foraPedido
      ? `\n[gemini-code] O agente quer rodar FORA da sandbox (com rede e acesso aos seus arquivos):\n  ${exibido}\nConfirmar? (s/n) `
      : `\n[gemini-code] Rodar comando?\n  ${exibido}${onde}\n(s/n) `;
    const answer = (await prompt.ask(pergunta)).toLowerCase();
    if (answer !== 's' && answer !== 'y') {
      return 'Comando cancelado pelo usuário.';
    }
  }

  if (prep) {
    const avisos = prep.avisos.length ? `[sandbox] ${prep.avisos.join('; ')}\n` : '';
    if (args.em_segundo_plano === true) return avisos + iniciarSegundoPlano(args.command, args.cwd, prep);
    const r = await rodarNaSandbox(prep, { timeoutMs: cfg.shellTimeoutMs, maxBuffer: 1024 * 1024 * 10 });
    const dica = r.startsWith('Erro')
      ? `\n[sandbox: ${sandbox.descrever(prep)}. Se o erro veio disso, repita com fora_da_sandbox: true — o usuário confirma.]`
      : `\n[sandbox: ${prep.rede ? 'com rede' : 'sem rede'}; /tmp descartável]`;
    return avisos + r + dica;
  }

  if (args.em_segundo_plano === true) return iniciarSegundoPlano(args.command, args.cwd);

  return runCommand(args.command, {
    timeoutMs: cfg.shellTimeoutMs,
    maxBuffer: 1024 * 1024 * 10,
    cwd: args.cwd,
  });
}

module.exports = { declarations, execute, touchesProtectedFile, isDestructiveCommand, MAX_SEGUNDO_PLANO };
