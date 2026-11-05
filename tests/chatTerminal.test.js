'use strict';
// v0.49.1: o "gemini-code chat" num pseudo-terminal de verdade (o "script", do util-linux), com um modelo falso local.
// Ctrl+C durante a resposta PARA a resposta (e corta a conexão com o modelo) e o chat segue; numa confirmação, vale "não"
// e a ação não roda; com um comando rodando, interrompe o comando; duas vezes, sai sem deixar comando órfão; no "você>",
// sai. Antes, o Ctrl+C só fechava a leitura do teclado: a resposta seguia até o fim e o chat fechava sozinho depois.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const CLI = path.join(__dirname, '..', 'bin', 'gemini-code.js');
const temScript = (() => {
  if (process.platform !== 'linux') return false;
  try { execFileSync('script', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
})();
const pular = temScript ? false : 'sem o "script" (util-linux) para abrir um pseudo-terminal';
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
// eslint-disable-next-line no-control-regex -- tirar as cores e os controles do terminal da tela é o objetivo
const LIMPAR = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\r/g;

/** Modelo falso (API compatível com OpenAI): "comando: X" pede run_shell(X); senão escreve "palavra N" a cada 100 ms. */
async function modeloFalso(t) {
  const eventos = [];
  const srv = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (d) => { corpo += d; });
    req.on('end', () => {
      const msgs = JSON.parse(corpo || '{}').messages || [];
      const ultima = msgs[msgs.length - 1] || {};
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const ev = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      if (ultima.role === 'tool') { eventos.push('depois da ferramenta'); ev({ choices: [{ delta: { content: 'feito' } }] }); res.end('data: [DONE]\n\n'); return; }
      const m = /comando:\s*(.+)$/.exec(String(ultima.content || ''));
      if (m) {
        eventos.push(`pede run_shell`);
        ev({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'run_shell', arguments: JSON.stringify({ command: m[1] }) } }] } }] });
        ev({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
        res.end('data: [DONE]\n\n');
        return;
      }
      eventos.push(`texto: ${String(ultima.content || '').slice(0, 80)}`);
      let i = 0;
      const tique = setInterval(() => {
        if (++i > 80) { clearInterval(tique); eventos.push('terminou'); res.end('data: [DONE]\n\n'); return; }
        ev({ choices: [{ delta: { content: `palavra ${i} ` } }] });
      }, 100);
      res.on('close', () => { if (i <= 80) { clearInterval(tique); eventos.push(`cortou na palavra ${i}`); } });
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => { srv.closeAllConnections?.(); srv.close(); });
  return { porta: srv.address().port, eventos };
}

/** Servidor MCP mínimo (stdio): responde initialize e tools/list e fica vivo; grava o próprio pid. */
const MCP_FALSO = `const fs = require('fs');
fs.writeFileSync(process.argv[2], String(process.pid));
require('readline').createInterface({ input: process.stdin }).on('line', (l) => {
  let m; try { m = JSON.parse(l); } catch { return; }
  if (m.id === undefined) return;
  const r = m.method === 'initialize' ? { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'falso', version: '1' } }
    : m.method === 'tools/list' ? { tools: [] } : {};
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: r }) + '\\n');
});`;

