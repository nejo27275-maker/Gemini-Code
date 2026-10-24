// src/tools/checkTools.js
// Item 1 do roadmap "top 1" (set/2026): antes o agente editava arquivos e
// parava por ali — se a mudança quebrasse um teste ou o lint, só o usuário
// ia descobrir depois, rodando manualmente. `run_checks` dá ao modelo uma
// ferramenta pra rodar os testes/lint do PRÓPRIO projeto que ele está
// editando (detectado pelo cwd, não o do gemini-code) logo depois de mexer
// em código, e o system prompt (ver agent.js) instrui o modelo a chamar
// isso e tentar corrigir sozinho antes de dar a tarefa por concluída.
//
// Detecção deliberadamente simples (só olha arquivos marcadores no cwd) —
// não tenta adivinhar frameworks exóticos. Sem marcador conhecido, devolve
// uma mensagem dizendo isso, em vez de inventar um comando.
'use strict';

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { loadConfig } = require('../config');
const { ask } = require('../ui/prompt');
const { paraExibir } = require('../ui/textoSeguro');

const TIMEOUT_MS = 120000;
const MAX_BUFFER = 1024 * 1024 * 10;

// Ordem importa: primeiro achado vence. Cada entrada roda só se o arquivo
// marcador existir no cwd.
function detectarComandos(cwd) {
  const tem = (nome) => fs.existsSync(path.join(cwd, nome));
  const comandos = [];

  if (tem('package.json')) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
      const scripts = pkg.scripts || {};
      // v0.3.7: o `npm init` gera "test": "echo \"Error: no test specified\" && exit 1".
      // Rodar isso sempre "falhava" e mandava o agente atrás de um erro
      // que não existe — script de teste de mentira não conta.
      if (scripts.test && !/no test specified/i.test(scripts.test)) comandos.push({ label: 'npm test', cmd: 'npm test' });
      if (scripts.lint) comandos.push({ label: 'npm run lint', cmd: 'npm run lint' });
    } catch { /* package.json inválido: ignora este marcador */ }
  }
  if (tem('pytest.ini') || tem('pyproject.toml') || tem('setup.py') || tem('requirements.txt')) {
    comandos.push({ label: 'pytest', cmd: 'python3 -m pytest -q' });
  }
  // v0.3.8: sem alvo "test" o make falha com "No rule to make target" — o mesmo
  // tipo de falso alarme que a v0.3.7 corrigiu no npm/pytest.
  if (tem('Makefile')) {
    try {
      if (/^test\s*:/m.test(fs.readFileSync(path.join(cwd, 'Makefile'), 'utf8'))) {
        comandos.push({ label: 'make test', cmd: 'make test' });
      }
    } catch { /* Makefile ilegível: ignora */ }
  }

  return comandos;
}

function rodar(cmd, cwd) {
  return new Promise((resolve) => {
    // CI=true evita o modo watch (jest/vitest/react-scripts) que ficava pendurado até o timeout.
    exec(cmd, { cwd, timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, killSignal: 'SIGKILL', env: { ...process.env, CI: 'true' } }, (err, stdout, stderr) => {
      const saida = [stdout, stderr].filter(Boolean).join('\n').trim() || '(sem saída)';
      // v0.3.7: nem todo exit code != 0 é falha do código do usuário.
      //  - pytest sai com 5 quando não encontrou nenhum teste;
      //  - "No module named pytest" = ferramenta não instalada, não teste quebrado.
      let ignorado = null;
      if (err && /pytest/.test(cmd)) {
        if (err.code === 5) ignorado = 'nenhum teste encontrado';
        else if (/No module named pytest/i.test(saida)) ignorado = 'pytest não está instalado (pip install pytest)';
      }
      resolve({
        ok: !err || !!ignorado,
        ignorado,
        saida,
        motivo: err ? (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'saída grande demais' : err.killed ? 'timeout' : `exit code ${err.code ?? '?'}`) : null,
      });
    });
  });
}

const declarations = [
  {
    name: 'run_checks',
    description:
      'Roda os testes e/ou lint do projeto atual (detectados automaticamente por arquivos como ' +
      'package.json, pytest.ini, Makefile no diretório). Use depois de editar código, para verificar ' +
      'se a mudança quebrou algo, antes de considerar a tarefa concluída. Se falhar, tente corrigir e ' +
      'rode de novo.',
    parameters: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Diretório do projeto a verificar (padrão: diretório atual)' },
      },
    },
  },
];

// v0.3.9: run_checks executa npm test / make test — ou seja, scripts do
// package.json que o próprio modelo pode ter acabado de editar — sem passar
// pela confirmação do run_shell. Agora, com confirmShell ligado, pergunta UMA
// vez por sessão (mostrando os comandos exatos) antes da primeira execução.
const sessao = { confirmado: false };

async function confirmarSeNecessario(comandos) {
  if (sessao.confirmado) return true;
  let confirmShell = true;
  try { confirmShell = loadConfig().confirmShell !== false; } catch { /* config ilegível: fica no seguro */ }
  if (!confirmShell) return true;
  const lista = comandos.map((c) => `  ${paraExibir(c.cmd)}`).join('\n');
  const resposta = (await ask(`\n[gemini-code] run_checks vai executar:\n${lista}\nPermitir nesta sessão? (s/n) `)).toLowerCase();
  if (resposta === 's' || resposta === 'y') {
    sessao.confirmado = true;
    return true;
  }
  return false;
}

async function execute(name, args) {
  if (name !== 'run_checks') throw new Error(`Ferramenta de verificação desconhecida: ${name}`);
  const cwd = args.cwd || process.cwd();
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    return `Erro: diretório não existe: ${cwd}`;
  }

  const comandos = detectarComandos(cwd);
  if (!comandos.length) {
    return (
      'Nenhum comando de teste/lint reconhecido neste diretório (procurei package.json com script ' +
      '"test"/"lint", pytest.ini/pyproject.toml/setup.py/requirements.txt, ou Makefile com alvo "test"). ' +
      'Se o projeto tiver uma forma própria de rodar testes, use run_shell diretamente.'
    );
  }

  if (!(await confirmarSeNecessario(comandos))) return 'run_checks cancelado pelo usuário. Não rode os testes por outro meio sem o usuário pedir.';

  const partes = [];
  let algumFalhou = false;
  for (const { label, cmd } of comandos) {
    const resultado = await rodar(cmd, cwd);
    if (!resultado.ok) algumFalhou = true;
    partes.push(
      `--- ${label} (${resultado.ignorado ? `ignorado: ${resultado.ignorado}` : resultado.ok ? 'passou' : `falhou: ${resultado.motivo}`}) ---\n${resultado.saida}`
    );
  }
  const cabecalho = algumFalhou
    ? 'Alguma verificação falhou — corrija o problema e rode run_checks de novo antes de concluir.'
    : 'Todas as verificações passaram.';
  return `${cabecalho}\n\n${partes.join('\n\n')}`;
}

module.exports = { declarations, execute, detectarComandos, rodar, sessao };
