// src/navegador.js (v0.44.0)
// Navegador de verdade para o agente: Chrome/Chromium/Edge sem janela, comandado pelo protocolo DevTools
// (CDP) por um PIPE (--remote-debugging-pipe). Nenhuma porta de depuração é aberta: uma página não tem
// como falar com o navegador por trás do agente.
//
// Rede: todo o tráfego do navegador (inclusive 127.0.0.1, por causa do "<-loopback>") passa por um proxy
// local que confere o endereço NA HORA DE CONECTAR, com o mesmo critério do src/redeSegura.js: rede local e
// endereços reservados ficam bloqueados (sem a brecha de DNS rebinding de "checar o DNS e depois deixar o
// navegador resolver de novo"). `navegadorPermitirLocal` libera só o loopback, para testar o próprio app.
//
// Navegação: só a página principal é vigiada. Ir para um site ainda não aprovado (clique, formulário,
// redirecionamento ou script) é barrado aqui, sem perguntar no meio de um clique; quem pergunta ao usuário
// é a ação "abrir" da ferramenta (src/tools/browserTools.js). Perfil temporário: sem contas nem cookies do
// usuário, apagado ao fechar; downloads recusados; alertas da página dispensados.
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const dns = require('dns');

// Google Chrome primeiro: traz o auxiliar da sandbox; um Chromium baixado à parte pode não conseguir usá-la (Ubuntu 23.10+).
const NOMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome', 'microsoft-edge', 'msedge'];
const PRAZO_COMANDO_MS = 30000;
// v0.45.0: a PRIMEIRA abertura numa máquina fria (perfil novo, cache de fontes, outros processos disputando a CPU)
// passou de 20 s num runner do CI; num celular ou PC lento acontece o mesmo. Só a partida ganha mais tempo.
const PRAZO_INICIO_MS = 60000;
const PRAZO_CARREGAR_MS = 15000;

// ---------------------------------------------------------------------------
// Achar o executável
// ---------------------------------------------------------------------------

function ehArquivo(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }

function pastasDoPlaywright(env) {
  // o Chromium que o Playwright baixa (Linux): pasta da variável PLAYWRIGHT_BROWSERS_PATH ou o cache padrão
  const bases = [env.PLAYWRIGHT_BROWSERS_PATH, path.join(os.homedir(), '.cache', 'ms-playwright')].filter(Boolean);
  const achados = [];
  for (const base of bases) {
    let itens;
    try { itens = fs.readdirSync(base).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse(); } catch { continue; }
    for (const n of itens) for (const sub of ['chrome-linux64', 'chrome-linux']) achados.push(path.join(base, n, sub, 'chrome'));
  }
  return achados;
}

