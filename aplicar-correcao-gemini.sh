#!/data/data/com.termux/files/usr/bin/bash
# Aplica a correção de retry/backoff (429/503) em src/gemini.js
# e a correção da frase de confirmação em src/tools/shellTools.js.
# Rode a partir de dentro de ~/gemini-code.
set -e

if [ ! -f "src/gemini.js" ]; then
  echo "Erro: rode este script de dentro da pasta ~/gemini-code"
  exit 1
fi

cat > src/gemini.js << 'GEMINI_JS_EOF'
// src/gemini.js
// Wrapper fino sobre @google/generative-ai, para não espalhar detalhes da SDK
// pelo resto do código.
'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { loadConfig } = require('./config');

function getClient() {
  const cfg = loadConfig();
  if (!cfg.apiKey) {
    throw new Error(
      'Nenhuma API key configurada. Rode: gemini-code config set-key SUA_CHAVE\n' +
      'Pegue uma chave grátis em https://aistudio.google.com/apikey'
    );
  }
  return new GoogleGenerativeAI(cfg.apiKey);
}

/**
 * Chama o modelo com histórico de mensagens + definição de ferramentas
 * (function calling), no formato usado pelo agente (agent.js).
 *
 * Bug (set/2026): mesmo chamando model.generateContent({contents}) direto
 * (pulando o startChat/sendMessage), o erro "Role 'function' is not
 * supported" continuou idêntico. Ou seja, a própria biblioteca
 * @google/generative-ai (arquivada pelo Google, sem mais atualizações)
 * reescreve o role de qualquer parte com functionResponse para "function"
 * em algum nível mais baixo, não importa por qual função da SDK a gente
 * entre. Não tem como desligar isso client-side.
 *
 * Solução: parar de usar a SDK pra essa chamada e falar direto com a API
 * REST do Google via fetch, montando o JSON à mão. Assim a gente controla
 * 100% do corpo da requisição e o role "user" (que a própria mensagem de
 * erro lista como válido) realmente vai pro Google do jeito que definimos
 * em agent.js, sem nenhuma camada no meio reescrevendo nada.
 *
 * Retry/backoff (adicionado depois da revisão): erro 429 (cota estourada,
 * bem comum no tier grátis) e 503 (servidor sobrecarregado do lado do
 * Google) são passageiros — antes qualquer um dos dois derrubava a
 * resposta na hora, mesmo quando esperar alguns segundos resolveria
 * sozinho. Agora a gente tenta de novo automaticamente, com backoff
 * exponencial, respeitando o "retryDelay" que o próprio Google manda no
 * corpo do erro 429 quando existe (campo RetryInfo), e sem tentar de novo
 * em erros que não vão se resolver sozinhos (400, 401, 403 etc.).
 */
const RETRY_STATUS = new Set([429, 503]);
const MAX_RETRIES = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Extrai o retryDelay ("26s", "1.5s" etc.) que o Google manda no RetryInfo. */
function retryDelayMsFromError(data) {
  const details = data?.error?.details || [];
  const retryInfo = details.find((d) => d['@type']?.includes('RetryInfo'));
  const raw = retryInfo?.retryDelay; // ex.: "26s"
  if (!raw) return null;
  const seconds = parseFloat(raw);
  return Number.isFinite(seconds) ? Math.ceil(seconds * 1000) : null;
}

async function fetchComRetry(url, options) {
  let lastErr;
  for (let tentativa = 0; tentativa <= MAX_RETRIES; tentativa++) {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));

    if (res.ok) return data;

    const msg = data?.error?.message || JSON.stringify(data) || res.statusText;
    lastErr = new Error(
      `[GoogleGenerativeAI Error]: Error fetching from ${url}: [${res.status} Bad Request] ${msg}`
    );

    const podeTentarDeNovo = RETRY_STATUS.has(res.status) && tentativa < MAX_RETRIES;
    if (!podeTentarDeNovo) throw lastErr;

    // Usa o retryDelay do Google se ele vier; senão, backoff exponencial
    // (2s, 4s, 8s) com um pouco de variação pra não sincronizar tentativas.
    const sugerido = retryDelayMsFromError(data);
    const espera = sugerido ?? 2000 * 2 ** tentativa + Math.random() * 500;
    console.error(
      `[gemini] ${res.status} — tentando de novo em ${Math.round(espera / 1000)}s ` +
      `(tentativa ${tentativa + 1}/${MAX_RETRIES})...`
    );
    await sleep(espera);
  }
  throw lastErr;
}

