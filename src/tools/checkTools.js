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
const prompt = require('../ui/prompt'); // pelo objeto: os testes trocam prompt.ask
const { paraExibir } = require('../ui/textoSeguro');
const sandbox = require('../sandbox');
const emAndamento = require('../emAndamento');

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

// v0.45.1: com `prep` (src/sandbox.js), roda pelo bwrap; sem, como sempre. `timeoutMs`: o maior entre 2 min e o
// shellTimeoutMs do config (suíte grande passava dos 2 min fixos e era morta no meio).
function rodar(cmd, cwd, { prep = null, timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let acompanhado = null; // v0.49.1: o Ctrl+C/"Parar" interrompe (src/emAndamento.js)
    const tratar = (err, stdout, stderr) => {
      if (acompanhado) acompanhado.fim();
      if (acompanhado && acompanhado.interrompido()) {
        return resolve({ ok: false, ignorado: null, interrompido: true, saida: emAndamento.textoInterrompido(stdout, stderr), motivo: 'interrompido pelo usuário' });
      }
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
    };
    if (prep) {
      const aoComecar = (filho) => { acompanhado = emAndamento.acompanhar(filho, { sandboxId: prep.id }); };
      sandbox.rodar(prep, { timeoutMs, maxBuffer: MAX_BUFFER, aoComecar }).then(({ err, stdout, stderr }) => tratar(err, stdout, stderr));
      return;
    }
    // CI=true evita o modo watch (jest/vitest/react-scripts) que ficava pendurado até o timeout.
    const filho = exec(cmd, { cwd, timeout: timeoutMs, maxBuffer: MAX_BUFFER, killSignal: 'SIGKILL', env: { ...process.env, CI: 'true' } }, tratar);
    acompanhado = emAndamento.acompanhar(filho);
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

// v0.45.1: a aprovação da sessão vale para "npm test" — mas o script por trás é do projeto e o modelo pode tê-lo
// editado DEPOIS. Mesma regra do run_shell (src/sandbox.js): o que roda sem uma pessoa aprovar NESTA chamada vai
// para a sandbox (aprovação de antes, confirmShell desligado, rotina); "sempre" isola tudo. Convidado do cowork
// (sessão "só leitura") roda os testes só na sandbox, ou com uma pergunta a cada vez se ela não existir aqui.
async function decidir(comandos, cfg) {
  const convidado = (() => { try { return require('../security').getSessionRole() === 'guest'; } catch { return false; } })();
  const modo = sandbox.modoDe(cfg);
  const info = modo === 'off' && !convidado ? null : await sandbox.verificar();
  const temSandbox = Boolean(info && info.ok);
  const semNinguem = prompt.perguntasSuspensas();
  const precisaAprovar = convidado ? !temSandbox : (cfg.confirmShell !== false && !sessao.confirmado);
  if (modo === 'sempre' && !temSandbox) {
    return { erro: `Erro: a sandbox está no modo "sempre", mas não funciona aqui (${info.motivo}). Os testes não rodaram.` };
  }
  const perguntar = precisaAprovar && !(semNinguem && temSandbox);
  const naSandbox = temSandbox && (modo === 'sempre' || convidado || !perguntar);
  if (perguntar) {
    const lista = comandos.map((c) => `  ${paraExibir(c.cmd)}`).join('\n');
    const resposta = String(await prompt.ask(`\n[gemini-code] run_checks vai executar:\n${lista}\n${convidado ? 'Permitir? (s/n) ' : 'Permitir nesta sessão? (s/n) '}`)).toLowerCase();
    if (resposta !== 's' && resposta !== 'y') return { cancelado: true };
    if (!convidado) sessao.confirmado = true;
  }
  return { naSandbox, info };
}

async function execute(name, args) {
  if (name !== 'run_checks') throw new Error(`Ferramenta de verificação desconhecida: ${name}`);
  args = args || {};
  if (args.cwd != null && typeof args.cwd !== 'string') return 'Erro: "cwd" precisa ser texto (a pasta do projeto).';
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

  let cfg = {};
  try { cfg = loadConfig() || {}; } catch { /* config ilegível: padrões seguros (pergunta) */ }
  const decisao = await decidir(comandos, cfg);
  if (decisao.erro) return decisao.erro;
  if (decisao.cancelado) return 'run_checks cancelado pelo usuário. Não rode os testes por outro meio sem o usuário pedir.';
  const timeoutMs = Math.max(TIMEOUT_MS, Number(cfg.shellTimeoutMs) || 0);

  const partes = [];
  let algumFalhou = false;
  let interrompido = false;
  for (const { label, cmd } of comandos) {
    const prep = decisao.naSandbox ? sandbox.montar(cmd, { info: decisao.info, cfg, cwd, env: { ...process.env, CI: 'true' } }) : null;
    const resultado = await rodar(cmd, cwd, { prep, timeoutMs });
    if (!resultado.ok) algumFalhou = true;
    partes.push(
      `--- ${label} (${resultado.ignorado ? `ignorado: ${resultado.ignorado}` : resultado.ok ? 'passou' : `falhou: ${resultado.motivo}`}) ---\n${resultado.saida}`
    );
    // v0.49.1: Ctrl+C/"Parar" — não começa a próxima verificação
    if (resultado.interrompido) { interrompido = true; break; }
  }
  if (interrompido) return `Verificações interrompidas pelo usuário (Ctrl+C ou "Parar"). Não rode de novo sem ele pedir.\n\n${partes.join('\n\n')}`;
  const cabecalho = algumFalhou
    ? 'Alguma verificação falhou — corrija o problema e rode run_checks de novo antes de concluir.'
    : 'Todas as verificações passaram.';
  const nota = !decisao.naSandbox ? ''
    : algumFalhou
      ? '\n[sandbox: sem rede e gravando só na pasta do projeto. Se a falha veio disso (ex.: o teste baixa algo), rode o comando com run_shell e fora_da_sandbox: true — o usuário confirma.]'
      : '\n[rodou na sandbox]';
  return `${cabecalho}\n\n${partes.join('\n\n')}${nota}`;
}

module.exports = { declarations, execute, detectarComandos, rodar, sessao };
