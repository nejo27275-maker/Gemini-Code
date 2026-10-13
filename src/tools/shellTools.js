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

const { exec } = require('child_process');
const { loadConfig, CONFIG_PATH, MCP_PATH } = require('../config');
const { ask } = require('../ui/prompt');

// Achado num teste (set/2026): com confirmShell:false, o agente rodou um
// "node -e ...fs.writeFileSync(configPath...)" via run_shell e reescreveu
// sozinho o config.json (voltando model/fastModel/imageModel pra valores
// sem cota grátis / já descontinuados). O write_file tem trava própria
// (fileTools.js), mas o run_shell conseguia o mesmo resultado por fora,
// sem confirmação nenhuma. Agora: qualquer comando que mencione o caminho
// do config.json ou do mcp.json força confirmação MESMO com
// confirmShell:false — essa é a única exceção ao auto-aceite.
const PROTECTED_PATHS = [CONFIG_PATH, MCP_PATH];

function touchesProtectedFile(command) {
  return PROTECTED_PATHS.some(
    (p) => command.includes(p) || command.includes(require('path').basename(p))
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
    description: 'Executa um comando no shell do Termux/Linux e retorna a saída.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        cwd: { type: 'string', description: 'Diretório onde rodar o comando (padrão: diretório atual do processo)' },
      },
      required: ['command'],
    },
  },
];

// Item 7 da revisão (set/2026): antes não dava pra escolher `cwd` (todo
// comando rodava no diretório em que o próprio agente foi iniciado — em
// tarefas de várias etapas em pastas diferentes isso obrigava a prefixar
// tudo com "cd pasta && ..."), e `stdout || stderr` escondia o stderr
// sempre que também havia stdout (comum: um comando que imprime aviso no
// stderr e ainda assim produz saída normal). Agora as duas saídas vêm
// concatenadas e identificadas, junto com o exit code.
function runCommand(command, { timeoutMs, maxBuffer, cwd }) {
  return new Promise((resolve) => {
    const child = exec(
      command,
      { encoding: 'utf8', maxBuffer, timeout: timeoutMs, killSignal: 'SIGKILL', cwd: cwd || undefined },
      (err, stdout, stderr) => {
        const partes = [];
        if (stdout) partes.push(stdout);
        if (stderr) partes.push(`[stderr]\n${stderr}`);
        const saida = partes.join('\n').trim() || '(sem saída)';

        if (err) {
          // v0.3.8: estouro do maxBuffer aparecia como "exit code ERR_CHILD_PROCESS_..."
          const motivo = err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
            ? 'a saída passou do limite de 10 MB e o comando foi interrompido — redirecione para um arquivo ou filtre com head/tail/grep'
            : err.killed
            ? `comando cancelado após ${timeoutMs}ms sem terminar (timeout)`
            : `exit code ${err.code ?? '?'}`;
          resolve(`Erro ao executar (${motivo}):\n${saida}`);
        } else {
          resolve(`${saida}\n[exit code 0]`);
        }
      }
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

async function execute(name, args) {
  if (name !== 'run_shell') throw new Error(`Ferramenta de shell desconhecida: ${name}`);
  const cfg = loadConfig();

  if (args.cwd && !require('fs').existsSync(args.cwd)) {
    return `Erro: diretório cwd não existe: ${args.cwd}`;
  }

  const protegido = touchesProtectedFile(args.command);
  const destrutivo = isDestructiveCommand(args.command);

  if (cfg.confirmShell || protegido || destrutivo) {
    const pergunta = protegido
      ? `\n[gemini-code] ATENÇÃO: esse comando mexe no arquivo de configuração do gemini-code.\n  ${args.command}\nConfirmar mesmo assim? (s/n) `
      : destrutivo
      ? `\n[gemini-code] ATENÇÃO: esse comando parece destrutivo/irreversível.\n  ${args.command}\nConfirmar mesmo assim? (s/n) `
      : `\n[gemini-code] Rodar comando?\n  ${args.command}\n(s/n) `;
    const answer = (await ask(pergunta)).toLowerCase();
    if (answer !== 's' && answer !== 'y') {
      return 'Comando cancelado pelo usuário.';
    }
  }

  return runCommand(args.command, {
    timeoutMs: cfg.shellTimeoutMs,
    maxBuffer: 1024 * 1024 * 10,
    cwd: args.cwd,
  });
}

module.exports = { declarations, execute, touchesProtectedFile, isDestructiveCommand };