async function chatWithTools({ modelName, systemInstruction, history, tools }) {
  const cfg = loadConfig();
  if (!cfg.apiKey) {
    throw new Error(
      'Nenhuma API key configurada. Rode: gemini-code config set-key SUA_CHAVE\n' +
      'Pegue uma chave grátis em https://aistudio.google.com/apikey'
    );
  }

  const model = modelName || cfg.model;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const body = {
    contents: history,
    ...(tools && tools.length ? { tools: [{ functionDeclarations: tools }] } : {}),
    ...(systemInstruction
      ? { systemInstruction: { parts: [{ text: systemInstruction }] } }
      : {}),
  };

  const data = await fetchComRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': cfg.apiKey,
    },
    body: JSON.stringify(body),
  });

  const parts = data?.candidates?.[0]?.content?.parts || [];

  // Objeto de resposta compatível com o que agent.js já espera
  // (response.text(), response.functionCalls() e response.rawParts()).
  return {
    text: () =>
      parts
        .filter((p) => typeof p.text === 'string')
        .map((p) => p.text)
        .join(''),
    functionCalls: () => {
      // Preserva o "id" que o Gemini 3.5+ manda em cada functionCall — a
      // documentação atual do Google exige devolver esse mesmo id na
      // functionResponse; sem ele, o turno seguinte é rejeitado (às vezes
      // com uma mensagem de erro enganosa sobre "role" em vez de citar o
      // id faltando).
      const calls = parts
        .filter((p) => p.functionCall)
        .map((p) => ({
          name: p.functionCall.name,
          args: p.functionCall.args || {},
          id: p.functionCall.id,
        }));
      return calls.length ? calls : undefined;
    },
    // Parts crus exatamente como o Google devolveu (preserva id,
    // thoughtSignature e qualquer outro campo que a gente não conheça —
    // reconstruir esse objeto à mão, como fazíamos antes, jogava esses
    // campos fora e quebrava o turno seguinte).
    rawParts: () => parts,
  };
}

/** Chamada simples de texto, sem ferramentas (usada por design/media helpers). */
async function generateText({ prompt, modelName }) {
  const cfg = loadConfig();
  const genAI = getClient();
  const model = genAI.getGenerativeModel({ model: modelName || cfg.fastModel });
  const result = await model.generateContent(prompt);
  return result.response.text();
}

/**
 * Geração de imagem. Depende do modelo de imagem estar habilitado na conta
 * do Google AI Studio / Vertex ligada à sua API key. Se não estiver, a API
 * retorna erro claro — trate isso na camada de cima.
 */
async function generateImage({ prompt, modelName }) {
  const cfg = loadConfig();
  const genAI = getClient();
  const model = genAI.getGenerativeModel({ model: modelName || cfg.imageModel });
  const result = await model.generateContent(prompt);
  const parts = result.response.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p.inlineData);
  if (!imagePart) {
    throw new Error(
      'O modelo não retornou imagem. Verifique se sua conta tem acesso a geração ' +
      'de imagem (Imagen/Gemini image) no Google AI Studio.'
    );
  }
  return imagePart.inlineData; // { mimeType, data (base64) }
}

module.exports = { getClient, chatWithTools, generateText, generateImage };
GEMINI_JS_EOF

cat > src/tools/shellTools.js << 'SHELL_TOOLS_EOF'
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
SHELL_TOOLS_EOF

echo "Correções aplicadas em src/gemini.js e src/tools/shellTools.js."
node --check src/gemini.js && echo "src/gemini.js: sintaxe OK"
node --check src/tools/shellTools.js && echo "src/tools/shellTools.js: sintaxe OK"