/** Abre o chat num pseudo-terminal; devolve como escrever, esperar um texto na tela e saber se saiu. */
function abrirChat(t, porta, { mcp = false } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-pty-home-'));
  const projeto = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-pty-proj-'));
  t.after(() => { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(projeto, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(home, '.gemini-code'));
  fs.writeFileSync(path.join(home, '.gemini-code', 'config.json'), JSON.stringify({
    configVersion: 99, provider: 'openai', openaiBaseUrl: `http://127.0.0.1:${porta}/v1`, openaiApiKey: 'sk-teste',
    openaiModel: 'modelo-falso', autoGit: false, confiancaProjeto: 'sempre', shellSandbox: 'off',
  }));
  const pidMcp = path.join(home, 'mcp.pid');
  if (mcp) {
    fs.writeFileSync(path.join(home, 'mcp-falso.js'), MCP_FALSO);
    fs.writeFileSync(path.join(home, '.gemini-code', 'mcp.json'), JSON.stringify({ mcpServers: { falso: { command: process.execPath, args: [path.join(home, 'mcp-falso.js'), pidMcp] } } }));
  }
  const env = { ...process.env, HOME: home, USERPROFILE: home, TERM: 'xterm-256color', COLUMNS: '160', LINES: '40' };
  for (const k of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_CODE_OPENAI_KEY', 'GEMINI_CODE_OPENAI_URL', 'NO_COLOR']) delete env[k];
  const p = spawn('script', ['-qfec', `'${process.execPath}' '${CLI}' chat`, '/dev/null'], { cwd: projeto, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let tela = '';
  let saiu = false;
  p.stdout.on('data', (d) => { tela += String(d).replace(LIMPAR, ''); });
  p.on('exit', () => { saiu = true; });
  t.after(() => { if (!saiu) p.kill('SIGKILL'); });
  const esperar = async (re, ms, desde = 0) => {
    const fim = Date.now() + ms;
    while (Date.now() < fim) {
      const m = re.exec(tela.slice(desde));
      if (m) return desde + m.index + m[0].length;
      if (saiu) break;
      await dormir(30);
    }
    assert.fail(`não apareceu ${re} em ${ms} ms. Tela:\n${tela.slice(-1500)}`);
  };
  const esperarSair = async (ms) => {
    const fim = Date.now() + ms;
    while (Date.now() < fim && !saiu) await dormir(30);
    return saiu;
  };
  return { escrever: (s) => p.stdin.write(s), esperar, esperarSair, projeto, tela: () => tela, pidMcp };
}

test('chat no terminal: Ctrl+C durante a resposta para a resposta e corta a conexão; o chat segue; no "você>", sai', { skip: pular }, async (t) => {
  const modelo = await modeloFalso(t);
  const chat = abrirChat(t, modelo.porta);
  let pos = await chat.esperar(/você> /, 20000);
  chat.escrever('conta uma história\r');
  pos = await chat.esperar(/palavra 3 /, 15000, pos);
  const inicio = Date.now();
  chat.escrever('\x03');
  pos = await chat.esperar(/resposta parada[\s\S]*você> /, 5000, pos);
  assert.ok(Date.now() - inicio < 3000, 'parou logo');
  await dormir(300);
  assert.ok(modelo.eventos.some((e) => e.startsWith('cortou na palavra')), `a conexão com o modelo foi cortada: ${modelo.eventos}`);
  assert.ok(!modelo.eventos.includes('terminou'));
  // o chat continua: outra pergunta funciona
  chat.escrever('outra\r');
  pos = await chat.esperar(/palavra 2 /, 15000, pos);
  chat.escrever('\x03');
  await chat.esperar(/resposta parada[\s\S]*você> /, 5000, pos);
  // no "você>", Ctrl+C sai
  chat.escrever('\x03');
  assert.equal(await chat.esperarSair(5000), true, 'saiu com Ctrl+C no "você>"');
});

test('chat no terminal: Ctrl+C numa confirmação vale "não" — a ação não roda e o modelo não é chamado de novo', { skip: pular }, async (t) => {
  const modelo = await modeloFalso(t);
  const chat = abrirChat(t, modelo.porta);
  const alvo = path.join(chat.projeto, 'NAO-DEVIA-EXISTIR');
  let pos = await chat.esperar(/você> /, 20000);
  chat.escrever(`roda o comando: touch ${alvo}\r`);
  pos = await chat.esperar(/\(s\/n/, 15000, pos);
  chat.escrever('\x03');
  await chat.esperar(/resposta parada[\s\S]*você> /, 5000, pos);
  await dormir(500);
  assert.equal(fs.existsSync(alvo), false, 'o comando não rodou');
  assert.deepEqual(modelo.eventos, ['pede run_shell'], 'o modelo não foi chamado de novo');
});

test('chat no terminal: Ctrl+C interrompe o comando rodando; duas vezes sai sem deixar comando órfão', { skip: pular }, async (t) => {
  const modelo = await modeloFalso(t);
  const chat = abrirChat(t, modelo.porta);
  let pos = await chat.esperar(/você> /, 20000);
  // 1) um comando comum: o Ctrl+C o interrompe e o chat volta para o "você>"
  chat.escrever('roda o comando: sleep 20\r');
  pos = await chat.esperar(/\(s\/n/, 15000, pos);
  chat.escrever('s\r');
  await dormir(700);
  let inicio = Date.now();
  chat.escrever('\x03');
  pos = await chat.esperar(/parando a resposta e o comando em andamento[\s\S]*resposta parada[\s\S]*você> /, 5000, pos);
  assert.ok(Date.now() - inicio < 3000, 'o comando foi interrompido logo');
  // 2) um comando que ignora o Ctrl+C: o segundo Ctrl+C sai na hora, e o comando não fica rodando sozinho
  const duracao = `47.${process.pid}${Math.floor(Math.random() * 1000)}`; // única: outra suíte rodando junto não confunde
  chat.escrever(`roda o comando: trap '' INT; sleep ${duracao}\r`);
  pos = await chat.esperar(/\(s\/n/, 15000, pos);
  chat.escrever('s\r');
  await dormir(700);
  chat.escrever('\x03');
  await chat.esperar(/parando a resposta/, 3000, pos);
  inicio = Date.now();
  chat.escrever('\x03');
  assert.equal(await chat.esperarSair(3000), true, 'o segundo Ctrl+C saiu');
  assert.ok(Date.now() - inicio < 2000);
  await dormir(300);
  const sobrou = fs.readdirSync('/proc').filter((n) => /^\d+$/.test(n)).filter((n) => {
    try { return fs.readFileSync(`/proc/${n}/cmdline`, 'utf8') === `sleep\u0000${duracao}\u0000`; } catch { return false; }
  });
  assert.deepEqual(sobrou, [], 'nenhum comando órfão');
});

test('chat no terminal: no "você>", Ctrl+C com texto digitado só apaga a linha; Ctrl+D sai mesmo com um servidor MCP vivo', { skip: pular }, async (t) => {
  const modelo = await modeloFalso(t);
  const chat = abrirChat(t, modelo.porta, { mcp: true });
  let pos = await chat.esperar(/você> /, 20000);
  // Ctrl+C com uma mensagem pela metade: antes saía (e a mensagem se perdia); agora só limpa a linha
  chat.escrever('mensagem pela metade');
  await dormir(300);
  chat.escrever('\x03');
  assert.equal(await chat.esperarSair(1000), false, 'o chat continua aberto');
  chat.escrever('oi\r');
  pos = await chat.esperar(/palavra 1 /, 15000, pos);
  assert.deepEqual(modelo.eventos.filter((e) => e.startsWith('texto')), ['texto: oi'], 'a mensagem enviada foi só "oi"');
  chat.escrever('\x03');
  await chat.esperar(/resposta parada[\s\S]*você> /, 5000, pos);
  // o servidor MCP subiu com a primeira mensagem e segue vivo; Ctrl+D (fim da entrada) no "você>" tem de sair
  const pid = Number(fs.readFileSync(chat.pidMcp, 'utf8'));
  assert.ok(pid > 0);
  chat.escrever('\x04');
  assert.equal(await chat.esperarSair(5000), true, 'saiu com Ctrl+D (antes ficava pendurado pelo servidor MCP)');
  await dormir(300);
  // morto = sumiu, ou virou zumbi (estado Z: já encerrado, só esperando quem o recolha — num contêiner o processo 1
  // nem sempre recolhe órfãos)
  let estado = '';
  try { estado = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].charAt(0); } catch { /* já sumiu */ }
  assert.ok(estado === '' || estado === 'Z', `e o servidor MCP foi encerrado junto (estado: ${estado})`);
});