/** Caminho do navegador: o do config (se existir), senão o primeiro conhecido no PATH e nos lugares de costume. */
function acharNavegador({ caminho = '', env = process.env, plataforma = process.platform } = {}) {
  if (caminho) return ehArquivo(caminho) ? caminho : null;
  const exts = plataforma === 'win32' ? ['.exe', ''] : [''];
  for (const dir of String(env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const nome of NOMES) for (const ext of exts) { const p = path.join(dir, nome + ext); if (ehArquivo(p)) return p; }
  }
  const fixos = plataforma === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
    : plataforma === 'win32'
      ? [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean).flatMap((b) => [
        path.join(b, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(b, 'Microsoft', 'Edge', 'Application', 'msedge.exe')])
      : [];
  return [...fixos, ...pastasDoPlaywright(env)].find(ehArquivo) || null;
}

// ---------------------------------------------------------------------------
// Proxy que confere o destino na hora de conectar
// ---------------------------------------------------------------------------

const ehLoopback = (a) => a === '::1' || /^127\./.test(a) || /^::ffff:127\./i.test(a);

function bloqueado(endereco, permitirLocal) {
  if (permitirLocal && ehLoopback(endereco)) return false;
  return require('./routineRunner').privateAddress(endereco);
}

function erroBloqueado(host, endereco) {
  const e = new Error(host === endereco
    ? `${host} é um endereço local/privado`
    : `${host} resolve para um endereço local/privado (${endereco})`);
  e.code = 'ERR_DESTINO_PRIVADO';
  return e;
}

/** Abre uma conexão TCP só se o endereço (o resolvido NA HORA, não um de antes) for público. */
function conectarConferido(host, porta, permitirLocal) {
  return new Promise((resolve, reject) => {
    const h = String(host).replace(/^\[|\]$/g, '');
    // IP escrito direto não passa pelo `lookup`: confere aqui.
    if (net.isIP(h) && bloqueado(h, permitirLocal)) return reject(erroBloqueado(h, h));
    const lookup = (nome, opcoes, cb) => {
      const opts = typeof opcoes === 'object' && opcoes ? opcoes : { family: opcoes };
      dns.lookup(nome, { ...opts, all: true }, (err, lista) => {
        if (err) return cb(err);
        const ruim = lista.find((a) => bloqueado(a.address, permitirLocal));
        if (ruim) return cb(erroBloqueado(nome, ruim.address));
        if (opts.all) return cb(null, lista);
        return cb(null, lista[0].address, lista[0].family);
      });
    };
    const s = net.connect({ host: h, port: porta, lookup });
    s.once('connect', () => { s.removeListener('error', reject); resolve(s); });
    s.once('error', reject);
  });
}

function criarProxy({ permitirLocal = false, aoBloquear = () => {} } = {}) {
  const recusar = (host, err) => { if (err && err.code === 'ERR_DESTINO_PRIVADO') aoBloquear(host, err.message); };
  // Todas as conexões (do navegador e as de saída), para `encerrar` não deixar nenhuma prendendo o processo.
  const conexoes = new Set();
  const guardar = (s) => { conexoes.add(s); s.once('close', () => conexoes.delete(s)); return s; };
  const conectar = (host, porta) => conectarConferido(host, porta, permitirLocal).then(guardar);
  const servidor = http.createServer((req, res) => {
    // HTTP sem TLS: o navegador manda a URL inteira ("absolute-form")
    let alvo;
    try { alvo = new URL(req.url); } catch { res.writeHead(400); return res.end(); }
    if (alvo.protocol !== 'http:') { res.writeHead(400); return res.end(); }
    const porta = Number(alvo.port || 80);
    conectar(alvo.hostname, porta).then((sock) => {
      const cabecalhos = { ...req.headers };
      delete cabecalhos['proxy-connection'];
      delete cabecalhos['proxy-authorization'];
      // sem `agent`: com agent:false o Node ignora o createConnection e abriria outra conexão, sem conferir
      const ida = http.request({ createConnection: () => sock, method: req.method, path: alvo.pathname + alvo.search, headers: cabecalhos }, (volta) => {
        volta.on('error', () => res.destroy()); // conexão que cai no meio da resposta não derruba o processo
        res.writeHead(volta.statusCode, volta.statusMessage, volta.rawHeaders);
        volta.pipe(res);
      });
      ida.on('error', () => res.destroy());
      req.on('error', () => ida.destroy());
      req.pipe(ida);
    }, (err) => {
      recusar(alvo.hostname, err);
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`Bloqueado pelo gemini-code: ${err.message}.`);
    });
  });
  servidor.on('connect', (req, cliente, cabeca) => {
    cliente.on('error', () => {});
    const m = /^(\[[^\]]+\]|[^:\s]+):(\d{1,5})$/.exec(req.url || '');
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 65535) return cliente.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    conectar(m[1], Number(m[2])).then((destino) => {
      destino.on('error', () => cliente.destroy());
      cliente.on('error', () => destino.destroy());
      cliente.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (cabeca && cabeca.length) destino.write(cabeca);
      destino.pipe(cliente);
      cliente.pipe(destino);
    }, (err) => {
      recusar(m[1].replace(/^\[|\]$/g, ''), err);
      cliente.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    });
  });
  servidor.on('connection', guardar);
  servidor.encerrar = () => { for (const s of conexoes) s.destroy(); servidor.close(); };
  return servidor;
}

// ---------------------------------------------------------------------------
// Scripts que rodam DENTRO da página (só os nossos, fixos; o modelo não manda JavaScript)
// ---------------------------------------------------------------------------

