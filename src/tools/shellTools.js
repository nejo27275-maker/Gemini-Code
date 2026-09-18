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
const readline = require('readline');
const { loadConfig, CONFIG_PATH, MCP_PATH } = require('../config');

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

const declarations = [
  {
    name: 'run_shell',
    description: 'Executa um comando no shell do Termux/Linux e retorna a saída.',
    parameters: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
    },
  },
];

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function runCommand(command, { timeoutMs, maxBuffer }) {
  return new Promise((resolve) => {
    const child = exec(
      command,
      { encoding: 'utf8', maxBuffer, timeout: timeoutMs, killSignal: 'SIGKILL' },
      (err, stdout, stderr) => {
        if (err) {
          const motivo = err.killed
            ? `comando cancelado após ${timeoutMs}ms sem terminar (timeout)`
            : err.message;
          resolve(`Erro ao executar (${motivo}):\n${stdout || ''}${stderr || ''}`.trim());
        } else {
          resolve(stdout || stderr || '(sem saída)');
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

// Frase que precisa ser digitada por extenso para liberar um comando que
// mexe em config.json/mcp.json. Antes bastava "s"/"y" — igual à confirmação
// de qualquer outro comando — o que é fácil demais de aprovar no automático
// (reflexo de sempre apertar "s", ou um script/atalho que sempre manda "y").
// Essa é a ÚNICA confirmação do gemini-code que exige uma frase, de propósito:
// o resto continua rápido (s/n), só o caminho que já causou um incidente real
// (o agente resetando a própria config sozinho) fica com atrito extra.
const FRASE_CONFIRMACAO = 'sim, tenho certeza';

async function execute(name, args) {
  if (name !== 'run_shell') throw new Error(`Ferramenta de shell desconhecida: ${name}`);
  const cfg = loadConfig();

  const protegido = touchesProtectedFile(args.command);

  if (protegido) {
    const pergunta =
      `\n[gemini-code] ATENÇÃO: esse comando mexe no arquivo de configuração do gemini-code.\n` +
      `  ${args.command}\n` +
      `Isso já causou perda de configuração antes. Para confirmar, digite exatamente:\n` +
      `  ${FRASE_CONFIRMACAO}\n> `;
    const answer = await ask(pergunta);
    if (answer !== FRASE_CONFIRMACAO) {
      return 'Comando cancelado: frase de confirmação não digitada corretamente.';
    }
  } else if (cfg.confirmShell) {
    const pergunta = `\n[gemini-code] Rodar comando?\n  ${args.command}\n(s/n) `;
    const answer = await ask(pergunta);
    if (answer !== 's' && answer !== 'y') {
      return 'Comando cancelado pelo usuário.';
    }
  }

  return runCommand(args.command, {
    timeoutMs: cfg.shellTimeoutMs,
    maxBuffer: 1024 * 1024 * 10,
  });
}

module.exports = { declarations, execute };
