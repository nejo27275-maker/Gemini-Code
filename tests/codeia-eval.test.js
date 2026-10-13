'use strict';
// Avaliação do code-ia: perguntas reais -> o bloco certo precisa vir em 1º lugar. Mede qualidade da busca
// (sinônimos, flexões, camelCase) e impede regressão quando o corpus ou o tokenizador mudam.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-codeia-eval-'));
process.env.HOME = home;
process.env.USERPROFILE = home;

const install = require('../src/code-ia/install');
const { buscar } = require('../src/code-ia/model');

const CASOS = [
  ['como ler um arquivo em node', 'ler um arquivo em Node'],
  ['quero salvar um json no node', 'ler e salvar JSON em Node'],
  ['criar servidor express', 'servidor web com Express'],
  ['servidor http sem biblioteca', 'sem nenhuma biblioteca'],
  ['fazer requisição http no node', 'requisição HTTP com fetch'],
  ['como esperar um tempo em js', 'esperar um tempo'],
  ['criar classe em javascript', 'classe em JavaScript'],
  ['executar comando do terminal pelo node', 'comando do terminal pelo Node'],
  ['bot de discord', 'bot de Discord com discord.js'],
  ['botões no discord', 'botões no discord.js'],
  ['slash command discord', 'slash commands'],
  ['bot de whatsapp baileys', 'WhatsApp com Baileys'],
  ['ler arquivo em python', 'ler e escrever arquivo em Python'],
  ['flask servidor python', 'Flask'],
  ['instalar node no termux', 'instalar Node.js e Python no Termux'],
  ['manter o termux rodando com a tela desligada', 'manter o Termux rodando'],
  ['ip do celular na rede wifi', 'IP do celular'],
  ['rodar programa em segundo plano termux', 'segundo plano no Termux'],
  ['extensão chrome manifest v3', 'extensão de navegador Chrome com Manifest V3'],
  ['salvar configurações extensão chrome storage', 'chrome.storage'],
  ['página html básica', 'página HTML básica'],
  ['jogo canvas loop', 'canvas HTML5'],
  ['usar banco sqlite no node', 'SQLite em Node'],
  ['websocket node', 'WebSocket em Node'],
  ['liberar cors express', 'CORS no Express'],
  ['chamar api do gemini', 'API do Gemini'],
  ['conversar com ollama', 'Ollama'],
  ['cortar vídeo com ffmpeg', 'ffmpeg'],
  ['notificação e voz no termux api', 'API do Termux'],
  ['erro eaddrinuse porta em uso', 'EADDRINUSE'],
  ['erro cannot find module', 'Cannot find module'],
  ['erro 429 gemini cota', '429'],
  ['cena 3d three.js', 'Three.js'],
  ['script minecraft bedrock evento', 'Minecraft Bedrock'],
  ['overlay flutuante android kotlin', 'overlay flutuante'],
  // erros de digitação do dia a dia
  ['criar servido express', 'servidor web com Express'],
  ['como ler arqivo no node', 'ler um arquivo em Node'],
  ['bot de discorde', 'bot de Discord com discord.js'],
  ['instalar nodejs no termuz', 'instalar Node.js e Python no Termux'],
  ['usar banco sqlit no node', 'SQLite em Node'],
  ['cortar video com ffmepg', 'ffmpeg'],
  ['como o code-ia funciona', 'Como funciona o code-ia'],
  ['ensinar o code-ia', 'ensinar o code-ia'],
  // v0.7: corpus ampliado
  ['criar pix mercado pago', 'Pix com a API do Mercado Pago'],
  ['rodar várias promises em paralelo', 'Promise.all'],
  ['unhandledrejection derrubando o node', 'unhandledRejection'],
  ['manter bot node rodando pm2', 'pm2'],
  ['validar body post express', 'corpo de uma requisição POST no Express'],
  ['middleware de token no express', 'middleware de senha ou token'],
  ['usar map e set em js', 'Map e Set'],
  ['desestruturação spread javascript', 'desestruturação e spread'],
  ['agendar tarefa horário fixo node cron', 'node-cron'],
  ['docker build e run', 'Docker'],
  ['sql join where order by', 'consulta SQL'],
  ['formatar texto f-string python', 'f-string'],
  ['ler csv em python', 'arquivo CSV em Python'],
  ['stream da câmera flask opencv', 'Flask e OpenCV'],
  ['filtrar json com jq', 'jq'],
  ['fetch com authorization bearer enviar json', 'cabeçalho de autorização'],
  // v0.9: erros comuns
  ['cannot read properties of undefined', 'Cannot read properties of undefined'],
  ['erro enoent no such file or directory', 'ENOENT'],
  ['eacces permission denied npm', 'EACCES'],
  ['require is not defined in es module scope', 'require is not defined'],
  ['no module named cv2', 'No module named'],
  ['indentationerror unexpected indent', 'IndentationError'],
  ['fetch failed etimedout', 'fetch failed'],
  ['git push rejected non-fast-forward', 'git push rejected'],
  // v0.10: bots e Termux
  ['guardar placar partidas discord sqlite', 'placar e partidas de um bot de Discord'],
  ['webhook mercado pago pagamento aprovado', 'aviso de pagamento'],
  ['criar canal privado por partida discord', 'canal privado para cada partida'],
  ['dar cargo ao membro discord', 'cargo de um membro'],
  ['embed e menu de seleção discord', 'embed e menu de seleção'],
  ['better-sqlite3 não instala no termux', 'better-sqlite3'],
  ['pkg update erro repositório termux', 'atualizar os pacotes do Termux'],
  ['túnel cloudflared expor servidor', 'túnel'],
  ['wake lock termux tarefa longa', 'evitar que o Termux feche'],
];

test('busca do code-ia: o bloco certo vem em 1º lugar em pelo menos 90% das perguntas', () => {
  const { modelo } = install.ensureInstalled();
  const erros = [];
  for (const [pergunta, esperado] of CASOS) {
    const r = buscar(modelo, pergunta, { limite: 1 })[0];
    if (!r || !r.doc.titulo.toLowerCase().includes(esperado.toLowerCase())) erros.push(`${pergunta} => ${r ? r.doc.titulo : '(nada)'} (esperado: ${esperado})`);
  }
  const acerto = 1 - erros.length / CASOS.length;
  assert.ok(acerto >= 0.9, `acerto ${(acerto * 100).toFixed(0)}% (${CASOS.length - erros.length}/${CASOS.length}). Erros:\n${erros.join('\n')}`);
});