const SCRIPT_RETRATO = `(() => {
  const MAX = 150;
  const visivel = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  document.querySelectorAll('[data-gc-n]').forEach((el) => el.removeAttribute('data-gc-n'));
  const seletor = 'a[href], button, input:not([type=hidden]), textarea, select, summary, [role=button], [role=link], '
    + '[role=checkbox], [role=tab], [role=menuitem], [role=option], [onclick], [contenteditable=""], [contenteditable=true]';
  const itens = [];
  for (const el of document.querySelectorAll(seletor)) {
    if (itens.length >= MAX) break;
    if (el.disabled || !visivel(el)) continue;
    const n = itens.length + 1;
    el.setAttribute('data-gc-n', String(n));
    const tag = el.tagName.toLowerCase();
    const tipoInput = (el.getAttribute('type') || 'text').toLowerCase();
    const tipo = tag === 'a' ? 'link' : tag === 'input' ? (['checkbox', 'radio'].includes(tipoInput) ? tipoInput : 'campo ' + tipoInput)
      : tag === 'textarea' ? 'campo texto' : tag === 'select' ? 'lista' : (el.getAttribute('role') || 'botão');
    const rotulo = (el.getAttribute('aria-label') || el.innerText || (tipoInput !== 'password' ? el.value : '') || el.placeholder
      || el.title || el.getAttribute('name') || el.getAttribute('alt') || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
    let extra = '';
    if (tag === 'a') extra = ' -> ' + String(el.getAttribute('href')).slice(0, 120);
    else if (['checkbox', 'radio'].includes(tipoInput)) extra = el.checked ? ' (marcado)' : ' (desmarcado)';
    else if ((tag === 'input' || tag === 'textarea') && tipoInput !== 'password' && el.value) extra = ' (valor: "' + String(el.value).slice(0, 40) + '")';
    else if (tag === 'select' && el.selectedOptions[0]) extra = ' (escolhido: "' + el.selectedOptions[0].text.trim().slice(0, 40) + '")';
    itens.push('[' + n + '] ' + tipo + ' "' + rotulo + '"' + extra);
  }
  const texto = (document.body ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n').trim();
  return { titulo: document.title, url: location.href, itens, texto };
})()`;

const scriptAlvo = (n) => `(() => {
  const el = document.querySelector('[data-gc-n="${Number(n)}"]');
  if (!el) return null;
  // link que abriria outra aba abre nesta (o agente só acompanha uma)
  const a = el.closest('a[target]'); if (a) a.target = '_self';
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, tag: el.tagName.toLowerCase(), editavel: el.isContentEditable };
})()`;

const scriptEscolherOpcao = (n, texto) => `(() => {
  const el = document.querySelector('[data-gc-n="${Number(n)}"]');
  const alvo = ${JSON.stringify(String(texto))}.trim().toLowerCase();
  const op = [...el.options].find((o) => o.text.trim().toLowerCase() === alvo || o.value.toLowerCase() === alvo)
    || [...el.options].find((o) => o.text.trim().toLowerCase().includes(alvo));
  if (!op) return [...el.options].map((o) => o.text.trim()).slice(0, 30);
  el.value = op.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`;

const scriptLimparCampo = (n) => `(() => {
  const el = document.querySelector('[data-gc-n="${Number(n)}"]');
  if (!el) return false;
  el.focus();
  if (el.isContentEditable) { document.execCommand('selectAll'); document.execCommand('delete'); }
  else if ('value' in el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
  return true;
})()`;

// window.open vira navegação na mesma aba (o agente acompanha uma só)
const SCRIPT_UMA_ABA = 'window.open = function (u) { if (u) location.href = u; return null; };';

const TECLAS = {
  enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
  tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
  esc: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
  apagar: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
  espaco: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' },
  cima: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
  baixo: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
  esquerda: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
  direita: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
  pageup: { key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 },
};

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * O que o Chrome disse ao falhar na partida: as linhas FATAL/ERROR (as últimas costumam ser um despejo de
 * registradores, que não ajuda), e o que fazer quando o motivo é a sandbox. A sandbox nunca é desligada sozinha.
 */
function explicarFalha(saida) {
  const linhas = String(saida || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const uteis = linhas.filter((l) => /FATAL|ERROR:|sandbox|error while loading|cannot open shared|No such file/i.test(l));
  const detalhe = (uteis.length ? uteis.slice(0, 2) : linhas.slice(-1)).join(' ').replace(/^\[[^\]]*\]\s*/, '').slice(0, 400);
  if (!detalhe) return '';
  const dica = /sandbox|namespace/i.test(saida)
    ? ' Este Chrome/Chromium não consegue usar a própria sandbox (comum no Ubuntu 23.10+ com um Chromium baixado à parte): instale o Google Chrome ou o Chromium do sistema, ou aponte outro com gemini-code config set-navegador-path.'
    : '';
  return ` — ${detalhe}.${dica}`;
}

// ---------------------------------------------------------------------------
// O navegador
// ---------------------------------------------------------------------------

class Navegador {
  /**
   * @param {object} o
   * @param {string} o.executavel caminho do Chrome/Chromium/Edge
   * @param {boolean} [o.permitirLocal] libera o loopback (127.0.0.1/localhost) no proxy
   * @param {(url: URL) => string|null} o.navegacaoBarrada motivo para recusar a navegação da página principal, ou null
   */
  constructor({ executavel, permitirLocal = false, navegacaoBarrada }) {
    this.executavel = executavel;
    this.permitirLocal = permitirLocal;
    this.navegacaoBarrada = navegacaoBarrada;
    this.avisos = [];
    this.proximoId = 0;
    this.pendentes = new Map();
    this.carregando = false;
    this.navegacoes = 0;
    this.fechado = false;
  }

  aviso(texto) { if (!this.avisos.includes(texto)) this.avisos.push(texto); if (this.avisos.length > 10) this.avisos.shift(); }
  tirarAvisos() { const a = this.avisos; this.avisos = []; return a; }

  async iniciar() {
    this.proxy = criarProxy({ permitirLocal: this.permitirLocal, aoBloquear: (host, motivo) => this.aviso(`Bloqueado: ${motivo} (o navegador não acessa a rede local).`) });
    await new Promise((ok, falha) => { this.proxy.once('error', falha); this.proxy.listen(0, '127.0.0.1', ok); });
    this.perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-navegador-'));
    const args = [
      '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${this.perfil}`,
      `--proxy-server=http://127.0.0.1:${this.proxy.address().port}`, '--proxy-bypass-list=<-loopback>',
      '--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
      '--disable-sync', '--disable-default-apps', '--disable-extensions', '--no-pings', '--disable-domain-reliability',
      '--disable-client-side-phishing-detection', '--disable-breakpad', '--metrics-recording-only', '--password-store=basic',
      '--use-mock-keychain', '--mute-audio', '--hide-scrollbars', '--window-size=1280,900',
      '--disable-features=Translate,OptimizationHints,MediaRouter,AutofillServerCommunication',
    ];
    // Como root (contêiner, Termux com proot) o Chrome não sobe com a própria sandbox.
    if (typeof process.getuid === 'function' && process.getuid() === 0) args.push('--no-sandbox');
    args.push('about:blank');
    this.processo = spawn(this.executavel, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
    let erroSaida = '';
    this.processo.stderr.on('data', (d) => { if (erroSaida.length < 20000) erroSaida += d; });
    const terminou = (motivo) => {
      this.fechado = true;
      for (const [, p] of this.pendentes) p.falha(new Error(motivo));
      this.pendentes.clear();
    };
    // arquivo sem permissão de execução etc.: "error" e nenhum "exit" — sem isto, esperaria o prazo inteiro
    this.processo.on('error', (e) => terminou(`não deu para executar (${e.code || e.message}).`));
    this.processo.on('exit', () => terminou('o navegador fechou.'));
    this.limpezaNaSaida = () => this.encerrarJa();
    process.once('exit', this.limpezaNaSaida);

    const entrada = this.processo.stdio[3];
    const saida = this.processo.stdio[4];
    entrada.on('error', () => {});
    this.entrada = entrada;
    let buf = '';
    saida.setEncoding('utf8');
    saida.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\0')) >= 0) {
        const bruta = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let msg;
        try { msg = JSON.parse(bruta); } catch { continue; }
        if (msg.id && this.pendentes.has(msg.id)) {
          const p = this.pendentes.get(msg.id);
          this.pendentes.delete(msg.id);
          if (msg.error) p.falha(new Error(msg.error.message || 'erro do navegador')); else p.ok(msg.result || {});
        } else if (msg.method) {
          // um evento mal tratado não pode derrubar o processo (o erro sairia do leitor do pipe)
          try { this.aoEvento(msg); } catch (e) { this.aviso(`erro interno ao tratar ${msg.method}: ${e.message}`); }
        }
      }
    });

    try {
      const { targetId } = await this.enviar('Target.createTarget', { url: 'about:blank' }, { sessao: null, prazoMs: PRAZO_INICIO_MS });
      this.alvoId = targetId;
      // abas novas (target=_blank, formulário, script) carregariam fora da vista e da aprovação: fecha na hora
      await this.enviar('Target.setDiscoverTargets', { discover: true }, { sessao: null });
      const { sessionId } = await this.enviar('Target.attachToTarget', { targetId, flatten: true }, { sessao: null });
      this.sessao = sessionId;
      await this.enviar('Browser.setDownloadBehavior', { behavior: 'deny' }, { sessao: null }).catch(() => {});
      await this.enviar('Page.enable');
      await this.enviar('Runtime.enable');
      await this.enviar('Page.addScriptToEvaluateOnNewDocument', { source: SCRIPT_UMA_ABA });
      const { frameTree } = await this.enviar('Page.getFrameTree');
      this.framePrincipal = frameTree.frame.id;
      await this.enviar('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Request' }] });
    } catch (err) {
      this.encerrarJa();
      throw new Error(`não consegui iniciar o navegador (${this.executavel}): ${err.message}${explicarFalha(erroSaida)}`, { cause: err });
    }
  }

  enviar(metodo, params = {}, { sessao = this.sessao, prazoMs = PRAZO_COMANDO_MS } = {}) {
    if (this.fechado) return Promise.reject(new Error('o navegador está fechado.'));
    return new Promise((ok, falha) => {
      const id = ++this.proximoId;
      const timer = setTimeout(() => { this.pendentes.delete(id); falha(new Error(`o navegador não respondeu a ${metodo} em ${prazoMs / 1000} s.`)); }, prazoMs);
      this.pendentes.set(id, { ok: (r) => { clearTimeout(timer); ok(r); }, falha: (e) => { clearTimeout(timer); falha(e); } });
      this.entrada.write(JSON.stringify({ id, method: metodo, params, ...(sessao ? { sessionId: sessao } : {}) }) + '\0');
    });
  }

  aoEvento({ method: metodo, params = {} }) {
    if (metodo === 'Page.frameStartedLoading' && params.frameId === this.framePrincipal) { this.carregando = true; this.navegacoes++; }
    else if (metodo === 'Page.frameStoppedLoading' && params.frameId === this.framePrincipal) this.carregando = false;
    else if (metodo === 'Target.targetCreated' && params.targetInfo && params.targetInfo.type === 'page' && params.targetInfo.targetId !== this.alvoId) {
      if (params.targetInfo.openerId) this.aviso(`A página tentou abrir outra aba (${String(params.targetInfo.url || '').slice(0, 200)}); foi fechada — o agente usa uma aba só.`);
      this.enviar('Target.closeTarget', { targetId: params.targetInfo.targetId }, { sessao: null }).catch(() => {});
    } else if (metodo === 'Page.javascriptDialogOpening') {
      // alert/confirm/prompt travariam a página esperando alguém: dispensa e conta ao agente
      this.aviso(`A página abriu um aviso (${params.type}) que foi dispensado: "${String(params.message || '').slice(0, 200)}"`);
      this.enviar('Page.handleJavaScriptDialog', { accept: false }).catch(() => {});
    } else if (metodo === 'Fetch.requestPaused') this.decidirNavegacao(params);
  }

  decidirNavegacao({ requestId, request = {}, frameId }) {
    const continuar = () => this.enviar('Fetch.continueRequest', { requestId }).catch(() => {});
    if (frameId !== this.framePrincipal) return continuar(); // iframes: só as regras de rede valem
    let url;
    try { url = new URL(request.url); } catch { url = null; }
    let motivo;
    try {
      motivo = !url ? 'endereço inválido'
        : !['http:', 'https:'].includes(url.protocol) ? `o navegador só abre páginas http/https (pedido: ${url.protocol})`
          : this.navegacaoBarrada(url);
    } catch (e) {
      motivo = `não deu para conferir o site (${e.message})`; // na dúvida, barra — e a página não fica pendurada
    }
    if (!motivo) return continuar();
    this.aviso(`A página tentou ir para ${String(request.url).slice(0, 200)} e foi barrada: ${motivo}`);
    return this.enviar('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
  }

  /** Roda a ação e espera a página assentar (carregamento que ela tenha disparado). */
  async eEsperar(acao) {
    const antes = this.navegacoes;
    await acao();
    const inicio = Date.now();
    while (Date.now() - inicio < 400 && this.navegacoes === antes && !this.carregando) await dormir(50);
    const limite = Date.now() + PRAZO_CARREGAR_MS;
    while (this.carregando && Date.now() < limite && !this.fechado) await dormir(100);
    await dormir(150);
  }

  /**
   * Nossos scripts rodam num "mundo isolado" (como os de uma extensão): o DOM é o mesmo, mas o JavaScript da
   * página não alcança o nosso — antes uma página podia trocar Element.prototype.getAttribute & cia. e fazer o
   * agente ler "Cancelar" num botão que confirma. Um contexto novo a cada leitura (navegar destrói o anterior).
   */
  async avaliar(expressao) {
    const { executionContextId } = await this.enviar('Page.createIsolatedWorld', { frameId: this.framePrincipal, worldName: 'gemini-code' });
    const r = await this.enviar('Runtime.evaluate', { expression: expressao, contextId: executionContextId, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`erro ao ler a página: ${r.exceptionDetails.text || 'exceção'}`);
    return r.result ? r.result.value : undefined;
  }

  /** Navega e espera; devolve o resultado do Page.navigate (errorText quando a página não carregou). */
  async abrir(url) {
    let r = {};
    await this.eEsperar(async () => { r = await this.enviar('Page.navigate', { url }); });
    return r;
  }
  retrato() { return this.avaliar(SCRIPT_RETRATO); }

  async alvo(n) {
    const a = await this.avaliar(scriptAlvo(n));
    if (!a) throw new Error(`não achei o elemento [${n}] — a página pode ter mudado; use "ler" para ver os números atuais.`);
    return a;
  }

  async clicarEm(x, y) {
    await this.enviar('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await this.enviar('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await this.enviar('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }

  async clicar(n) {
    const a = await this.alvo(n);
    await this.eEsperar(() => this.clicarEm(a.x, a.y));
  }

  async digitar(n, texto, { enviar = false } = {}) {
    const a = await this.alvo(n);
    if (a.tag === 'select') {
      const r = await this.avaliar(scriptEscolherOpcao(n, texto));
      if (r !== true) throw new Error(`a lista [${n}] não tem a opção "${texto}". Opções: ${(r || []).join(' | ')}`);
      return;
    }
    await this.clicarEm(a.x, a.y);
    await this.avaliar(scriptLimparCampo(n));
    await this.enviar('Input.insertText', { text: String(texto) });
    if (enviar) await this.tecla('enter');
  }

  async tecla(nome) {
    const t = TECLAS[nome];
    if (!t) throw new Error(`tecla desconhecida: ${nome}. Use: ${Object.keys(TECLAS).join(', ')}`);
    await this.eEsperar(async () => {
      await this.enviar('Input.dispatchKeyEvent', { type: t.text ? 'keyDown' : 'rawKeyDown', ...t });
      await this.enviar('Input.dispatchKeyEvent', { type: 'keyUp', key: t.key, code: t.code, windowsVirtualKeyCode: t.windowsVirtualKeyCode });
    });
  }

  rolar(direcao) { return this.avaliar(`window.scrollBy(0, ${direcao === 'cima' ? '-' : ''}Math.round(innerHeight * 0.8))`); }
  voltar() { return this.eEsperar(() => this.avaliar('history.back()')); }

  async print() {
    const { data } = await this.enviar('Page.captureScreenshot', { format: 'png' });
    return Buffer.from(data, 'base64');
  }

  async fechar() {
    if (!this.fechado && this.processo && this.processo.exitCode === null) {
      // espera o Chrome sair de verdade: apagar o perfil antes disso deixava ele recriar arquivos lá
      const saiu = new Promise((ok) => this.processo.once('exit', ok));
      await this.enviar('Browser.close', {}, { sessao: null, prazoMs: 5000 }).catch(() => {});
      await Promise.race([saiu, dormir(5000)]);
    }
    this.encerrarJa();
  }

  /** Síncrono (serve no evento "exit"): mata o processo, fecha o proxy, apaga o perfil temporário. */
  encerrarJa() {
    this.fechado = true;
    if (this.limpezaNaSaida) { process.removeListener('exit', this.limpezaNaSaida); this.limpezaNaSaida = null; }
    try { if (this.processo && this.processo.exitCode === null) this.processo.kill('SIGKILL'); } catch { /* já saiu */ }
    try { if (this.proxy) this.proxy.encerrar(); } catch { /* já fechado */ }
    if (this.perfil) {
      // o Chrome pode levar um instante para soltar os arquivos do perfil
      try { fs.rmSync(this.perfil, { recursive: true, force: true, maxRetries: 3 }); } catch { /* melhor esforço */ }
      this.perfil = null;
    }
  }
}

module.exports = { Navegador, acharNavegador, criarProxy, conectarConferido, explicarFalha, TECLAS, NOMES };
